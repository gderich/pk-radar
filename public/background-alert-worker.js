let running=false;
let busy=false;
let timer=null;
let cfg={origin:"",supabaseUrl:"",anonKey:"",token:"",lastSeen:new Date(Date.now()-5*60*1000).toISOString()};
const ALERT_TITLES=new Set(["PK KILL DETECTADA","MASS LOG DETECTADO","SUSPEITO IDENTIFICADO"]);

function schedule(delay=9000){
  if(!running)return;
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>void tick(),delay);
}
async function triggerPrivateScan(){
  if(!cfg.origin||!cfg.token)return;
  const r=await fetch(cfg.origin+"/api/pvp-watch",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+cfg.token},body:"{}"});
  if(!r.ok&&r.status!==429)throw new Error("pvp-watch HTTP "+r.status);
}
async function readAlerts(){
  if(!cfg.supabaseUrl||!cfg.anonKey||!cfg.token)return;
  const query=new URLSearchParams({select:"id,title,body,triggered_at,metadata",order:"triggered_at.asc",limit:"50"});
  query.append("triggered_at","gt."+cfg.lastSeen);
  const r=await fetch(cfg.supabaseUrl+"/rest/v1/alerts?"+query.toString(),{headers:{apikey:cfg.anonKey,authorization:"Bearer "+cfg.token,accept:"application/json"}});
  if(!r.ok){if(r.status===401)return;throw new Error("alerts HTTP "+r.status)}
  const rows=await r.json();
  for(const alert of Array.isArray(rows)?rows:[]){
    if(alert?.triggered_at){cfg.lastSeen=alert.triggered_at;self.postMessage({type:"lastSeen",value:cfg.lastSeen})}
    if(ALERT_TITLES.has(alert?.title))self.postMessage({type:"alert",alert});
  }
}
async function tick(){
  if(!running||busy){schedule();return}
  busy=true;
  try{
    await triggerPrivateScan().catch(e=>self.postMessage({type:"debug",message:String(e?.message||e)}));
    await readAlerts().catch(e=>self.postMessage({type:"debug",message:String(e?.message||e)}));
  }finally{busy=false;schedule()}
}
self.onmessage=event=>{
  const msg=event.data||{};
  if(msg.type==="start"){
    cfg={...cfg,...msg};delete cfg.type;running=true;void tick();return;
  }
  if(msg.type==="token"){cfg.token=String(msg.token||"");return}
  if(msg.type==="tick"){void tick();return}
  if(msg.type==="stop"){running=false;if(timer)clearTimeout(timer);timer=null}
};
