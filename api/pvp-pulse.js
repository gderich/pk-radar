import {createClient} from "@supabase/supabase-js";
import {scanPvpKills} from "../shared/pvp-scan.mjs";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return res.status(503).json({error:"Kill monitor backend is not configured"});

  const db=createClient(url,secret,{auth:{persistSession:false}});
  try{
    const result=await scanPvpKills(db,{batchSize:24,minimumGapMs:12000,caller:"PUBLIC_PULSE"});
    return res.status(200).json(result);
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    try{await db.from("source_syncs").update({status:"ERROR",last_error:"Public kill pulse: "+msg,updated_at:new Date().toISOString()}).eq("source","TIBIADATA")}catch{}
    return res.status(500).json({error:msg});
  }
}
