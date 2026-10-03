const BASE=(process.env.PK_RADAR_BASE_URL||"https://pk-radar.vercel.app").replace(/\/$/,"");
const SECRET=process.env.CRON_SECRET||"";
const RING="https://www.tibiaring.com/char.php?c=";
const LOOKBACK_MS=24*60*60*1000;

if(!SECRET){console.error("CRON_SECRET missing");process.exit(2)}

function strip(html){return String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim()}
function lastSunday(year,monthIndex){const d=new Date(Date.UTC(year,monthIndex+1,0));return d.getUTCDate()-d.getUTCDay()}
function parseRingDate(v){
  const m=String(v||"").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(!m)return null;
  const y=+m[1],mo=+m[2],d=+m[3],h=+(m[4]||0),mi=+(m[5]||0),s=+(m[6]||0);
  const marchEnd=lastSunday(y,2),octEnd=lastSunday(y,9);
  let cest=false;
  if(mo>3&&mo<10)cest=true;
  else if(mo===3)cest=d>marchEnd||(d===marchEnd&&h>=2);
  else if(mo===10)cest=d<octEnd||(d===octEnd&&h<3);
  const offsetHours=cest?2:1;
  return new Date(Date.UTC(y,mo-1,d,h-offsetHours,mi,s)).toISOString();
}
function playerLike(name){return /^[A-ZÀ-Ý][\p{L}' -]{1,49}$/u.test(String(name||"").trim())}
function combatRows(html){
  const tables=String(html).match(/<table[\s\S]*?<\/table>/gi)||[];
  const table=tables.find(t=>{const x=strip(t);return /(Killed|Victim|Morto|Muerto|Dead)/i.test(x)&&/(Killer|Matador|Assassino|Asesino)/i.test(x)})||"";
  const out=[];
  for(const row of String(table).match(/<tr[\s\S]*?<\/tr>/gi)||[]){
    const cells=[...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>strip(m[1]));
    if(cells.length>=4)out.push(cells);
  }
  return out;
}
function parseCombat(html){
  const events=[];let current=null;
  for(const cells of combatRows(html)){
    const at=parseRingDate(cells[0]);
    const victim=String(cells[1]||"").trim();
    const victimLevel=Number(String(cells[2]||"").replace(/\D/g,""))||null;
    const killer=String(cells[3]||"").trim();
    const killerLevel=Number(String(cells[4]||"").replace(/\D/g,""))||null;
    if(at&&victim&&!/^(Killed|Victim|Morto|Muerto|Dead)$/i.test(victim)){
      current={occurredAt:at,victim,victimLevel,participants:[]};
      events.push(current);
    }
    if(current&&killer&&!/^(Killer|Matador|Assassino|Asesino)$/i.test(killer)){
      current.participants.push({name:killer,level:killerLevel,player:playerLike(killer),role:current.participants.length===0?"KILLER":"ASSIST"});
    }
  }
  return events.filter(e=>e.participants.length);
}
async function getJson(url,options={}){
  const r=await fetch(url,options);const txt=await r.text();
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url+" "+txt.slice(0,180));
  return txt?JSON.parse(txt):{};
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
function mergeEvents(events){
  const m=new Map();
  for(const e of events){
    const k=e.occurredAt+"|"+e.victim.toLowerCase();
    let row=m.get(k);
    if(!row){row={...e,participants:[]};m.set(k,row)}
    const names=new Set(row.participants.map(p=>p.name.toLowerCase()));
    for(const p of e.participants)if(!names.has(p.name.toLowerCase())){row.participants.push(p);names.add(p.name.toLowerCase())}
  }
  return [...m.values()];
}

const headers={Authorization:"Bearer "+SECRET,accept:"application/json"};
const targets=await getJson(BASE+"/api/monitor-targets",{headers});
const chars=Array.isArray(targets.characters)?targets.characters:[];
chars.sort((a,b)=>Number(b.online)-Number(a.online)||String(a.name).localeCompare(String(b.name)));
console.log("TibiaRing direct scan: "+chars.length+" monitored chars");

const now=Date.now();
const scans=await mapLimit(chars,4,async ch=>{
  const url=RING+encodeURIComponent(ch.name)+"&lang=en";
  try{
    const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; PK-Radar/7.0; +https://pk-radar.vercel.app)","accept":"text/html,application/xhtml+xml"}});
    const html=await r.text();
    if(!r.ok)throw new Error("HTTP "+r.status);
    const events=parseCombat(html).filter(e=>{
      const ts=new Date(e.occurredAt).getTime();
      const involved=e.participants.some(p=>p.name.toLowerCase()===String(ch.name).toLowerCase());
      return involved&&now-ts<=LOOKBACK_MS&&ts<=now+2*60*1000;
    }).map(e=>({...e,sourceCharacter:ch.name,referenceUrl:url}));
    return {name:ch.name,status:r.status,events};
  }catch(e){return {name:ch.name,error:e instanceof Error?e.message:String(e),events:[]}}
});

const errors=scans.filter(x=>x.error);
if(errors.length)console.warn("TibiaRing errors:",errors.slice(0,10));
const events=mergeEvents(scans.flatMap(x=>x.events));
console.log("Recent direct combat events found:",events.length);

let saved=0,newAlerts=0;
for(let i=0;i<events.length;i+=80){
  const batch=events.slice(i,i+80);
  const out=await getJson(BASE+"/api/ring-ingest",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({events:batch})});
  saved+=Number(out.saved||0);newAlerts+=Number(out.newAlerts||0);
  if(out.alerts?.length)console.log("New alerts:",JSON.stringify(out.alerts));
}
console.log(JSON.stringify({ok:true,targets:chars.length,ringErrors:errors.length,events:events.length,saved,newAlerts}));
