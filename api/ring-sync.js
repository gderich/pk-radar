import {createClient} from "@supabase/supabase-js";

const RING="https://www.tibiaring.com/char.php?c=";

function strip(html){return String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim()}
function parseDate(v){if(!v)return null;const d=new Date(String(v).trim().replace(" ","T")+"Z");return Number.isNaN(d.getTime())?null:d.toISOString()}
function playerLike(name){return /^[A-ZÀ-Ý][\p{L}' -]{1,39}$/u.test(String(name||"").trim())}
function combatRows(html){
  const tables=String(html).match(/<table[\s\S]*?<\/table>/gi)||[];
  const table=tables.find(t=>{const x=strip(t);return /(Killed|Victim|Morto|Muerto)/i.test(x)&&/(Killer|Assassino|Asesino)/i.test(x)})||html;
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
    const at=parseDate(cells[0]);const victim=String(cells[1]||"").trim();const victimLevel=Number(cells[2])||null;const killer=String(cells[3]||"").trim();const killerLevel=Number(cells[4])||null;
    if(at&&victim&&!/^(Killed|Victim|Morto|Muerto)$/i.test(victim)){current={at,victim,victimLevel,killers:[]};events.push(current)}
    if(current&&killer&&!/^(Killer|Assassino|Asesino)$/i.test(killer)){
      current.killers.push({name:killer,level:killerLevel,player:playerLike(killer),role:current.killers.length===0?"KILLER":"ASSIST"});
    }
  }
  return events.filter(e=>e.killers.length);
}
async function authUser(req,db){const h=req.headers.authorization||"";const token=h.startsWith("Bearer ")?h.slice(7):"";if(!token)return null;const {data}=await db.auth.getUser(token);return data?.user||null}
async function syncOne(db,ch){
  const url=RING+encodeURIComponent(ch.name)+"&lang=en";
  const r=await fetch(url,{headers:{"user-agent":"PK-Radar/4.0 (+https://pk-radar.vercel.app)","accept":"text/html"}});
  if(!r.ok)throw new Error("TibiaRing HTTP "+r.status);
  const html=await r.text();const events=parseCombat(html);let saved=0;
  for(const ev of events){
    const players=[];const seen=new Set();
    for(const k of ev.killers){if(!k.player)continue;const key=k.name.toLowerCase();if(seen.has(key))continue;seen.add(key);players.push(k)}
    if(!players.length)continue;
    const {data:victimChar}=await db.from("characters").select("id").ilike("name",ev.victim).maybeSingle();
    const dedupe="pvp-death:"+ev.at+":"+ev.victim.toLowerCase();
    const payload={character_id:victimChar?.id??null,occurred_at:ev.at,level:ev.victimLevel,killers:players,source:"TIBIARING",confidence:"HIGH",reference_url:url,raw_data:{victim:ev.victim,victimLevel:ev.victimLevel,world:"Jadebra",sourceCharacter:ch.name,allKillers:ev.killers},dedupe_key:dedupe};
    const up=await db.from("death_events").upsert(payload,{onConflict:"dedupe_key"});
    if(up.error)throw up.error;saved++;
    for(const [idx,k] of players.entries()){
      const {data:kc}=await db.from("characters").select("id,monitored").ilike("name",k.name).maybeSingle();
      if(kc?.id){
        await db.from("pvp_events").upsert({character_id:kc.id,opponent_name:ev.victim,role:idx===0?"KILLER":"ASSIST",occurred_at:ev.at,source:"TIBIARING",confidence:"HIGH",reference_url:url,raw_data:{victim:ev.victim,participants:players},dedupe_key:"pvp-event:"+kc.id+":"+ev.at+":"+ev.victim.toLowerCase()+":"+(idx===0?"killer":"assist")},{onConflict:"dedupe_key"});
      }
    }
  }
  await db.from("source_syncs").update({enabled:true,status:"SUCCESS",last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("source","TIBIARING");
  return {events:events.length,saved};
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!url||!key)return res.status(500).json({error:"Supabase environment variables are missing"});
  const authHeader=req.headers.authorization||"";const db=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:authHeader}}});
  const user=await authUser(req,db);if(!user)return res.status(401).json({error:"Unauthorized"});
  try{
    const id=req.body?.characterId;if(!id)return res.status(400).json({error:"characterId required"});
    const {data:ch,error}=await db.from("characters").select("id,name,monitored,worlds(name)").eq("id",id).single();if(error)throw error;
    if(!ch?.monitored||ch.worlds?.name!=="Jadebra")return res.status(400).json({error:"Character is not an active Jadebra target"});
    const result=await syncOne(db,ch);return res.status(200).json({ok:true,name:ch.name,...result});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(/HTTP 403/.test(msg)){
      await db.from("source_syncs").update({enabled:true,status:"IDLE",last_error:"TibiaRing bloqueou requisições do Vercel (HTTP 403). Fallback de kills pelo TibiaData está ativo.",config:{degraded:true,fallback:"TIBIADATA_PVP_WATCH"},updated_at:new Date().toISOString()}).eq("source","TIBIARING");
      return res.status(200).json({ok:false,degraded:true,fallback:"TIBIADATA",error:msg});
    }
    await db.from("source_syncs").update({enabled:true,status:"ERROR",last_error:msg,updated_at:new Date().toISOString()}).eq("source","TIBIARING");
    return res.status(500).json({error:msg});
  }
}
