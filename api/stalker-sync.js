import {createClient} from "@supabase/supabase-js";

const API="https://api.tibiastalker.pl/api/tibia-stalker/v1/characters/";

function dateOnly(v){const s=String(v||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null}
function spanDays(first,last){if(!first||!last)return 0;const a=new Date(first+"T00:00:00Z").getTime(),b=new Date(last+"T00:00:00Z").getTime();return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.round((b-a)/86400000)):0}
function evidence(matches,first,last){const m=Number(matches||0),span=spanDays(first,last);return {autoDiscover:m>=80||(m>=30&&span>=7),autoGroup:m>=100||(m>=50&&span>=7),span}}

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
  const rows=items.map(x=>({
    character_id:character.id,
    suggested_name:String(x.otherCharacterName||"").trim(),
    match_count:Number(x.numberOfMatches||0),
    first_match_date:dateOnly(x.firstMatchDateOnly),
    last_match_date:dateOnly(x.lastMatchDateOnly),
    relative_score:0,
    fetched_at:new Date().toISOString(),
    raw_data:{...x,scoreModel:"MATCH_COUNT_ONLY_V2"}
  })).filter(x=>x.suggested_name);
  let persistError=null;
  if(rows.length){
    const {error}=await db.from("stalker_suggestions").upsert(rows,{onConflict:"character_id,suggested_name"});
    if(error)persistError=error.message;
  }
  let autoAdded=0;
  for(const x of rows.filter(x=>evidence(x.match_count,x.first_match_date,x.last_match_date).autoDiscover).sort((a,b)=>b.match_count-a.match_count).slice(0,2)){
    const {data:existing}=await db.from("characters").select("id").ilike("name",x.suggested_name).maybeSingle();
    if(existing)continue;
    const {error}=await db.from("characters").insert({name:x.suggested_name,monitored:true,source:"TIBIA_STALKER",data_state:"AUTO_DESCOBERTO",confidence:"MEDIUM",tags:["AUTO_DISCOVERED"]});
    if(!error)autoAdded++;
  }
  return {rows,persistError,autoAdded};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!url||!key)return res.status(500).json({error:"Supabase environment variables are missing on Vercel"});
  const authHeader=req.headers.authorization||"";
  const db=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:authHeader}}});
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
      try{const x=await syncOne(db,c);out.push({characterId:c.id,name:c.name,items:x.rows,persistError:x.persistError,autoAdded:x.autoAdded})}
      catch(e){out.push({characterId:c.id,name:c.name,error:e instanceof Error?e.message:String(e),items:[]})}
      await new Promise(r=>setTimeout(r,250));
    }
    return res.status(200).json({ok:true,results:out});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:String(e)});
  }
}
