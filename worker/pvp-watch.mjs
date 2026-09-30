const WORLD="Jadebra";
const WORLD_API="https://api.tibiadata.com/v4/world/";
const CHAR_API="https://api.tibiadata.com/v4/character/";
const UA="PK-Radar-Worker/5.0";
const BATCH=12,RECENT_TTL=20*60*1000,LOOKBACK=30*60*1000,REVENGE=15*60*1000;
let busy=false;
function onlineNames(j){const list=j?.world?.online_players??j?.world?.players_online??j?.worlds?.players_online??j?.players_online??[];return (Array.isArray(list)?list:[]).map(x=>String((x?.name??x)||"").trim()).filter(Boolean)}
function deaths(j){const root=j?.character??j?.characters??j??{};return Array.isArray(root?.deaths)?root.deaths:Array.isArray(root?.data?.deaths)?root.data.deaths:[]}
function players(list,role){return (Array.isArray(list)?list:[]).filter(x=>x?.player!==false&&x?.name).map(x=>({name:String(x.name).trim(),player:true,role,traded:Boolean(x.traded),summon:x.summon||null}))}
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
async function getJson(url){const r=await fetch(url,{headers:{accept:"application/json","user-agent":UA}});if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return r.json()}
export async function watchPvpKills(db){
  if(busy)return {busy:true};busy=true;
  const now=Date.now(),nowIso=new Date(now).toISOString();
  try{
    const [{data:targets,error:te},{data:sync,error:se}]=await Promise.all([
      db.from("characters").select("id,name,worlds(name)").eq("archived",false).eq("monitored",true),
      db.from("source_syncs").select("id,config,request_count").eq("source","TIBIADATA").maybeSingle()
    ]);
    if(te)throw te;if(se)throw se;
    const active=(targets??[]).filter(x=>x.worlds?.name===WORLD),targetByName=new Map(active.map(x=>[String(x.name).toLowerCase(),x]));
    if(!active.length)return {scanned:0};
    const world=await getJson(WORLD_API+encodeURIComponent(WORLD)),current=onlineNames(world);
    const cfg=sync?.config&&typeof sync.config==="object"?sync.config:{};
    const seen={...(cfg.worker_pvp_recent_seen||{})};for(const n of current)seen[n]=nowIso;
    for(const [n,at] of Object.entries(seen)){const t=new Date(String(at)).getTime();if(!Number.isFinite(t)||now-t>RECENT_TTL)delete seen[n]}
    const pool=[...new Set([...current,...Object.keys(seen)])].sort((a,b)=>a.localeCompare(b));
    let cursor=Number(cfg.worker_pvp_cursor||0);if(cursor>=pool.length)cursor=0;
    const batch=[];for(let i=0;i<Math.min(BATCH,pool.length);i++)batch.push(pool[(cursor+i)%pool.length]);
    const next=pool.length?(cursor+batch.length)%pool.length:0;
    const results=await Promise.all(batch.map(async victim=>{try{return {victim,data:await getJson(CHAR_API+encodeURIComponent(victim))}}catch(error){return {victim,error:String(error)}}}));
    let alerts=0;
    for(const result of results){
      if(!result.data)continue;
      for(const d of deaths(result.data)){
        const at=iso(d?.time);if(!at)continue;const ts=new Date(at).getTime();if(now-ts>LOOKBACK||ts>now+60000)continue;
        const killers=players(d?.killers,"KILLER"),assists=players(d?.assists,"ASSIST"),participants=[...killers,...assists];
        const monitored=participants.map(p=>({p,target:targetByName.get(p.name.toLowerCase())})).filter(x=>x.target);
        if(!monitored.length)continue;
        const victim=result.victim,victimTarget=targetByName.get(victim.toLowerCase());
        await db.from("death_events").upsert({character_id:victimTarget?.id??null,occurred_at:at,level:Number(d?.level)||null,killers:participants,source:"TIBIADATA",confidence:"HIGH",reference_url:CHAR_API+encodeURIComponent(victim),raw_data:{world:WORLD,victim,reason:d?.reason||null,killers,assists,detected_at:nowIso},dedupe_key:"pvp-death:"+at+":"+victim.toLowerCase()},{onConflict:"dedupe_key"});
        for(const {p,target} of monitored)await db.from("pvp_events").upsert({character_id:target.id,opponent_name:victim,role:p.role,occurred_at:at,source:"TIBIADATA",confidence:"HIGH",reference_url:CHAR_API+encodeURIComponent(victim),raw_data:{world:WORLD,victim,killers,assists,detected_at:nowIso},dedupe_key:"pvp-event:"+target.id+":"+at+":"+victim.toLowerCase()+":"+p.role.toLowerCase()},{onConflict:"dedupe_key"});
        const monitoredKillers=killers.map(p=>({p,target:targetByName.get(p.name.toLowerCase())})).filter(x=>x.target);
        const until=ts+REVENGE;
        if(monitoredKillers.length&&until>now){
          const names=[...new Set(monitoredKillers.map(x=>x.p.name))],left=Math.max(1,Math.ceil((until-now)/60000));
          const body=(names.length===1?names[0]:names.join(", "))+" matou "+victim+". Janela de revide até "+new Date(until).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"})+" — cerca de "+left+" min restantes.";
          const up=await db.from("alerts").upsert({character_id:monitoredKillers[0].target.id,title:"PK KILL DETECTADA",body,triggered_at:nowIso,dedupe_key:"pvp-kill-alert:"+at+":"+victim.toLowerCase(),metadata:{rule:"REVENGE_WINDOW",world:WORLD,victim,kill_at:at,detected_at:nowIso,retaliation_until:new Date(until).toISOString(),remaining_minutes:left,monitored_killers:names,killers,assists,source:"TIBIADATA"}},{onConflict:"dedupe_key"}).select("id");
          if(!up.error&&up.data?.length)alerts++;
        }
      }
    }
    const nextCfg={...cfg,worker_pvp_cursor:next,worker_pvp_recent_seen:seen,worker_pvp_pool_size:pool.length,worker_pvp_batch_size:batch.length,worker_pvp_last_scan_at:nowIso};
    if(sync?.id)await db.from("source_syncs").update({enabled:true,status:"SUCCESS",last_success_at:nowIso,last_error:null,request_count:Number(sync.request_count||0)+batch.length+1,next_sync_at:new Date(now+10000).toISOString(),config:nextCfg,updated_at:nowIso}).eq("id",sync.id);
    return {scanned:batch.length,pool:pool.length,alerts};
  }finally{busy=false}
}
