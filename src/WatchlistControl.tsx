import {useEffect,useMemo,useState} from "react";
import {Eye,RefreshCw,ShieldAlert,Skull,X} from "lucide-react";
import {supabase} from "./lib/supabase";
import {getStalkerCharacter,getTibiaDataCharacter} from "./lib/tibia";

const WORLD="Jadebra";
const WATCH="WATCHLIST";
const SUSPECT="WATCH_SUSPECT";
function norm(v:string){return String(v||"").trim().toLowerCase()}
function hasTag(c:any,t:string){return Array.isArray(c?.tags)&&c.tags.includes(t)}
function isWatch(c:any){return hasTag(c,WATCH)||hasTag(c,SUSPECT)}
function infoFromTibia(j:any){const root=j?.character||j?.characters||j||{};return root?.character||root?.data||root||{}}
function accountChars(j:any){const root=j?.character||j?.characters||j||{};const list=root?.other_characters??root?.otherCharacters??root?.data?.other_characters??root?.data?.otherCharacters??[];return (Array.isArray(list)?list:[]).map((x:any)=>typeof x==="string"?x:String(x?.name||"")).map((x:string)=>x.trim()).filter(Boolean)}

export default function WatchlistControl(){
  const [session,setSession]=useState<any>(null);
  const [open,setOpen]=useState(false);
  const [name,setName]=useState("");
  const [rows,setRows]=useState<any[]>([]);
  const [pkRows,setPkRows]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);
  const [checking,setChecking]=useState<string|null>(null);
  const hidden=window.location.pathname.startsWith("/publico");

  async function load(){
    const {data,error}=await supabase.from("characters").select("id,name,tags,monitored,archived,online,level,vocation,data_state,confidence,world_id,worlds(name)").eq("archived",false).order("name");
    if(error)throw error;
    const all=data??[];
    setRows(all.filter(isWatch).filter((c:any)=>c.worlds?.name===WORLD));
    setPkRows(all.filter((c:any)=>c.monitored&&c.worlds?.name===WORLD&&!isWatch(c)));
  }

  useEffect(()=>{let alive=true;supabase.auth.getSession().then(({data})=>alive&&setSession(data.session));const {data}=supabase.auth.onAuthStateChange((_e,s)=>alive&&setSession(s));return()=>{alive=false;data.subscription.unsubscribe()}},[]);
  useEffect(()=>{if(!session||hidden)return;void load();const t=window.setInterval(()=>void load(),15000);return()=>window.clearInterval(t)},[session,hidden]);
  const pkByName=useMemo(()=>new Map(pkRows.map((c:any)=>[norm(c.name),c])),[pkRows]);

  async function markSuspect(c:any,reason:string,details:any={}){
    if(hasTag(c,SUSPECT))return;
    const tags=[...new Set([...(c.tags??[]).filter((t:string)=>t!==WATCH),WATCH,SUSPECT,"WATCH_EVIDENCE:"+reason])];
    const {error}=await supabase.from("characters").update({tags,data_state:"SUSPEITO",confidence:"MEDIUM"}).eq("id",c.id);
    if(error)throw error;
    const key="watch-suspect:"+c.id+":"+reason.toLowerCase();
    await supabase.from("alerts").upsert({character_id:c.id,title:"SUSPEITO IDENTIFICADO",body:c.name+" passou de observação para suspeito: "+reason,triggered_at:new Date().toISOString(),dedupe_key:key,metadata:{rule:"WATCHLIST_COMPATIBILITY",reason,...details}},{onConflict:"dedupe_key"});
  }

  async function checkCompatibility(c:any){
    setChecking(c.id);
    try{
      const tibia=await getTibiaDataCharacter(c.name);
      const sameAccount=accountChars(tibia.data).find(n=>pkByName.has(norm(n)));
      if(sameAccount){await markSuspect(c,"mesma conta pública de "+sameAccount,{matched_character:sameAccount,source:"TIBIADATA"});await load();return}

      const stalker=await getStalkerCharacter(c.name);
      const items=Array.isArray(stalker.data?.possibleInvisibleCharacters)?stalker.data.possibleInvisibleCharacters:[];
      const suggestions=items.map((x:any)=>({character_id:c.id,suggested_name:String(x.otherCharacterName||"").trim(),match_count:Number(x.numberOfMatches||0),first_match_date:x.firstMatchDateOnly||null,last_match_date:x.lastMatchDateOnly||null,relative_score:0,fetched_at:new Date().toISOString(),raw_data:{...x,watchlist:true}})).filter((x:any)=>x.suggested_name);
      if(suggestions.length)await supabase.from("stalker_suggestions").upsert(suggestions,{onConflict:"character_id,suggested_name"});
      const matched=[...suggestions].sort((a,b)=>b.match_count-a.match_count).find(x=>x.match_count>=10&&pkByName.has(norm(x.suggested_name)));
      if(matched)await markSuspect(c,"compatibilidade com "+matched.suggested_name+" ("+matched.match_count+" matches)",{matched_character:matched.suggested_name,matches:matched.match_count,source:"TIBIA_STALKER"});
      await load();
    }catch(e){alert(e instanceof Error?e.message:"Falha ao verificar compatibilidade")}finally{setChecking(null)}
  }

  async function add(){
    const clean=name.trim();if(!clean)return;setBusy(true);
    try{
      const r=await getTibiaDataCharacter(clean);const info=infoFromTibia(r.data);const world=String(info?.world||"").trim();
      if(world!==WORLD)throw new Error(clean+" está em "+(world||"um mundo não identificado")+". A observação deste radar está limitada a "+WORLD+".");
      const worldUp=await supabase.from("worlds").upsert({name:WORLD},{onConflict:"name"}).select("id").single();if(worldUp.error)throw worldUp.error;
      const found=await supabase.from("characters").select("id,name,tags,monitored,archived").ilike("name",clean).limit(1);if(found.error)throw found.error;
      const existing=found.data?.[0];
      if(existing?.monitored&&!isWatch(existing))throw new Error(existing.name+" já faz parte da base de PKs monitorados.");
      const tags=[...new Set([...(existing?.tags??[]).filter((t:string)=>t!==SUSPECT&&!t.startsWith("WATCH_EVIDENCE:")),WATCH,"WATCH_ADDED_MANUALLY"])];
      let id=existing?.id;
      if(id){const up=await supabase.from("characters").update({name:String(info?.name||clean).trim(),world_id:worldUp.data.id,level:Number(info?.level)||null,vocation:info?.vocation?String(info.vocation):null,monitored:false,archived:false,source:"MANUAL",data_state:"EM_OBSERVACAO",confidence:"LOW",tags}).eq("id",id);if(up.error)throw up.error}
      else{const ins=await supabase.from("characters").insert({name:String(info?.name||clean).trim(),world_id:worldUp.data.id,level:Number(info?.level)||null,vocation:info?.vocation?String(info.vocation):null,monitored:false,archived:false,source:"MANUAL",data_state:"EM_OBSERVACAO",confidence:"LOW",tags}).select("id").single();if(ins.error)throw ins.error;id=ins.data.id}
      setName("");await load();
      const fresh=(await supabase.from("characters").select("id,name,tags,monitored,worlds(name)").eq("id",id).single()).data;if(fresh)void checkCompatibility(fresh);
    }catch(e){alert(e instanceof Error?e.message:"Falha ao adicionar à observação")}finally{setBusy(false)}
  }

  async function confirmPk(c:any){
    if(!confirm("Confirmar "+c.name+" como PK? Ele passará a contar normalmente em monitoramento, mass log e alertas."))return;
    const tags=[...new Set([...(c.tags??[]).filter((t:string)=>t!==WATCH&&t!==SUSPECT&&!t.startsWith("WATCH_EVIDENCE:")),"PK_SEED"])];
    const {error}=await supabase.from("characters").update({monitored:true,tags,data_state:"CONFIRMADO",confidence:"HIGH"}).eq("id",c.id);if(error)alert(error.message);else await load();
  }
  async function discard(c:any){
    if(!confirm("Descartar "+c.name+" da observação?"))return;
    const tags=(c.tags??[]).filter((t:string)=>t!==WATCH&&t!==SUSPECT&&t!=="WATCH_ADDED_MANUALLY"&&!t.startsWith("WATCH_EVIDENCE:"));
    const {error}=await supabase.from("characters").update({monitored:false,archived:true,tags,data_state:"DESCARTADO"}).eq("id",c.id);if(error)alert(error.message);else await load();
  }

  if(!session||hidden)return null;
  return <>
    <button onClick={()=>setOpen(true)} style={{position:"fixed",right:18,bottom:18,zIndex:9000,border:"1px solid #d7a329",background:"#18140b",color:"#ffd56a",borderRadius:12,padding:"10px 14px",fontWeight:800,display:"flex",gap:8,alignItems:"center",boxShadow:"0 8px 28px #0008"}}><Eye size={16}/> Observação {rows.length?"("+rows.length+")":""}</button>
    {open&&<div style={{position:"fixed",inset:0,zIndex:10000,background:"#000b",display:"grid",placeItems:"center",padding:16}} onClick={()=>setOpen(false)}><div onClick={e=>e.stopPropagation()} style={{width:"min(760px,96vw)",maxHeight:"86vh",overflow:"auto",background:"#101216",border:"1px solid #30343b",borderRadius:16,padding:18,color:"#f4f4f5",boxShadow:"0 20px 70px #000"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><div><h2 style={{margin:0}}>Personagens sob observação</h2><p style={{margin:"5px 0 0",color:"#9ca3af"}}>Não contam como PK. Viram suspeitos se matarem junto com PKs ou se houver compatibilidade relevante.</p></div><button onClick={()=>setOpen(false)} style={{background:"transparent",border:0,color:"#aaa"}}><X/></button></div>
      <div style={{display:"flex",gap:8,marginTop:16}}><input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void add()} placeholder="Nome exato do personagem" style={{flex:1,background:"#090b0e",color:"white",border:"1px solid #30343b",borderRadius:9,padding:"10px 12px"}}/><button disabled={busy} onClick={()=>void add()} style={{border:0,borderRadius:9,padding:"10px 14px",fontWeight:800}}>{busy?"Adicionando…":"Adicionar à observação"}</button></div>
      <div style={{display:"grid",gap:9,marginTop:16}}>{rows.map(c=><div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",padding:12,border:"1px solid #292d33",borderRadius:12,background:"#0c0e12"}}><div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><b>{c.name}</b><span style={{fontSize:11,fontWeight:900,padding:"3px 7px",borderRadius:999,background:hasTag(c,SUSPECT)?"#49211c":"#3b3215",color:hasTag(c,SUSPECT)?"#ff9a8b":"#ffd56a"}}>{hasTag(c,SUSPECT)?"SUSPEITO":"EM OBSERVAÇÃO"}</span></div><small style={{color:"#9299a3"}}>Level {c.level??"—"} · {c.vocation??"—"} · {c.online?"online":"offline"}</small></div><div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}><button title="Verificar Tibia Stalker e conta pública" onClick={()=>void checkCompatibility(c)} disabled={checking===c.id} style={{padding:"7px 9px"}}><RefreshCw size={14}/></button><button onClick={()=>void confirmPk(c)} style={{padding:"7px 9px",display:"flex",gap:5,alignItems:"center"}}><Skull size={14}/> Confirmar PK</button><button onClick={()=>void discard(c)} style={{padding:"7px 9px",display:"flex",gap:5,alignItems:"center"}}><ShieldAlert size={14}/> Descartar</button></div></div>)}{!rows.length&&<div style={{padding:18,textAlign:"center",color:"#8b929c"}}>Nenhum personagem em observação.</div>}</div>
    </div></div>}
  </>;
}
