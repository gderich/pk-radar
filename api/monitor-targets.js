import {createClient} from "@supabase/supabase-js";

function authorized(req){
  const expected=process.env.CRON_SECRET||process.env.MONITOR_CRON_SECRET;
  if(!expected)return {ok:false,code:503,error:"CRON_SECRET is not configured"};
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  return token===expected?{ok:true}:{ok:false,code:401,error:"Unauthorized"};
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const auth=authorized(req);if(!auth.ok)return res.status(auth.code).json({error:auth.error});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return res.status(503).json({error:"Supabase server credentials are not configured"});

  const db=createClient(url,secret,{auth:{persistSession:false}});
  try{
    const {data,error}=await db.from("characters")
      .select("name,online,last_event_at,last_login_at,level,worlds(name)")
      .eq("archived",false).eq("monitored",true).order("name");
    if(error)throw error;
    const chars=(data??[]).filter(x=>x.worlds?.name==="Jadebra").map(x=>({
      name:x.name,online:Boolean(x.online),lastEventAt:x.last_event_at??null,lastLoginAt:x.last_login_at??null,level:x.level??null
    }));
    return res.status(200).json({world:"Jadebra",characters:chars,updatedAt:new Date().toISOString()});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:String(e)});
  }
}
