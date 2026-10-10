const WORLD="Jadebra";
const WORLD_API="https://api.tibiadata.com/v4/world/";
const CHAR_API="https://api.tibiadata.com/v4/character/";
const UA="PK-Radar-KillScanner/7.0";
const DEFAULT_BATCH=24;
const RECENT_TTL=30*60*1000;
const DEATH_LOOKBACK=45*60*1000;
const REVENGE_WINDOW=15*60*1000;
const WATCH_TAG="WATCHLIST";
const SUSPECT_TAG="WATCH_SUSPECT";

function keyName(v){return String(v||"").trim().toLowerCase().replace(/\s+/g," ")}
function tagsOf(x){return Array.isArray(x?.tags)?x.tags:[]}
function isWatch(x){return tagsOf(x).includes(WATCH_TAG)||tagsOf(x).includes(SUSPECT_TAG)}
function isConfirmedPk(x){return Boolean(x?.monitored)&&!isWatch(x)}
function onlineNames(j){
  const list=j?.world?.online_players??j?.world?.players_online??j?.worlds?.players_online??j?.players_online??[];
  return (Array.isArray(list)?list:[]).map(x=>String((x?.name??x)||"").trim()).filter(Boolean);
}
function deathList(j){
  const root=j?.character??j?.characters??j??{};
  return Array.isArray(root?.deaths)?root.deaths:Array.isArray(root?.data?.deaths)?root.data.deaths:[];
}
function playerEntries(list,role){
  return (Array.isArray(list)?list:[])
    .filter(x=>x?.player!==false&&x?.name)
    .map(x=>({name:String(x.name).trim(),player:true,role,traded:Boolean(x.traded),summon:x.summon||null}));
}
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function minsLeft(until,now){return Math.max(0,Math.ceil((until-now)/60000))}
async function getJson(url){
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":UA}});
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},()=>worker()));
  return out;
}
function canonicalDeathKey(at,victim){return "pvp-death:"+at+":"+keyName(victim)}
function canonicalPvpKey(id,at,victim,role){return "pvp-event:"+id+":"+at+":"+keyName(victim)+":"+String(role).toLowerCase()}

async function markWatchSuspect(db,ch,code,reason,metadata,nowIso){
  if(!ch||tagsOf(ch).includes(SUSPECT_TAG))return false;
  const safeCode=String(code||"EVIDENCE").replace(/[^A-Z0-9_-]/gi,"_").toUpperCase();
  const tags=[...new Set([...tagsOf(ch).filter(t=>!String(t).startsWith("WATCH_EVIDENCE:")),WATCH_TAG,SUSPECT_TAG,"WATCH_EVIDENCE:"+safeCode])];
  const up=await db.from("characters").update({tags,data_state:"SUSPEITO",confidence:"MEDIUM"}).eq("id",ch.id);
  if(up.error)throw up.error;
  ch.tags=tags;ch.data_state="SUSPEITO";ch.confidence="MEDIUM";
  const dedupe="watch-suspect:"+ch.id+":"+safeCode.toLowerCase();
  const alert=await db.from("alerts").upsert({
    character_id:ch.id,title:"SUSPEITO IDENTIFICADO",body:ch.name+" passou de observação para suspeito: "+reason,
    triggered_at:nowIso,dedupe_key:dedupe,
    metadata:{rule:"WATCHLIST_EVIDENCE",world:WORLD,reason_code:safeCode,reason,...metadata}
  },{onConflict:"dedupe_key"});
  if(alert.error)throw alert.error;
  return true;
}

async function evaluateStoredWatchEvidence(db,active,confirmed,watch,nowIso){
  if(!watch.length||!confirmed.length)return 0;
  const byId=new Map(active.map(x=>[x.id,x]));
  const confirmedIds=new Set(confirmed.map(x=>x.id));
  const confirmedByName=new Map(confirmed.map(x=>[keyName(x.name),x]));
  let promoted=0;
  const [relRes,sugRes]=await Promise.all([
    db.from("player_relations").select("character_a_id,character_b_id,status,confidence_score,manual_note").eq("status","CONFIRMED"),
    db.from("stalker_suggestions").select("character_id,suggested_name,match_count,first_match_date,last_match_date").in("character_id",active.map(x=>x.id))
  ]);
  const relations=relRes.error?[]:(relRes.data??[]);
  const suggestions=sugRes.error?[]:(sugRes.data??[]);
  for(const w of watch){
    if(tagsOf(w).includes(SUSPECT_TAG))continue;
    const relation=relations.find(r=>{
      if(r.character_a_id===w.id&&confirmedIds.has(r.character_b_id))return true;
      if(r.character_b_id===w.id&&confirmedIds.has(r.character_a_id))return true;
      return false;
    });
    if(relation){
      const otherId=relation.character_a_id===w.id?relation.character_b_id:relation.character_a_id;
      const other=byId.get(otherId);
      if(await markWatchSuspect(db,w,"CONFIRMED_RELATION","vínculo confirmado com "+(other?.name||"um PK monitorado"),{matched_character:other?.name||null,confidence_score:relation.confidence_score,relation_note:relation.manual_note,source:"PLAYER_RELATION"},nowIso))promoted++;
      continue;
    }
    const direct=[...suggestions].filter(s=>s.character_id===w.id&&Number(s.match_count||0)>=10).sort((a,b)=>Number(b.match_count||0)-Number(a.match_count||0)).find(s=>confirmedByName.has(keyName(s.suggested_name)));
    if(direct){
      const other=confirmedByName.get(keyName(direct.suggested_name));
      if(await markWatchSuspect(db,w,"STALKER_MATCH","compatibilidade com "+(other?.name||direct.suggested_name)+" ("+Number(direct.match_count||0)+" matches)",{matched_character:other?.name||direct.suggested_name,matches:Number(direct.match_count||0),first_match_date:direct.first_match_date,last_match_date:direct.last_match_date,source:"TIBIA_STALKER"},nowIso))promoted++;
      continue;
    }
    const reverse=[...suggestions].filter(s=>confirmedIds.has(s.character_id)&&Number(s.match_count||0)>=10&&keyName(s.suggested_name)===keyName(w.name)).sort((a,b)=>Number(b.match_count||0)-Number(a.match_count||0))[0];
    if(reverse){
      const other=byId.get(reverse.character_id);
      if(await markWatchSuspect(db,w,"STALKER_REVERSE_MATCH","compatibilidade encontrada a partir de "+(other?.name||"um PK monitorado")+" ("+Number(reverse.match_count||0)+" matches)",{matched_character:other?.name||null,matches:Number(reverse.match_count||0),first_match_date:reverse.first_match_date,last_match_date:reverse.last_match_date,source:"TIBIA_STALKER"},nowIso))promoted++;
    }
  }
  return promoted;
}

export async function scanPvpKills(db,{batchSize=DEFAULT_BATCH,minimumGapMs=0,caller="unknown"}={}){
  const now=Date.now(),nowIso=new Date(now).toISOString();
  const [{data:targets,error:te},{data:sync,error:se}]=await Promise.all([
    db.from("characters").select("id,name,tags,monitored,data_state,confidence,worlds(name)").eq("archived",false),
    db.from("source_syncs").select("id,config,request_count").eq("source","TIBIADATA").maybeSingle()
  ]);
  if(te)throw te;if(se)throw se;

  const cfg=sync?.config&&typeof sync.config==="object"?sync.config:{};
  const lastScanMs=new Date(cfg.kill_scan_last_scan_at||0).getTime();
  if(minimumGapMs>0&&Number.isFinite(lastScanMs)&&now-lastScanMs<minimumGapMs){
    return {ok:true,skipped:true,reason:"recent_scan",lastScanAt:cfg.kill_scan_last_scan_at||null,pool:Number(cfg.kill_scan_pool_size||0),scanned:0};
  }

  const active=(targets??[]).filter(x=>x.worlds?.name===WORLD&&(x.monitored||isWatch(x)));
  const confirmed=active.filter(isConfirmedPk);
  const watch=active.filter(isWatch);
  const targetByName=new Map(active.map(x=>[keyName(x.name),x]));
  const confirmedByName=new Map(confirmed.map(x=>[keyName(x.name),x]));
  if(!active.length)return {ok:true,scanned:0,pool:0,alerts:0,newDeaths:0,message:"No tracked Jadebra targets"};

  let newSuspects=await evaluateStoredWatchEvidence(db,active,confirmed,watch,nowIso);
  const world=await getJson(WORLD_API+encodeURIComponent(WORLD));
  const current=onlineNames(world);
  const seen={...(cfg.kill_scan_recent_seen||{})};
  const canonicalNames={...(cfg.kill_scan_canonical_names||{})};
  for(const name of current){const k=keyName(name);seen[k]=nowIso;canonicalNames[k]=name}
  for(const [k,at] of Object.entries(seen)){
    const t=new Date(String(at)).getTime();
    if(!Number.isFinite(t)||now-t>RECENT_TTL){delete seen[k];delete canonicalNames[k]}
  }

  const lastByName={...(cfg.kill_scan_last_by_name||{})};
  const poolKeys=Object.keys(seen);
  poolKeys.sort((a,b)=>{
    const aa=new Date(lastByName[a]||0).getTime()||0,bb=new Date(lastByName[b]||0).getTime()||0;
    return aa-bb||a.localeCompare(b);
  });
  const selected=poolKeys.slice(0,Math.min(Number(batchSize)||DEFAULT_BATCH,poolKeys.length));
  const batch=selected.map(k=>canonicalNames[k]||k);

  const results=await mapLimit(batch,8,async victim=>{
    try{return {victim,key:keyName(victim),data:await getJson(CHAR_API+encodeURIComponent(victim))}}
    catch(error){return {victim,key:keyName(victim),error:error instanceof Error?error.message:String(error)}}
  });

  let newDeaths=0,newPvp=0,newAlerts=0,matchedDeaths=0,fetchErrors=0;
  const found=[],newAlertItems=[];
  const successfulKeys=[];

  for(const result of results){
    if(result.error||!result.data){fetchErrors++;continue}
    successfulKeys.push(result.key);
    for(const d of deathList(result.data)){
      const at=iso(d?.time);if(!at)continue;
      const killTs=new Date(at).getTime();
      if(now-killTs>DEATH_LOOKBACK||killTs>now+60000)continue;

      const killers=playerEntries(d?.killers,"KILLER");
      const assists=playerEntries(d?.assists,"ASSIST");
      const participants=[...killers,...assists];
      const tracked=participants.map(p=>({p,target:targetByName.get(keyName(p.name))})).filter(x=>x.target);
      if(!tracked.length)continue;

      matchedDeaths++;
      const victimName=result.victim;
      const victimTarget=targetByName.get(keyName(victimName));
      const deathKey=canonicalDeathKey(at,victimName);
      const {data:existingDeath}=await db.from("death_events").select("id").eq("dedupe_key",deathKey).maybeSingle();

      const deathPayload={
        character_id:victimTarget?.id??null,occurred_at:at,level:Number(d?.level)||null,
        killers:participants,source:"TIBIADATA",confidence:"HIGH",
        reference_url:CHAR_API+encodeURIComponent(victimName),
        raw_data:{world:WORLD,victim:victimName,reason:d?.reason||null,killers,assists,detected_at:nowIso,scanner:"KILL_SCAN_V3_WATCHLIST"},
        dedupe_key:deathKey
      };
      const deathUp=await db.from("death_events").upsert(deathPayload,{onConflict:"dedupe_key"});
      if(deathUp.error)throw deathUp.error;
      if(!existingDeath)newDeaths++;

      for(const {p,target} of tracked){
        const pvpKey=canonicalPvpKey(target.id,at,victimName,p.role);
        const {data:existingPvp}=await db.from("pvp_events").select("id").eq("dedupe_key",pvpKey).maybeSingle();
        const up=await db.from("pvp_events").upsert({
          character_id:target.id,opponent_name:victimName,role:p.role,occurred_at:at,
          source:"TIBIADATA",confidence:"HIGH",reference_url:CHAR_API+encodeURIComponent(victimName),
          raw_data:{victim:victimName,world:WORLD,killers,assists,detected_at:nowIso,scanner:"KILL_SCAN_V3_WATCHLIST",watchlist:isWatch(target)},
          dedupe_key:pvpKey
        },{onConflict:"dedupe_key"});
        if(up.error)throw up.error;
        if(!existingPvp)newPvp++;
      }

      const confirmedParticipants=tracked.filter(x=>isConfirmedPk(x.target));
      const watchParticipants=tracked.filter(x=>isWatch(x.target));
      if(confirmedParticipants.length&&watchParticipants.length){
        const pkNames=[...new Set(confirmedParticipants.map(x=>x.p.name))];
        for(const item of watchParticipants){
          if(await markWatchSuspect(db,item.target,"JOINT_KILL","participou da mesma kill de "+victimName+" junto com "+pkNames.join(", "),{victim:victimName,kill_at:at,confirmed_participants:pkNames,role:item.p.role,source:"TIBIADATA"},nowIso))newSuspects++;
        }
      }

      const confirmedKillers=killers.map(p=>({p,target:confirmedByName.get(keyName(p.name))})).filter(x=>x.target);
      const until=killTs+REVENGE_WINDOW;
      if(confirmedKillers.length){
        const names=[...new Set(confirmedKillers.map(x=>x.p.name))];
        const within=until>now;
        const alertKey="pvp-kill-alert:"+at+":"+keyName(victimName);
        if(within){
          const {data:existingAlert}=await db.from("alerts").select("id").eq("dedupe_key",alertKey).maybeSingle();
          const left=minsLeft(until,now);
          const body=(names.length===1?names[0]:names.join(", "))+" matou "+victimName+". Janela de revide até "+new Date(until).toLocaleTimeString("pt-BR",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"})+" — cerca de "+left+" min restantes.";
          const up=await db.from("alerts").upsert({
            character_id:confirmedKillers[0].target.id,title:"PK KILL DETECTADA",body,triggered_at:existingAlert?undefined:nowIso,
            dedupe_key:alertKey,metadata:{rule:"REVENGE_WINDOW",world:WORLD,victim:victimName,kill_at:at,detected_at:nowIso,retaliation_until:new Date(until).toISOString(),remaining_minutes:left,monitored_killers:names,killers,assists,source:"TIBIADATA"}
          },{onConflict:"dedupe_key"});
          if(up.error)throw up.error;
          if(!existingAlert){
            newAlerts++;
            newAlertItems.push({victim:victimName,killers:names,killAt:at,detectedAt:nowIso,retaliationUntil:new Date(until).toISOString(),remainingMinutes:left});
          }
        }
        found.push({victim:victimName,at,killers:names,within_window:within,retaliation_until:new Date(until).toISOString()});
      }
    }
  }

  for(const k of successfulKeys)lastByName[k]=nowIso;
  const keep=new Set(Object.keys(seen));
  for(const k of Object.keys(lastByName))if(!keep.has(k)&&now-(new Date(lastByName[k]).getTime()||0)>24*60*60*1000)delete lastByName[k];

  const estimatedCycleSeconds=poolKeys.length&&batch.length?Math.ceil(poolKeys.length/batch.length)*10:0;
  const nextCfg={
    ...cfg,
    kill_scan_version:3,
    kill_scan_mode:"JADEBRA_VICTIM_DEATH_SCAN_WATCHLIST",
    kill_scan_last_scan_at:nowIso,
    kill_scan_last_caller:caller,
    kill_scan_recent_seen:seen,
    kill_scan_canonical_names:canonicalNames,
    kill_scan_last_by_name:lastByName,
    kill_scan_pool_size:poolKeys.length,
    kill_scan_batch_size:batch.length,
    kill_scan_last_batch:batch,
    kill_scan_fetch_errors:fetchErrors,
    kill_scan_matched_deaths:matchedDeaths,
    kill_scan_new_deaths:newDeaths,
    kill_scan_new_pvp:newPvp,
    kill_scan_new_alerts:newAlerts,
    kill_scan_new_suspects:newSuspects,
    kill_scan_confirmed_pk_count:confirmed.length,
    kill_scan_watch_count:watch.length,
    kill_scan_estimated_cycle_seconds:estimatedCycleSeconds
  };
  if(sync?.id){
    const up=await db.from("source_syncs").update({
      enabled:true,status:"SUCCESS",last_success_at:nowIso,last_error:null,
      request_count:Number(sync.request_count||0)+batch.length+1,
      next_sync_at:new Date(now+10000).toISOString(),config:nextCfg,updated_at:nowIso
    }).eq("id",sync.id);
    if(up.error)throw up.error;
  }else{
    const up=await db.from("source_syncs").upsert({
      source:"TIBIADATA",enabled:true,status:"SUCCESS",last_success_at:nowIso,
      next_sync_at:new Date(now+10000).toISOString(),request_count:batch.length+1,
      config:nextCfg,updated_at:nowIso
    },{onConflict:"source"});
    if(up.error)throw up.error;
  }

  return {
    ok:true,skipped:false,online:current.length,pool:poolKeys.length,scanned:batch.length,
    tracked:active.length,confirmedPk:confirmed.length,watch:watch.length,
    matchedDeaths,newDeaths,newPvp,newAlerts,newSuspects,newAlertItems,fetchErrors,found,estimatedCycleSeconds,lastScanAt:nowIso
  };
}
