import {createClient} from "@supabase/supabase-js";
import {rebuildAutomaticIdentities} from "../worker/identity.mjs";

function authorized(req){
  const expected=process.env.CRON_SECRET||process.env.MONITOR_CRON_SECRET;
  if(!expected)return {ok:false,code:503,error:"CRON_SECRET is not configured"};
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  return token===expected?{ok:true}:{ok:false,code:401,error:"Unauthorized"};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const auth=authorized(req);if(!auth.ok)return res.status(auth.code).json({error:auth.error});
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(503).json({error:"Supabase server credentials are not configured"});
  const db=createClient(url,key,{auth:{persistSession:false}});
  try{
    const result=await rebuildAutomaticIdentities(db);
    const {data:row}=await db.from("source_syncs").select("id,config").eq("source","MANUAL").maybeSingle();
    const config=(row?.config&&typeof row.config==="object")?row.config:{};
    const next={
      ...config,
      identity_mapping_version:6,
      evidence_cleanup_v6_at:new Date().toISOString(),
      evidence_cleanup_v6_removed:Number(result?.cleanup?.removed||0),
      evidence_cleanup_v6_removed_names:result?.cleanup?.removedNames??[],
      evidence_cleanup_v6_reachable:Number(result?.cleanup?.reachable||0),
      evidence_cleanup_v6_rule:"ANCHOR_REACHABILITY_MATCH_COUNT_ONLY",
      score_model:"MATCH_COUNT_ONLY_V2"
    };
    if(row?.id)await db.from("source_syncs").update({config:next,updated_at:new Date().toISOString()}).eq("id",row.id);
    else await db.from("source_syncs").upsert({source:"MANUAL",enabled:true,status:"SUCCESS",config:next,updated_at:new Date().toISOString()},{onConflict:"source"});
    return res.status(200).json({ok:true,...result});
  }catch(e){
    console.error("mapping-cleanup",e);
    return res.status(500).json({error:e instanceof Error?e.message:String(e)});
  }
}
