import {createClient} from "@supabase/supabase-js";

const API="https://api.tibiastalker.pl/api/tibia-stalker/v1/characters/";

function dateOnly(v){const s=String(v||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null}

async function authUser(req,db){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token)return null;
  const {data}=await db.auth.getUser(token);
  return data?.user||null;
}

async function syncOne(db,character){
  const r=await fetch(API+encodeURIComponent(character.name),{headers:{accept:"application/json"}});
  if(!r.ok)throw new Error("Tibia Stalker HTTP "+r.status);
  const j=await r.json();
  const items=Array.isArray(j?.possibleInvisibleCharacters)?j.possibleInvisibleCharacters:[];
  const max=Math.max(0,...items.map(x=>Number(x.numberOfMatches||0)));
  const rows=items.map(x=>({
    character_id:character.id,
    suggested_name:String(x.otherCharacterName||"").trim(),
    match_count:Number(x.numberOfMatches||0),
    first_match_date:dateOnly(x.firstMatchDateOnly),
    last_match_date:dateOnly(x.lastMatchDateOnly),
    relative_score:max?Math.round(Number(x.numberOfMatches||0)/max*10000)/100:0,
    fetched_at:new Date().toISOString(),
    raw_data:x
  })).filter(x=>x.suggested_name);
  if(rows.length){
    const {error}=await db.from("stalker_suggestions").upsert(rows,{onConflict:"character_id,suggested_name"});
    if(error)throw error;
  }
  return rows;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(500).json({error:"Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY on Vercel"});
  const db=createClient(url,key,{auth:{persistSession:false}});
  const user=await authUser(req,db);
  if(!user)return res.status(401).json({error:"Unauthorized"});
  try{
    const ids=Array.isArray(req.body?.characterIds)?req.body.characterIds.slice(0,12):[];
    const singleId=req.body?.characterId;
    const wanted=singleId?[singleId]:ids;
    if(!wanted.length)return res.status(400).json({error:"characterId or characterIds required"});
    const {data:chars,error}=await db.from("characters").select("id,name").in("id",wanted).eq("monitored",true);
    if(error)throw error;
    const out=[];
    for(const c of chars||[]){
      try{out.push({characterId:c.id,name:c.name,items:await syncOne(db,c)})}
      catch(e){out.push({characterId:c.id,name:c.name,error:e instanceof Error?e.message:String(e),items:[]})}
      await new Promise(r=>setTimeout(r,250));
    }
    return res.status(200).json({ok:true,results:out});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:String(e)});
  }
}
