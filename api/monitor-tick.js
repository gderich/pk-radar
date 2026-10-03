import {createClient} from "@supabase/supabase-js";
import {scanPvpKills} from "../shared/pvp-scan.mjs";
import {ensureEvidenceCleanupV6,rebuildAutomaticIdentities} from "../worker/identity.mjs";

function authorized(req){
  const expected=process.env.CRON_SECRET||process.env.MONITOR_CRON_SECRET;
  if(!expected)return {ok:false,code:503,error:"CRON_SECRET is not configured"};
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  return token===expected?{ok:true}:{ok:false,code:401,error:"Unauthorized"};
}

function escapeHtml(v){
  return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function sendTelegram(item){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  const chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId)return {sent:false,reason:"telegram_not_configured"};

  const killers=(item.killers??[]).map(escapeHtml);
  const killerText=killers.length?killers.join(", "):"PK monitorado";
  const until=new Date(item.retaliationUntil).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"});
  const at=new Date(item.killAt).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"});
  const text=[
    "🚨 <b>PK KILL DETECTADA</b>",
    "",
    "⚔️ <b>"+killerText+"</b> matou <b>"+escapeHtml(item.victim)+"</b>",
    "🕒 Kill às "+at,
    "⏳ Janela de revide até <b>"+until+"</b>",
    "🔥 Aproximadamente <b>"+Number(item.remainingMinutes||0)+" min</b> restantes"
  ].join("\n");

  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true})
  });
  if(!r.ok)throw new Error("Telegram HTTP "+r.status+" "+await r.text());
  return {sent:true};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"Method not allowed"});

  const auth=authorized(req);
  if(!auth.ok)return res.status(auth.code).json({error:auth.error});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return res.status(503).json({error:"Supabase server credentials are not configured"});

  const db=createClient(url,secret,{auth:{persistSession:false}});
  try{
    const cleanup=await ensureEvidenceCleanupV6(db);
    let mapping=null;
    if(cleanup.ran)mapping=await rebuildAutomaticIdentities(db);
    const result=await scanPvpKills(db,{batchSize:48,minimumGapMs:45000,caller:"SERVER_CRON"});
    const telegram=[];
    for(const item of result.newAlertItems??[]){
      try{telegram.push({victim:item.victim,...await sendTelegram(item)})}
      catch(e){telegram.push({victim:item.victim,sent:false,error:e instanceof Error?e.message:String(e)})}
    }
    return res.status(200).json({...result,telegram,cleanup,mapping});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    try{await db.from("source_syncs").update({status:"ERROR",last_error:"Server cron kill scan: "+msg,updated_at:new Date().toISOString()}).eq("source","TIBIADATA")}catch{}
    return res.status(500).json({error:msg});
  }
}
