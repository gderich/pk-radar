import {createClient} from "@supabase/supabase-js";
const URL=process.env.SUPABASE_URL;const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!URL||!KEY)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db=createClient(URL,KEY,{auth:{persistSession:false}});const {syncPublicSources}=await import("./sources.mjs");const {rebuildAutomaticIdentities}=await import("./identity.mjs");const {PK_SEED_SET,discoveryDepth,discoveryRule}=await import("./seeds.mjs");const WS_URL=process.env.TIBIA_STALKER_WS||"wss://api.tibiastalker.pl/connection-hub";const API_URL="https://api.tibiastalker.pl/api/tibia-stalker/v1/characters/";
let socket=null;let subscribed=new Set();let deepCounter=0;let reconnectTimer=null;let reconnectAttempt=0;
async function chars(){const {data,error}=await db.from("characters").select("id,name,online,tags,worlds(name)").eq("archived",false).eq("monitored",true).order("name");if(error)throw error;return (data??[]).map(x=>({...x,world_name:x.worlds?.name??null})).filter(x=>x.world_name==="Jadebra"&&(PK_SEED_SET.has(String(x.name).toLowerCase())||(x.tags??[]).includes("PK_SEED")||(x.tags??[]).includes("AUTO_DISCOVERED")))}
async function ensureSession(characterId,kind,at){if(kind==="LOGIN"){await db.from("character_sessions").upsert({character_id:characterId,login_at:at,source:"TIBIA_STALKER",dedupe_key:"session:"+characterId+":"+at},{onConflict:"dedupe_key"});return}const {data:s}=await db.from("character_sessions").select("id,login_at").eq("character_id",characterId).is("logout_at",null).order("login_at",{ascending:false}).limit(1).maybeSingle();if(s){const duration=Math.max(0,Math.round((new Date(at)-new Date(s.login_at))/60000));await db.from("character_sessions").update({logout_at:at,duration_minutes:duration}).eq("id",s.id)}}
async function massLogin(at){const since=new Date(new Date(at).getTime()-5*60*1000).toISOString();const recent=(await db.from("online_events").select("character_id,occurred_at,characters(name)").eq("kind","LOGIN").gte("occurred_at",since).order("occurred_at")).data??[];const byId=new Map();for(const x of recent)if(x.character_id)byId.set(x.character_id,x.characters?.name||x.character_id);if(byId.size<4)return;const bucket=Math.floor(new Date(at).getTime()/300000);const names=[...byId.values()];await db.from("alerts").upsert({title:"MASS LOG DETECTADO",body:names.length+" personagens monitorados entraram em até 5 minutos: "+names.join(", "),triggered_at:at,dedupe_key:"mass-login:"+bucket,metadata:{count:names.length,windowMinutes:5,threshold:4,names}},{onConflict:"dedupe_key"});await db.from("online_events").upsert({kind:"MASS_LOGIN",occurred_at:at,source:"TIBIA_STALKER",confidence:"HIGH",dedupe_key:"mass-login-event:"+bucket,metadata:{count:names.length,windowMinutes:5,names}},{onConflict:"dedupe_key"})}
async function inferSwap(characterId,at){const since=new Date(new Date(at).getTime()-90*1000).toISOString();const prev=(await db.from("online_events").select("character_id,occurred_at,characters(name)").eq("kind","LOGOUT").neq("character_id",characterId).gte("occurred_at",since).order("occurred_at",{ascending:false}).limit(4)).data??[];for(const p of prev){if(!p.character_id)continue;const ids=[characterId,p.character_id].sort();const {data:rel}=await db.from("player_relations").select("id,status,confidence_score").eq("character_a_id",ids[0]).eq("character_b_id",ids[1]).maybeSingle();if(rel?.status==="CONFIRMED"||rel?.status==="REJECTED")continue;let relationId=rel?.id;let score=Math.min(70,Number(rel?.confidence_score||0)+15);if(!relationId){const ins=await db.from("player_relations").insert({character_a_id:ids[0],character_b_id:ids[1],status:"MEDIUM",confidence_score:score,manual_note:"Possível troca rápida entre personagens; requer revisão"}).select("id").single();relationId=ins.data?.id}else await db.from("player_relations").update({status:score>=45?"HIGH":"MEDIUM",confidence_score:score}).eq("id",relationId);if(relationId)await db.from("relation_evidence").insert({relation_id:relationId,source:"TIBIA_STALKER",evidence_type:"FAST_SWAP",summary:"Logout de "+(p.characters?.name||"outro char")+" seguido de login em até 90s",weight:15,raw_data:{logoutAt:p.occurred_at,loginAt:at}})}}
async function recordAssociations(characterId,at){const {data:others}=await db.from("characters").select("id,name").eq("online",true).eq("monitored",true).neq("id",characterId);for(const o of others??[]){const ids=[characterId,o.id].sort();const {data:old}=await db.from("character_associations").select("co_online_count,first_seen_at").eq("character_a_id",ids[0]).eq("character_b_id",ids[1]).maybeSingle();const count=Number(old?.co_online_count||0)+1;await db.from("character_associations").upsert({character_a_id:ids[0],character_b_id:ids[1],co_online_count:count,first_seen_at:old?.first_seen_at||at,last_seen_at:at,association_score:Math.min(95,count*5)},{onConflict:"character_a_id,character_b_id"})}}
async function record(e){const c=(await db.from("characters").select("id,online").ilike("name",e.name).maybeSingle()).data;if(!c||c.online===e.isOnline)return;const at=new Date(e.occurredOn||Date.now()).toISOString();const kind=e.isOnline?"LOGIN":"LOGOUT";const source=e.source||"TIBIA_STALKER";const confidence=e.confidence||"HIGH";await db.from("characters").update({online:e.isOnline,last_event_at:at,last_login_at:e.isOnline?at:undefined,source,data_state:"ATUALIZADO",confidence}).eq("id",c.id);await db.from("online_events").upsert({character_id:c.id,kind,occurred_at:at,source,confidence,dedupe_key:"worker:"+source+":"+e.name.toLowerCase()+":"+kind+":"+at,metadata:{name:e.name,reconciled:source!=="TIBIA_STALKER"}},{onConflict:"dedupe_key"});await ensureSession(c.id,kind,at);if(kind==="LOGIN"){await massLogin(at);await inferSwap(c.id,at);await recordAssociations(c.id,at)}}

function toDateOnly(v){if(!v)return null;const s=String(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null}
async function isJadebraCharacter(name){try{const r=await fetch("https://api.tibiadata.com/v4/character/"+encodeURIComponent(name),{headers:{accept:"application/json"}});if(!r.ok)return false;const j=await r.json();const root=j.character||j.characters||j;const info=root.character||root.data||root;return String(info.world||"")==="Jadebra"}catch{return false}}
async function syncStalkerSuggestions(list){
  for(const c of list){
    let autoAdded=0;
    try{
      const r=await fetch(API_URL+encodeURIComponent(c.name),{headers:{accept:"application/json"}});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const j=await r.json();
      const items=Array.isArray(j?.possibleInvisibleCharacters)?j.possibleInvisibleCharacters:[];
      const max=Math.max(0,...items.map(x=>Number(x.numberOfMatches||0)));
      for(const x of items){
        const name=String(x.otherCharacterName||"").trim();if(!name)continue;
        const matches=Number(x.numberOfMatches||0);
        const score=max?Math.round(matches/max*10000)/100:0;
        await db.from("stalker_suggestions").upsert({
          character_id:c.id,suggested_name:name,match_count:matches,
          first_match_date:toDateOnly(x.firstMatchDateOnly),
          last_match_date:toDateOnly(x.lastMatchDateOnly),
          relative_score:score,fetched_at:new Date().toISOString(),raw_data:x
        },{onConflict:"character_id,suggested_name"});
        let {data:other}=await db.from("characters").select("id,tags,monitored").ilike("name",name).maybeSingle();
        const span=x.firstMatchDateOnly&&x.lastMatchDateOnly?Math.max(0,Math.round((new Date(x.lastMatchDateOnly)-new Date(x.firstMatchDateOnly))/86400000)):0;
        const depth=discoveryDepth(c.tags??[]);
        if(discoveryRule(depth,score,matches,span)&&autoAdded<1){
          const total=(await db.from("characters").select("id",{count:"exact",head:true}).eq("monitored",true)).count??0;
          if(total<150&&await isJadebraCharacter(name)){
            const nextDepth=(depth??0)+1;
            const tags=other?.tags?.includes("PK_SEED")?other.tags:[...new Set([...(other?.tags??[]).filter(t=>t!=="AUTO_NOISE"&&!String(t).startsWith("DISCOVERY_DEPTH:")),"AUTO_DISCOVERED","DISCOVERY_DEPTH:"+nextDepth])];
            if(other?.id){
              await db.from("characters").update({monitored:true,archived:false,tags}).eq("id",other.id);
              autoAdded++;console.log("reativado por evidência forte",name,"a partir de",c.name,score,matches,span);
            }else{
              const {data:world}=await db.from("worlds").upsert({name:"Jadebra"},{onConflict:"name"}).select("id").single();
              const added=await db.from("characters").insert({name,world_id:world?.id??null,monitored:true,source:"TIBIA_STALKER",data_state:"AUTO_DESCOBERTO",confidence:"MEDIUM",tags}).select("id,tags").single();
              if(added.data?.id){other=added.data;autoAdded++;console.log("auto-descoberto ancorado",name,"a partir de",c.name,score,matches,span)}
            }
          }
        }
        if(other?.id&&other.id!==c.id){
          const ids=[c.id,other.id].sort();
          const {data:existing}=await db.from("player_relations").select("id,status,confidence_score").eq("character_a_id",ids[0]).eq("character_b_id",ids[1]).maybeSingle();
          if(existing?.status!=="CONFIRMED"&&existing?.status!=="REJECTED"){
            let rel=existing;
            if(existing?.id){
              const u=await db.from("player_relations").update({
                status:score>=80?"HIGH":score>=40?"MEDIUM":"LOW",
                confidence_score:Math.min(95,score),
                manual_note:"Correlação automática do Tibia Stalker por padrões de login/logout"
              }).eq("id",existing.id).select("id,status").single();rel=u.data;
            }else{
              const u=await db.from("player_relations").insert({
                character_a_id:ids[0],character_b_id:ids[1],
                status:score>=80?"HIGH":score>=40?"MEDIUM":"LOW",
                confidence_score:Math.min(95,score),
                manual_note:"Correlação automática do Tibia Stalker por padrões de login/logout"
              }).select("id,status").single();rel=u.data;
            }
            if(rel?.id)await db.from("relation_evidence").upsert({
              relation_id:rel.id,source:"TIBIA_STALKER",evidence_type:"STALKER_CORRELATION",
              summary:matches+" correspondências de login/logout no Tibia Stalker",
              weight:Math.min(95,score),fetched_at:new Date().toISOString(),
              reference_url:API_URL+encodeURIComponent(c.name),raw_data:x
            },{onConflict:"relation_id,evidence_type,source"});
          }
        }
      }
      await db.from("source_syncs").update({status:"SUCCESS",enabled:true,last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("source","TIBIA_STALKER");
    }catch(err){
      console.error("STALKER_CORRELATIONS",c.name,err);
      await db.from("source_syncs").update({status:"ERROR",enabled:true,last_error:String(err),updated_at:new Date().toISOString()}).eq("source","TIBIA_STALKER");
    }
    await new Promise(r=>setTimeout(r,500));
  }
}

function findOnlineFlag(value){if(!value||typeof value!=="object")return undefined;if(Array.isArray(value)){for(const x of value){const f=findOnlineFlag(x);if(f!==undefined)return f}return undefined}for(const [k,v] of Object.entries(value)){if(k.toLowerCase()==="isonline"&&typeof v==="boolean")return v;const f=findOnlineFlag(v);if(f!==undefined)return f}return undefined}
async function pollInitial(list){for(const c of list){try{const r=await fetch(API_URL+encodeURIComponent(c.name),{headers:{accept:"application/json"}});if(!r.ok)continue;const flag=findOnlineFlag(await r.json());if(flag!==undefined)await record({name:c.name,isOnline:flag,occurredOn:new Date().toISOString()})}catch(err){console.error("REST",c.name,err)}}}
function subscribe(list){if(!socket||socket.readyState!==1)return;for(const c of list){const k=c.name.toLowerCase();if(subscribed.has(k))continue;socket.send(JSON.stringify({arguments:[c.name],target:"JoinGroup",type:1})+"\x1e");subscribed.add(k)}}
function connectSocket(list){if(reconnectTimer)clearTimeout(reconnectTimer);console.log("abrindo Tibia Stalker websocket para "+list.length+" chars");socket=new WebSocket(WS_URL);socket.onopen=()=>{reconnectAttempt=0;subscribed.clear();socket.send(JSON.stringify({protocol:"json",version:1})+"\x1e");subscribe(list);console.log("Tibia Stalker websocket conectado")};socket.onmessage=async ev=>{for(const frame of String(ev.data).split("\x1e").filter(Boolean)){try{const m=JSON.parse(frame);if(m.target==="Character Tracker"||m.target==="CharacterTracker"){const e=m.arguments?.[0];if(e?.name&&typeof e.isOnline==="boolean")await record({...e,source:"TIBIA_STALKER",confidence:"HIGH"})}else if(m.target==="JoinGroupFail")console.error("JoinGroupFail",m.arguments?.[0])}catch(err){console.error(err)}}};socket.onerror=e=>console.error("Tibia Stalker websocket error",e);socket.onclose=()=>{const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5));console.error("WebSocket fechado; reconectando em "+delay+"ms");reconnectTimer=setTimeout(async()=>{const latest=await chars();connectSocket(latest)},delay)}}
function onlineNamesFromWorldPayload(j){const arr=j?.world?.online_players??j?.worlds?.players_online??j?.players_online??[];return new Set((Array.isArray(arr)?arr:[]).map(x=>String(x?.name||x).toLowerCase()))}
async function reconcileOnline(list){const byWorld=new Map();for(const c of list){if(!c.world_name)continue;const a=byWorld.get(c.world_name)??[];a.push(c);byWorld.set(c.world_name,a)}for(const [world,members] of byWorld){try{const r=await fetch("https://api.tibiadata.com/v4/world/"+encodeURIComponent(world),{headers:{accept:"application/json"}});if(!r.ok)continue;const online=onlineNamesFromWorldPayload(await r.json());const now=new Date().toISOString();for(const c of members){const flag=online.has(c.name.toLowerCase());if(flag!==c.online)await record({name:c.name,isOnline:flag,occurredOn:now,source:"TIBIADATA",confidence:"MEDIUM"})}}catch(err){console.error("WORLD_RECONCILE",world,err)}}}
async function sourceCycle(){const list=await chars();subscribe(list);deepCounter++;await syncPublicSources(db,list,{ring:deepCounter%2===1,guild:deepCounter%6===1});if(deepCounter%2===0){await syncStalkerSuggestions(list);await rebuildAutomaticIdentities(db)}}
async function main(){let list=await chars();console.log("monitorando "+list.length+" personagens");connectSocket(list);void reconcileOnline(list);void syncPublicSources(db,list,{ring:true,guild:true}).catch(console.error);void (async()=>{await syncStalkerSuggestions(list);await rebuildAutomaticIdentities(db)})().catch(console.error);setInterval(()=>sourceCycle().catch(console.error),5*60*1000);setInterval(async()=>{list=await chars();subscribe(list)},15000);setInterval(async()=>{list=await chars();await reconcileOnline(list)},60000)}
main().catch(e=>{console.error(e);process.exit(1)});
