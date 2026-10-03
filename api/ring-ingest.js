import {createClient} from "@supabase/supabase-js";

const WORLD="Jadebra";
const REVENGE_MS=15*60*1000;

function keyName(v){return String(v||"").trim().toLowerCase().replace(/\s+/g," ")}
function authorized(req){
  const expected=process.env.CRON_SECRET||process.env.MONITOR_CRON_SECRET;
  if(!expected)return {ok:false,code:503,error:"CRON_SECRET is not configured"};
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  return token===expected?{ok:true}:{ok:false,code:401,error:"Unauthorized"};
}
function escapeHtml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
async function sendTelegram(item){
  const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId)return {sent:false,reason:"telegram_not_configured"};
  const at=new Date(item.occurredAt).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"});
  const until=new Date(item.retaliationUntil).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"});
  const killers=item.monitoredKillers.map(escapeHtml).join(", ");
  const text=["🚨 <b>PK KILL DETECTADA</b>","","⚔️ <b>"+killers+"</b> matou <b>"+escapeHtml(item.victim)+"</b>","🕒 Kill às "+at,"⏳ Revide até <b>"+until+"</b>","🔥 Aproximadamente <b>"+item.remainingMinutes+" min</b> restantes","📡 Fonte: TibiaRing"].join("\n");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true})});
  if(!r.ok)throw new Error("Telegram HTTP "+r.status);
  return {sent:true};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const auth=authorized(req);if(!auth.ok)return res.status(auth.code).json({error:auth.error});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return res.status(503).json({error:"Supabase server credentials are not configured"});
  const db=createClient(url,secret,{auth:{persistSession:false}});

  try{
    const events=Array.isArray(req.body?.events)?req.body.events:[];
    if(!events.length)return res.status(200).json({ok:true,received:0,saved:0,newAlerts:0});

    const {data:targets,error:te}=await db.from("characters").select("id,name,monitored,archived,worlds(name)").eq("archived",false).eq("monitored",true);
    if(te)throw te;
    const active=(targets??[]).filter(x=>x.worlds?.name===WORLD);
    const targetByName=new Map(active.map(x=>[keyName(x.name),x]));
    let saved=0,newAlerts=0,newPvp=0;
    const alerts=[];

    for(const ev of events.slice(0,250)){
      const at=new Date(ev?.occurredAt||0);if(!Number.isFinite(at.getTime()))continue;
      const victim=String(ev?.victim||"").trim();if(!victim)continue;
      const participants=(Array.isArray(ev?.participants)?ev.participants:[]).map((p,i)=>({
        name:String(p?.name||"").trim(),
        level:Number(p?.level)||null,
        role:String(p?.role|| (i===0?"KILLER":"ASSIST")).toUpperCase()==="KILLER"?"KILLER":"ASSIST",
        player:p?.player!==false
      })).filter(p=>p.name&&p.player);
      if(!participants.length)continue;

      const monitored=participants.map(p=>({p,target:targetByName.get(keyName(p.name))})).filter(x=>x.target);
      if(!monitored.length)continue;

      const occurredAt=at.toISOString();
      const victimTarget=targetByName.get(keyName(victim));
      const deathKey="pvp-death:"+occurredAt+":"+keyName(victim);
      const {data:existingDeath}=await db.from("death_events").select("id").eq("dedupe_key",deathKey).maybeSingle();
      const upDeath=await db.from("death_events").upsert({
        character_id:victimTarget?.id??null,
        occurred_at:occurredAt,
        level:Number(ev?.victimLevel)||null,
        killers:participants,
        source:"TIBIARING",
        confidence:"HIGH",
        reference_url:String(ev?.referenceUrl||"https://www.tibiaring.com/"),
        raw_data:{world:WORLD,victim,sourceCharacter:ev?.sourceCharacter??null,participants,scanner:"RING_DIRECT_V1"},
        dedupe_key:deathKey
      },{onConflict:"dedupe_key"});
      if(upDeath.error)throw upDeath.error;
      if(!existingDeath)saved++;

      for(const {p,target} of monitored){
        const pvpKey="pvp-event:"+target.id+":"+occurredAt+":"+keyName(victim)+":"+p.role.toLowerCase();
        const {data:existing}=await db.from("pvp_events").select("id").eq("dedupe_key",pvpKey).maybeSingle();
        const up=await db.from("pvp_events").upsert({
          character_id:target.id,opponent_name:victim,role:p.role,occurred_at:occurredAt,
          source:"TIBIARING",confidence:"HIGH",reference_url:String(ev?.referenceUrl||"https://www.tibiaring.com/"),
          raw_data:{victim,world:WORLD,participants,sourceCharacter:ev?.sourceCharacter??null,scanner:"RING_DIRECT_V1"},
          dedupe_key:pvpKey
        },{onConflict:"dedupe_key"});
        if(up.error)throw up.error;if(!existing)newPvp++;
      }

      const monitoredKillers=monitored.filter(x=>x.p.role==="KILLER");
      const until=at.getTime()+REVENGE_MS,now=Date.now();
      if(monitoredKillers.length&&until>now){
        const names=[...new Set(monitoredKillers.map(x=>x.p.name))];
        const alertKey="pvp-kill-alert:"+occurredAt+":"+keyName(victim);
        const {data:existingAlert}=await db.from("alerts").select("id").eq("dedupe_key",alertKey).maybeSingle();
        if(!existingAlert){
          const left=Math.max(1,Math.ceil((until-now)/60000));
          const body=(names.length===1?names[0]:names.join(", "))+" matou "+victim+". Janela de revide até "+new Date(until).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"})+" — cerca de "+left+" min restantes.";
          const up=await db.from("alerts").insert({
            character_id:monitoredKillers[0].target.id,title:"PK KILL DETECTADA",body,triggered_at:new Date().toISOString(),
            dedupe_key:alertKey,metadata:{rule:"REVENGE_WINDOW",world:WORLD,victim,kill_at:occurredAt,retaliation_until:new Date(until).toISOString(),remaining_minutes:left,monitored_killers:names,participants,source:"TIBIARING"}
          });
          if(up.error)throw up.error;
          newAlerts++;
          const item={victim,occurredAt,retaliationUntil:new Date(until).toISOString(),remainingMinutes:left,monitoredKillers:names};
          let telegram={sent:false,reason:"not_attempted"};try{telegram=await sendTelegram(item)}catch(e){telegram={sent:false,error:e instanceof Error?e.message:String(e)}}
          alerts.push({...item,telegram});
        }
      }
    }

    const nowIso=new Date().toISOString();
    await db.from("source_syncs").upsert({
      source:"TIBIARING",enabled:true,status:"SUCCESS",last_success_at:nowIso,last_error:null,updated_at:nowIso,
      config:{direct_kill_monitor:true,last_direct_scan_at:nowIso,last_direct_saved:saved,last_direct_pvp:newPvp,last_direct_alerts:newAlerts}
    },{onConflict:"source"});

    return res.status(200).json({ok:true,received:events.length,saved,newPvp,newAlerts,alerts});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    try{await db.from("source_syncs").upsert({source:"TIBIARING",enabled:true,status:"ERROR",last_error:"Direct ring ingest: "+msg,updated_at:new Date().toISOString()},{onConflict:"source"})}catch{}
    return res.status(500).json({error:msg});
  }
}
