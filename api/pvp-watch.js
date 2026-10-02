import {createClient} from "@supabase/supabase-js";
import {scanPvpKills} from "../shared/pvp-scan.mjs";

async function authUser(req,url,key){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token)return null;
  const authDb=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:"Bearer "+token}}});
  const {data}=await authDb.auth.getUser(token);
  return data?.user||null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const anon=process.env.VITE_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key=secret||anon;
  if(!url||!key)return res.status(500).json({error:"Supabase environment variables are missing"});

  const user=await authUser(req,url,anon||key);
  if(!user)return res.status(401).json({error:"Unauthorized"});

  const token=(req.headers.authorization||"").replace(/^Bearer\s+/,"");
  const db=secret
    ?createClient(url,secret,{auth:{persistSession:false}})
    :createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:"Bearer "+token}}});

  try{
    const result=await scanPvpKills(db,{batchSize:24,minimumGapMs:8000,caller:"PRIVATE_PANEL"});
    return res.status(200).json(result);
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    try{await db.from("source_syncs").update({status:"ERROR",last_error:"Kill scan: "+msg,updated_at:new Date().toISOString()}).eq("source","TIBIADATA")}catch{}
    return res.status(500).json({error:msg});
  }
}
