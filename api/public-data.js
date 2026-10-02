import {createClient} from "@supabase/supabase-js";

const WORLD="Jadebra";
const cmp=(a,b)=>String(a??"").localeCompare(String(b??""),"pt-BR",{sensitivity:"base"});
const origin=tags=>Array.isArray(tags)&&tags.includes("PK_SEED")?"ADICIONADO POR VOCÊ":"DESCOBERTO PELO SISTEMA";

async function safe(query,fallback=[]){
  const r=await query;
  if(r.error){console.warn("public-data query",r.error.message);return fallback}
  return r.data??fallback;
}
function externalMainFor(coreIds,allById,graph){
  const visited=new Set(coreIds),stack=[...coreIds];
  while(stack.length){
    const id=stack.pop();
    for(const next of graph.get(id)??[]){
      if(!visited.has(next)){visited.add(next);stack.push(next)}
    }
  }
  const connected=[...visited].map(id=>allById.get(id)).filter(Boolean);
  const baseMax=Math.max(0,...connected.filter(x=>x.worlds?.name===WORLD).map(x=>Number(x.level||0)));
  const external=connected.filter(x=>x.worlds?.name&&x.worlds.name!==WORLD&&Number(x.level||0)>0)
    .sort((a,b)=>Number(b.level||0)-Number(a.level||0)||cmp(a.name,b.name));
  const c=external[0];
  return c&&Number(c.level)>baseMax?{name:c.name,world:c.worlds?.name,level:c.level??null,vocation:c.vocation??null,guild:c.guilds?.name??null}:null;
}
function eventName(x){return x.characters?.name??x.raw_data?.victim??"Sistema"}
function eventWorld(x){return x.characters?.worlds?.name??x.raw_data?.world??null}
function killerName(k){return String(k?.name??k??"").trim()}

export default async function handler(req,res){
  res.setHeader("Cache-Control","public, s-maxage=12, stale-while-revalidate=45");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(500).json({error:"Public snapshot is not configured"});

  const db=createClient(url,key,{auth:{persistSession:false}});
  try{
    const [
      allChars,groups,relations,suggestions,
      onlineEvents,deathEvents,levelEvents,pvpEvents,
      sessions,alerts,sources
    ]=await Promise.all([
      safe(db.from("characters").select("id,name,level,vocation,online,monitored,archived,tags,source,confidence,last_login_at,last_event_at,worlds(name),guilds(name)").eq("archived",false)),
      safe(db.from("identity_groups").select("id,label,confidence,notes,updated_at,identity_members(character_id,confidence_score,characters(id,name,level,vocation,online,tags,worlds(name),guilds(name)))").order("updated_at",{ascending:false})),
      safe(db.from("player_relations").select("character_a_id,character_b_id,status,manual_note,confidence_score").eq("status","CONFIRMED")),
      safe(db.from("stalker_suggestions").select("character_id,suggested_name,match_count,relative_score,first_match_date,last_match_date").order("match_count",{ascending:false}).limit(3000)),
      safe(db.from("online_events").select("id,kind,occurred_at,metadata,characters(name,worlds(name))").order("occurred_at",{ascending:false}).limit(200)),
      safe(db.from("death_events").select("id,occurred_at,level,killers,source,raw_data,characters(name,worlds(name),guilds(name))").order("occurred_at",{ascending:false}).limit(500)),
      safe(db.from("level_events").select("id,old_level,new_level,occurred_at,characters(name,worlds(name))").order("occurred_at",{ascending:false}).limit(100)),
      safe(db.from("pvp_events").select("id,opponent_name,role,occurred_at,source,raw_data,characters(name,worlds(name))").order("occurred_at",{ascending:false}).limit(300)),
      safe(db.from("character_sessions").select("id,login_at,logout_at,duration_minutes,characters(name,worlds(name))").order("login_at",{ascending:false}).limit(1500)),
      safe(db.from("alerts").select("id,title,body,triggered_at,metadata,characters(name)").order("triggered_at",{ascending:false}).limit(150)),
      safe(db.from("source_syncs").select("source,enabled,status,last_success_at,next_sync_at,last_error,updated_at,config").order("source"))
    ]);

    const active=allChars.filter(c=>c.monitored&&c.worlds?.name===WORLD);
    const activeIds=new Set(active.map(c=>c.id));
    const activeById=new Map(active.map(c=>[c.id,c]));
    const allById=new Map(allChars.map(c=>[c.id,c]));

    const accountGraph=new Map();
    for(const r of relations){
      if(!String(r.manual_note||"").includes("Mesma conta pública"))continue;
      if(!accountGraph.has(r.character_a_id))accountGraph.set(r.character_a_id,new Set());
      if(!accountGraph.has(r.character_b_id))accountGraph.set(r.character_b_id,new Set());
      accountGraph.get(r.character_a_id).add(r.character_b_id);
      accountGraph.get(r.character_b_id).add(r.character_a_id);
    }

    const characters=active.map(c=>({
      name:c.name,world:c.worlds?.name??WORLD,level:c.level??null,vocation:c.vocation??null,
      guild:c.guilds?.name??null,online:Boolean(c.online),origin:origin(c.tags),
      lastLogin:c.last_login_at??null,lastEvent:c.last_event_at??null,source:c.source,confidence:c.confidence,
      main:externalMainFor([c.id],allById,accountGraph)
    })).sort((a,b)=>Number(b.online)-Number(a.online)||cmp(a.name,b.name));

    const groupedIds=new Set(),profiles=[];
    for(const g of groups){
      const members=(g.identity_members??[]).map(m=>m.characters).filter(Boolean).filter(c=>activeIds.has(c.id))
        .sort((a,b)=>Number(b.online)-Number(a.online)||Number(b.level||0)-Number(a.level||0)||cmp(a.name,b.name));
      if(members.length<2)continue;
      members.forEach(c=>groupedIds.add(c.id));
      profiles.push({
        label:members.map(c=>c.name).slice(0,4).join(" / ")+(members.length>4?" +"+(members.length-4):""),
        confidence:g.confidence,count:members.length,
        members:members.map(c=>({name:c.name,world:c.worlds?.name??WORLD,level:c.level??null,vocation:c.vocation??null,guild:c.guilds?.name??null,online:Boolean(c.online),origin:origin(c.tags)})),
        main:externalMainFor(members.map(c=>c.id),allById,accountGraph)
      });
    }
    profiles.sort((a,b)=>b.count-a.count||cmp(a.label,b.label));
    const isolated=active.filter(c=>!groupedIds.has(c.id)).sort((a,b)=>cmp(a.name,b.name)).map(c=>({
      name:c.name,world:c.worlds?.name??WORLD,level:c.level??null,vocation:c.vocation??null,guild:c.guilds?.name??null,online:Boolean(c.online),origin:origin(c.tags),
      main:externalMainFor([c.id],allById,accountGraph)
    }));

    const suggestionRows=suggestions.filter(s=>activeIds.has(s.character_id)).map(s=>({
      character:activeById.get(s.character_id)?.name??null,
      suggestedName:s.suggested_name,matchCount:Number(s.match_count||0),score:Number(s.relative_score||0),
      first:s.first_match_date??null,last:s.last_match_date??null
    })).filter(s=>s.character);

    // Sanitized read-only evidence graph used by the public "Ver caminho" explorer.
    // No internal ids are returned to the browser.
    const evidenceByPair=new Map();
    const edgeKey=(a,b)=>[String(a).toLowerCase(),String(b).toLowerCase()].sort().join("|");
    for(const r of relations){
      const a=activeById.get(r.character_a_id),b=activeById.get(r.character_b_id);
      if(!a||!b)continue;
      const isPublic=String(r.manual_note||"").includes("Mesma conta pública");
      const edge={from:a.name,to:b.name,kind:isPublic?"PUBLIC_ACCOUNT":"CONFIRMED_RELATION",score:Number(r.confidence_score||100),matches:null,first:null,last:null};
      evidenceByPair.set(edgeKey(a.name,b.name),edge);
    }
    for(const s of suggestionRows){
      const b=characters.find(c=>c.name.toLowerCase()===String(s.suggestedName||"").toLowerCase());
      if(!b||Number(s.score||0)<95||Number(s.matchCount||0)<10)continue;
      const key=edgeKey(s.character,b.name),old=evidenceByPair.get(key);
      if(old?.kind==="PUBLIC_ACCOUNT")continue;
      const edge={from:s.character,to:b.name,kind:"STALKER_PERCENT",score:Number(s.score||0),matches:Number(s.matchCount||0),first:s.first??null,last:s.last??null};
      if(!old||Number(edge.score)>Number(old.score||0)||(Number(edge.score)===Number(old.score||0)&&Number(edge.matches)>Number(old.matches||0)))evidenceByPair.set(key,edge);
    }
    const evidenceLinks=[...evidenceByPair.values()];

    const events=[
      ...onlineEvents.map(x=>({kind:x.kind,name:eventName(x),occurredAt:x.occurred_at,opponent:null})),
      ...deathEvents.map(x=>({kind:"DEATH",name:eventName(x),occurredAt:x.occurred_at,opponent:null})),
      ...levelEvents.map(x=>({kind:"LEVEL_UP",name:eventName(x),occurredAt:x.occurred_at,opponent:null,oldLevel:x.old_level,newLevel:x.new_level})),
      ...pvpEvents.map(x=>({kind:x.role==="KILLER"?"PVP_KILL":x.role==="ASSIST"?"PVP_ASSIST":x.role==="VICTIM"?"PVP_VICTIM":"PVP",name:eventName(x),occurredAt:x.occurred_at,opponent:x.opponent_name??null,role:x.role??null}))
    ].filter(x=>{
      if(x.kind==="MASS_LOGIN")return true;
      const ch=characters.find(c=>c.name===x.name);return Boolean(ch);
    }).sort((a,b)=>new Date(b.occurredAt).getTime()-new Date(a.occurredAt).getTime()).slice(0,300);

    const deathMap=new Map();
    for(const d of deathEvents){
      const victimWorld=eventWorld(d),victim=eventName(d),occurredAt=new Date(d.occurred_at).toISOString();
      const key=occurredAt+"|"+String(victim).toLowerCase();
      let row=deathMap.get(key);
      if(!row){row={occurredAt,victim,victimWorld,sourceSet:new Set(),participants:[]};deathMap.set(key,row)}
      row.sourceSet.add(d.source);
      if(!row.victimWorld&&victimWorld)row.victimWorld=victimWorld;
      const byName=new Map(row.participants.map(p=>[String(p.name).toLowerCase(),p]));
      for(const [i,k] of (Array.isArray(d.killers)?d.killers:[]).entries()){
        const name=killerName(k);if(!name)continue;
        const tracked=characters.find(c=>c.name.toLowerCase()===name.toLowerCase());
        const role=k?.role??(i===0?"KILLER":"ASSIST");
        const nk=name.toLowerCase(),old=byName.get(nk);
        if(old){if(old.role==="ASSIST"&&role==="KILLER")old.role="KILLER";if(!old.tracked&&tracked){old.tracked=true;old.guild=tracked.guild??null}continue}
        const item={name,role,level:k?.level??null,guild:tracked?.guild??null,tracked:Boolean(tracked)};
        row.participants.push(item);byName.set(nk,item);
      }
    }
    const deathRows=[...deathMap.values()].map(d=>({...d,source:[...d.sourceSet].join(" + ")}))
      .filter(d=>d.victimWorld===WORLD&&d.participants.some(p=>p.tracked))
      .sort((a,b)=>new Date(b.occurredAt).getTime()-new Date(a.occurredAt).getTime());

    const sessionRows=sessions.filter(s=>s.characters?.worlds?.name===WORLD).map(s=>({
      character:s.characters?.name??"Desconhecido",loginAt:s.login_at,logoutAt:s.logout_at??null,durationMinutes:Number(s.duration_minutes||0)
    }));

    const publicAlerts=alerts.map(a=>({title:a.title,body:a.body,triggeredAt:a.triggered_at,character:a.characters?.name??null,metadata:a.metadata??{}}));
    const publicSources=sources.map(s=>({
      source:s.source,enabled:Boolean(s.enabled),status:s.status,lastSuccessAt:s.last_success_at??null,nextSyncAt:s.next_sync_at??null,
      note:s.last_error?String(s.last_error).slice(0,220):null,updatedAt:s.updated_at??null
    }));
    const tibiaDataSource=sources.find(s=>s.source==="TIBIADATA");
    const scan=tibiaDataSource?.config??{};
    const killMonitor={
      status:tibiaDataSource?.status??"UNKNOWN",
      lastScanAt:scan.kill_scan_last_scan_at??scan.pvp_watch_last_scan_at??scan.worker_pvp_last_scan_at??null,
      lastCaller:scan.kill_scan_last_caller??null,
      poolSize:Number(scan.kill_scan_pool_size??scan.pvp_watch_pool_size??0),
      batchSize:Number(scan.kill_scan_batch_size??scan.pvp_watch_batch_size??0),
      fetchErrors:Number(scan.kill_scan_fetch_errors??0),
      matchedDeaths:Number(scan.kill_scan_matched_deaths??0),
      newDeaths:Number(scan.kill_scan_new_deaths??0),
      newAlerts:Number(scan.kill_scan_new_alerts??0),
      estimatedCycleSeconds:Number(scan.kill_scan_estimated_cycle_seconds??0),
      lastError:tibiaDataSource?.last_error??null
    };

    return res.status(200).json({
      world:WORLD,updatedAt:new Date().toISOString(),
      characters,profiles,isolated,suggestions:suggestionRows,evidenceLinks,events,deaths:deathRows,sessions:sessionRows,alerts:publicAlerts,sources:publicSources,killMonitor
    });
  }catch(e){
    console.error("public-data",e);
    return res.status(500).json({error:"Não foi possível carregar a visualização pública."});
  }
}
