import {createClient} from "@supabase/supabase-js";
import {rebuildAutomaticIdentities} from "../worker/identity.mjs";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  if(String(req.query?.confirm||"")!=="v5")return res.status(400).json({error:"confirm=v5 required"});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(503).json({error:"Supabase server credentials are not configured"});
  const db=createClient(url,key,{auth:{persistSession:false}});
  try{
    const {data:row,error}=await db.from("source_syncs").select("id,config").eq("source","MANUAL").maybeSingle();
    if(error)throw error;
    const config=(row?.config&&typeof row.config==="object")?row.config:{};
    if(Number(config.identity_mapping_version||0)>=5)return res.status(200).json({ok:true,already:true,version:Number(config.identity_mapping_version)});
    const result=await rebuildAutomaticIdentities(db);
    const next={...config,identity_mapping_version:5,evidence_cleanup_at:new Date().toISOString(),evidence_cleanup_removed:Number(result?.cleanup?.removed||0),evidence_cleanup_removed_names:result?.cleanup?.removedNames??[],evidence_cleanup_reachable:Number(result?.cleanup?.reachable||0),score_model:"MATCH_COUNT_ONLY_V2"};
    if(row?.id){const u=await db.from("source_syncs").update({config:next}).eq("id",row.id);if(u.error)throw u.error}
    else{const u=await db.from("source_syncs").upsert({source:"MANUAL",enabled:true,status:"SUCCESS",config:next},{onConflict:"source"});if(u.error)throw u.error}
    return res.status(200).json({ok:true,already:false,...result});
  }catch(e){
    console.error("one-time-cleanup",e);
    return res.status(500).json({error:e instanceof Error?e.message:String(e)});
  }
}
