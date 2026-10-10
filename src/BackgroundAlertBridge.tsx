import {useEffect} from "react";
import {supabase} from "./lib/supabase";

type WorkerAlert={id:string;title:string;body:string;triggered_at:string;metadata?:Record<string,unknown>};

export default function BackgroundAlertBridge(){
  useEffect(()=>{
    if(window.location.pathname.startsWith("/publico"))return;
    let alive=true;
    let worker:Worker|null=null;
    let currentToken="";

    const notify=(alert:WorkerAlert)=>{
      if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
      try{
        const sticky=alert.title==="PK KILL DETECTADA"||alert.title==="MASS LOG DETECTADO"||alert.title==="SUSPEITO IDENTIFICADO";
        const n=new Notification("PK Radar — "+alert.title,{body:alert.body,tag:"pk-radar-bg-"+alert.id,requireInteraction:sticky,silent:false});
        if(!sticky)window.setTimeout(()=>n.close(),15000);
      }catch(e){console.warn("Background notification",e)}
    };

    const start=async()=>{
      const {data}=await supabase.auth.getSession();
      const session=data.session;
      if(!alive||!session)return;
      currentToken=session.access_token;
      try{
        worker=new Worker("/background-alert-worker.js");
        worker.onmessage=(event:MessageEvent)=>{
          const msg=event.data??{};
          if(msg.type==="alert"&&msg.alert)notify(msg.alert as WorkerAlert);
          if(msg.type==="lastSeen"&&msg.value)localStorage.setItem("pkBackgroundAlertLastSeen",String(msg.value));
          if(msg.type==="debug"&&msg.message)console.debug("Background alert worker",msg.message);
        };
        worker.onerror=e=>console.warn("Background alert worker",e);
        worker.postMessage({
          type:"start",
          origin:window.location.origin,
          supabaseUrl:import.meta.env.VITE_SUPABASE_URL,
          anonKey:import.meta.env.VITE_SUPABASE_ANON_KEY,
          token:session.access_token,
          lastSeen:localStorage.getItem("pkBackgroundAlertLastSeen")||new Date(Date.now()-5*60*1000).toISOString()
        });
      }catch(e){console.warn("Não foi possível iniciar worker de alertas",e)}
    };

    void start();
    const {data:auth}=supabase.auth.onAuthStateChange((_event,session)=>{
      const next=session?.access_token||"";
      if(next&&next!==currentToken){currentToken=next;worker?.postMessage({type:"token",token:next})}
    });
    const wake=()=>worker?.postMessage({type:"tick"});
    document.addEventListener("visibilitychange",wake);
    window.addEventListener("focus",wake);
    window.addEventListener("pageshow",wake);
    window.addEventListener("online",wake);
    return()=>{
      alive=false;
      worker?.postMessage({type:"stop"});
      worker?.terminate();
      auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange",wake);
      window.removeEventListener("focus",wake);
      window.removeEventListener("pageshow",wake);
      window.removeEventListener("online",wake);
    };
  },[]);
  return null;
}
