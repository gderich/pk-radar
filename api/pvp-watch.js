import {createClient} from "@supabase/supabase-js";

const WORLD="Jadebra";
const WORLD_API="https://api.tibiadata.com/v4/world/";
const CHAR_API="https://api.tibiadata.com/v4/character/";
const UA="PK-Radar/5.0 (+https://pk-radar.vercel.app)";
const BATCH_SIZE=12;
const RECENT_TTL=20*60*1000;
const DEATH_LOOKBACK=30*60*1000;
const REVENGE_WINDOW=15*60*1000;

async function authUser(req,db){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token)return null;
  const {data}=await db.auth.getUser(token);
  return data?.user||null;
}
function onlineNames(j){
  const list=j?.world?.online_players??j?.world?.players_online??j?.worlds?.players_online??j?.players_online??[];
  return (Array.isArray(list)?list:[]).map(x=>String((x?.name??x)||"").trim()).filter(Boolean);
}
function deathList(j){
  const root=j?.character??j?.characters??j??{};
  return Array.isArray(root?.deaths)?root.deaths:Array.isArray(root?.data?.deaths)?root.data.deaths:[];
}
function playerEntries(list,role){
  return (Array.isArray(list)?list:[]).filter(x=>x?.player!==false&&x?.name).map(x=>({name:String(x.name).trim(),player:true,role,traded:Boolean(x.traded),summon:x.summon||null}));
}
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function minsLeft(until,now){return Math.max(0,Math.ceil((until-now)/60000))}
async function fetchJson(url){
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":UA}});
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!url||!key)return res.status(500).json({error:"Supabase environment variables are missing"});
  const authHeader=req.headers.authorization||"";
  const db=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:authHeader}}});
  const user=await authUser(req,db);
  if(!user)return res.status(401).json({error:"Unauthorized"});

  const now=Date.now(),nowIso=new Date(now).toISOString();
  try{
    const [{data:targets,error:targetError},{data:syncRow,error:syncError}]=await Promise.all([
      db.from("characters").select("id,name,tags,worlds(name)").eq("archived",false).eq("monitored",true),
      db.from("source_syncs").select("id,config,request_count").eq("source","TIBIADATA").maybeSingle()
    ]);
    if(targetError)throw targetError;if(syncError)throw syncError;
    const active=(targets??[]).filter(x=>x.worlds?.name===WORLD);
    const targetByName=new Map(active.map(x=>[String(x.name).toLowerCase(),x]));
    if(!active.length)return res.status(200).json({ok:true,scanned:0,alerts:0,message:"No monitored Jadebra targets"});

    const world=await fetchJson(WORLD_API+encodeURIComponent(WORLD));
    const current=onlineNames(world);
    const cfg=syncRow?.config&&typeof syncRow.config==="object"?syncRow.config:{};
    const seen={...(cfg.pvp_watch_recent_seen||{})};
    for(const name of current)seen[name]=nowIso;
    for(const [name,at] of Object.entries(seen)){const t=new Date(String(at)).getTime();if(!Number.isFinite(t)||now-t>RECENT_TTL)delete seen[name]}
    const pool=[...new Set([...current,...Object.keys(seen)])].sort((a,b)=>a.localeCompare(b));
    let cursor=Number(cfg.pvp_watch_cursor||0);
    if(cursor>=pool.length)cursor=0;
    const batch=[];
    for(let i=0;i<Math.min(BATCH_SIZE,pool.length);i++)batch.push(pool[(cursor+i)%pool.length]);
    const nextCursor=pool.length?(cursor+batch.length)%pool.length:0;

    const results=await Promise.all(batch.map(async victim=>{
      try{return {victim,data:await fetchJson(CHAR_API+encodeURIComponent(victim))}}
      catch(error){return {victim,error:error instanceof Error?error.message:String(error)}}
    }));

    let savedDeaths=0,savedPvp=0,alerts=0;
    const found=[];
    for(const result of results){
      if(result.error||!result.data)continue;
      for(const d of deathList(result.data)){
        const at=iso(d?.time);if(!at)continue;
        const killTs=new Date(at).getTime();if(now-killTs>DEATH_LOOKBACK||killTs>now+60000)continue;
        const killers=playerEntries(d?.killers,"KILLER");
        const assists=playerEntries(d?.assists,"ASSIST");
        const participants=[...killers,...assists];
        const monitored=participants.map(p=>({p,target:targetByName.get(p.name.toLowerCase())})).filter(x=>x.target);
        if(!monitored.length)continue;
        const monitoredKillers=killers.map(p=>({p,target:targetByName.get(p.name.toLowerCase())})).filter(x=>x.target);
        const victimName=result.victim;
        const victimTarget=targetByName.get(victimName.toLowerCase());
        const deathKey="pvp-death:"+at+":"+victimName.toLowerCase();
        const deathPayload={
          character_id:victimTarget?.id??null,occurred_at:at,level:Number(d?.level)||null,
          killers:participants,source:"TIBIADATA",confidence:"HIGH",
          reference_url:CHAR_API+encodeURIComponent(victimName),
          raw_data:{world:WORLD,victim:victimName,reason:d?.reason||null,killers,assists,detected_at:nowIso},
          dedupe_key:deathKey
        };
        const deathUp=await db.from("death_events").upsert(deathPayload,{onConflict:"dedupe_key"});
        if(!deathUp.error)savedDeaths++;

        for(const {p,target} of monitored){
          const key="pvp-event:"+target.id+":"+at+":"+victimName.toLowerCase()+":"+p.role.toLowerCase();
          const up=await db.from("pvp_events").upsert({
            character_id:target.id,opponent_name:victimName,role:p.role,occurred_at:at,
            source:"TIBIADATA",confidence:"HIGH",reference_url:CHAR_API+encodeURIComponent(victimName),
            raw_data:{victim:victimName,world:WORLD,killers,assists,detected_at:nowIso},
            dedupe_key:key
          },{onConflict:"dedupe_key"});
          if(!up.error)savedPvp++;
        }

        if(monitoredKillers.length){
          const until=killTs+REVENGE_WINDOW;
          const killerNames=[...new Set(monitoredKillers.map(x=>x.p.name))];
          const alertKey="pvp-kill-alert:"+at+":"+victimName.toLowerCase();
          const within=until>now;
          if(within){
            const left=minsLeft(until,now);
            const body=(killerNames.length===1?killerNames[0]:killerNames.join(", "))+" matou "+victimName+". Janela de revide até "+new Date(until).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"})+" — cerca de "+left+" min restantes.";
            const up=await db.from("alerts").upsert({
              character_id:monitoredKillers[0].target.id,title:"PK KILL DETECTADA",body,triggered_at:nowIso,
              dedupe_key:alertKey,metadata:{rule:"REVENGE_WINDOW",world:WORLD,victim:victimName,kill_at:at,detected_at:nowIso,retaliation_until:new Date(until).toISOString(),remaining_minutes:left,monitored_killers:killerNames,killers,assists,source:"TIBIADATA"}
            },{onConflict:"dedupe_key"}).select("id");
            if(!up.error&&up.data?.length)alerts++;
          }
          found.push({victim:victimName,at,killers:killerNames,within_window:within,retaliation_until:new Date(until).toISOString()});
        }
      }
    }

    const nextConfig={...cfg,pvp_watch_cursor:nextCursor,pvp_watch_recent_seen:seen,pvp_watch_pool_size:pool.length,pvp_watch_batch_size:batch.length,pvp_watch_last_scan_at:nowIso,pvp_watch_last_batch:batch,pvp_watch_mode:"JADEBRA_VICTIM_DEATH_SCAN"};
    if(syncRow?.id){
      await db.from("source_syncs").update({enabled:true,status:"SUCCESS",last_success_at:nowIso,last_error:null,request_count:Number(syncRow.request_count||0)+batch.length+1,next_sync_at:new Date(now+10000).toISOString(),config:nextConfig,updated_at:nowIso}).eq("id",syncRow.id);
    }else{
      await db.from("source_syncs").upsert({source:"TIBIADATA",enabled:true,status:"SUCCESS",last_success_at:nowIso,next_sync_at:new Date(now+10000).toISOString(),request_count:batch.length+1,config:nextConfig,updated_at:nowIso},{onConflict:"source"});
    }

    const {data:ring}=await db.from("source_syncs").select("id,last_error,config").eq("source","TIBIARING").maybeSingle();
    if(ring?.id&&/403/.test(String(ring.last_error||""))){
      await db.from("source_syncs").update({status:"IDLE",last_error:"TibiaRing bloqueou requisições do Vercel (HTTP 403). Fallback de kills pelo TibiaData está ativo.",config:{...(ring.config||{}),degraded:true,fallback:"TIBIADATA_PVP_WATCH"},updated_at:nowIso}).eq("id",ring.id);
    }

    return res.status(200).json({ok:true,online:current.length,pool:pool.length,scanned:batch.length,savedDeaths,savedPvp,alerts,found,nextCursor});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await db.from("source_syncs").update({status:"ERROR",last_error:"PvP watch: "+msg,updated_at:nowIso}).eq("source","TIBIADATA");
    return res.status(500).json({error:msg});
  }
}
