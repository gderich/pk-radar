import {MANUAL_IDENTITY_SETS,PK_SEED_SET,discoveryRule,stalkerEvidence} from "./seeds.mjs";
function pairKey(a,b){return [a,b].sort().join(":")}
function overlapCount(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n}

function nameKey(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
async function ensureManualIdentityRelations(db){
  const {data:chars,error}=await db.from("characters").select("id,name,archived").eq("archived",false);
  if(error)throw error;
  const byName=new Map((chars??[]).map(x=>[nameKey(x.name),x]));
  const rows=[];
  for(const set of MANUAL_IDENTITY_SETS){
    const ids=set.map(name=>byName.get(nameKey(name))).filter(Boolean);
    if(ids.length<2)continue;
    const anchor=ids[0];
    for(const ch of ids.slice(1)){
      const [a,b]=[anchor.id,ch.id].sort();
      rows.push({character_a_id:a,character_b_id:b,status:"CONFIRMED",confidence_score:100,manual_note:"Observação manual confirmada pelo usuário",reviewed_at:new Date().toISOString()});
    }
  }
  if(rows.length){const up=await db.from("player_relations").upsert(rows,{onConflict:"character_a_id,character_b_id"});if(up.error)throw up.error}
}
export async function pruneUnsupportedDiscoveries(db){
  await ensureManualIdentityRelations(db);
  const [charsRes,sugRes,relRes]=await Promise.all([
    db.from("characters").select("id,name,source,monitored,online,tags,confidence,data_state,worlds(name)").eq("archived",false),
    db.from("stalker_suggestions").select("id,character_id,suggested_name,match_count,first_match_date,last_match_date"),
    db.from("player_relations").select("id,character_a_id,character_b_id,status,manual_note")
  ]);
  if(charsRes.error)throw charsRes.error;if(sugRes.error)throw sugRes.error;if(relRes.error)throw relRes.error;
  const chars=charsRes.data??[],jade=chars.filter(ch=>ch.worlds?.name==="Jadebra");
  const byId=new Map(jade.map(ch=>[ch.id,ch])),byName=new Map(jade.map(ch=>[nameKey(ch.name),ch]));
  const anchors=new Set(),depth=new Map();
  for(const ch of jade){
    const manual=PK_SEED_SET.has(nameKey(ch.name))||(ch.tags??[]).includes("PK_SEED")||ch.source==="MANUAL";
    if(manual){anchors.add(ch.id);depth.set(ch.id,0)}
  }
  const confirmedGraph=new Map();
  for(const r of relRes.data??[]){
    if(r.status!=="CONFIRMED")continue;
    const a=byId.get(r.character_a_id),b=byId.get(r.character_b_id);if(!a||!b)continue;
    if(!confirmedGraph.has(a.id))confirmedGraph.set(a.id,new Set());if(!confirmedGraph.has(b.id))confirmedGraph.set(b.id,new Set());
    confirmedGraph.get(a.id).add(b.id);confirmedGraph.get(b.id).add(a.id);
  }
  const suggestionsBySource=new Map();
  for(const s of sugRes.data??[]){if(!byId.has(s.character_id))continue;const arr=suggestionsBySource.get(s.character_id)??[];arr.push(s);suggestionsBySource.set(s.character_id,arr)}
  const queue=[...anchors];
  while(queue.length){
    const sourceId=queue.shift(),sourceDepth=depth.get(sourceId)??0;
    for(const next of confirmedGraph.get(sourceId)??[]){if(!depth.has(next)){depth.set(next,sourceDepth);queue.push(next)}}
    for(const s of suggestionsBySource.get(sourceId)??[]){
      const target=byName.get(nameKey(s.suggested_name));if(!target||target.id===sourceId||depth.has(target.id))continue;
      if(!discoveryRule(sourceDepth,0,Number(s.match_count||0),s.first_match_date,s.last_match_date))continue;
      depth.set(target.id,sourceDepth+1);queue.push(target.id);
    }
  }
  const removed=[],kept=[],updates=[];
  for(const ch of jade){
    const isAnchor=anchors.has(ch.id),reachable=depth.has(ch.id);
    const base=(ch.tags??[]).filter(t=>t!=="AUTO_NOISE"&&t!=="AUTO_DISCOVERED"&&!String(t).startsWith("DISCOVERY_DEPTH:"));
    if(isAnchor){updates.push({id:ch.id,name:ch.name,monitored:true,tags:[...new Set([...base,"PK_SEED"])]});kept.push(ch);continue}
    if(reachable){const d=Math.max(1,depth.get(ch.id)??1);updates.push({id:ch.id,name:ch.name,monitored:true,tags:[...new Set([...base.filter(t=>t!=="PK_SEED"),"AUTO_DISCOVERED","DISCOVERY_DEPTH:"+d])]});kept.push(ch);continue}
    const automatic=(ch.tags??[]).includes("AUTO_DISCOVERED")||ch.source==="TIBIA_STALKER"||(ch.tags??[]).includes("AUTO_NOISE");
    if(automatic){updates.push({id:ch.id,name:ch.name,monitored:false,online:false,confidence:"LOW",data_state:"DESCARTADO_SEM_SUPORTE",tags:[...new Set([...base.filter(t=>t!=="PK_SEED"),"AUTO_NOISE"])]});removed.push(ch)}
  }
  if(updates.length){
    for(const row of updates){
      const {id,...patch}=row;
      const up=await db.from("characters").update(patch).eq("id",id);
      if(up.error)throw up.error;
    }
  }
  const scoreReset=await db.from("stalker_suggestions").update({relative_score:0}).neq("id","00000000-0000-0000-0000-000000000000");if(scoreReset.error)throw scoreReset.error;
  const staleRel=await db.from("player_relations").delete().neq("status","CONFIRMED").ilike("manual_note","Correlação automática do Tibia Stalker%");if(staleRel.error)throw staleRel.error;
  if(removed.length){const del=await db.from("identity_members").delete().in("character_id",removed.map(x=>x.id));if(del.error)throw del.error}
  return {removed:removed.length,removedNames:removed.map(x=>x.name).sort(),kept:kept.length,anchors:anchors.size,reachable:depth.size};
}


export async function ensureEvidenceCleanupV6(db){
  const {data:row,error}=await db.from("source_syncs").select("id,config").eq("source","MANUAL").maybeSingle();
  if(error)throw error;
  const config=row?.config&&typeof row.config==="object"?row.config:{};
  if(Number(config.identity_mapping_version||0)>=6)return {ran:false,removed:0,removedNames:[]};
  const result=await pruneUnsupportedDiscoveries(db);
  const nextConfig={
    ...config,
    identity_mapping_version:6,
    evidence_cleanup_v6_at:new Date().toISOString(),
    evidence_cleanup_v6_removed:result.removed,
    evidence_cleanup_v6_removed_names:result.removedNames,
    evidence_cleanup_v6_reachable:result.reachable,
    evidence_cleanup_v6_rule:"ANCHOR_REACHABILITY_MATCH_COUNT_ONLY"
  };
  if(row?.id){
    const u=await db.from("source_syncs").update({config:nextConfig,updated_at:new Date().toISOString()}).eq("id",row.id);
    if(u.error)throw u.error;
  }else{
    const u=await db.from("source_syncs").upsert({source:"MANUAL",enabled:true,status:"SUCCESS",config:nextConfig,updated_at:new Date().toISOString()},{onConflict:"source"});
    if(u.error)throw u.error;
  }
  return {ran:true,...result};
}

async function reconcileClusters(db,clusters,byId,edgeList){
  const {data:existingRows,error}=await db.from("identity_groups").select("id,identity_members(character_id)");
  if(error)throw error;
  const existing=(existingRows??[]).map(g=>({id:g.id,memberIds:new Set((g.identity_members??[]).map(m=>m.character_id))}));
  const used=new Set();let count=0;
  for(const ids of clusters){
    if(ids.length<2)continue;
    const desired=new Set(ids);let chosen,bestOverlap=0,bestRatio=0;
    for(const g of existing){
      if(used.has(g.id))continue;
      const overlap=overlapCount(desired,g.memberIds);if(!overlap)continue;
      const ratio=overlap/Math.max(desired.size,g.memberIds.size);
      if(overlap>bestOverlap||(overlap===bestOverlap&&ratio>bestRatio)){chosen=g;bestOverlap=overlap;bestRatio=ratio}
    }
    let groupId=chosen?.id;
    if(!groupId){
      const {data:g,error:createError}=await db.from("identity_groups").insert({label:"Perfil automático",confidence:"HIGH",notes:"AUTO · perfil persistente"}).select("id").single();
      if(createError||!g)throw createError||new Error("Falha ao criar perfil automático");
      groupId=g.id;
    }
    used.add(groupId);count++;
    const cs=ids.map(id=>byId.get(id)).filter(Boolean),internal=edgeList.filter(e=>desired.has(e.a)&&desired.has(e.b));
    const avg=internal.length?Math.round(internal.reduce((n,e)=>n+e.strength,0)/internal.length):0,max=Math.max(0,...internal.map(e=>e.strength));
    const label=cs.slice(0,4).map(x=>x.name).join(" / ")+(cs.length>4?" +"+(cs.length-4):"");
    const confidence=max===100&&internal.length>0&&internal.every(e=>e.strength===100)?"CONFIRMED":"HIGH";
    const stalkerMatches=internal.filter(e=>e.kind==="STALKER_MATCHES").map(e=>e.matches);
    const evidenceText=stalkerMatches.length?" · Stalker mínimo "+Math.min(...stalkerMatches)+" matches":"";
    const notes="AUTO · "+ids.length+" chars · "+internal.length+" relações fortes"+evidenceText+" · sem percentual artificial";
    const upGroup=await db.from("identity_groups").update({label,confidence,notes,updated_at:new Date().toISOString()}).eq("id",groupId);if(upGroup.error)throw upGroup.error;

    const current=chosen?.memberIds??new Set();
    const stale=[...current].filter(id=>!desired.has(id));
    if(stale.length){const del=await db.from("identity_members").delete().eq("group_id",groupId).in("character_id",stale);if(del.error)throw del.error}
    const move=await db.from("identity_members").delete().in("character_id",ids).neq("group_id",groupId);if(move.error)throw move.error;

    const rows=cs.map(ch=>{
      const support=internal.filter(e=>e.a===ch.id||e.b===ch.id),score=support.length?Math.max(...support.map(e=>e.strength)):1;
      const hasPublic=support.some(e=>e.kind==="PUBLIC_ACCOUNT");
      const stalkerMatches=support.filter(e=>e.kind==="STALKER_MATCHES").map(e=>e.matches);
      const bestStalker=stalkerMatches.length?Math.max(...stalkerMatches):0;
      const notes=hasPublic&&bestStalker
        ?"Conta pública + Tibia Stalker · "+bestStalker+" matches"
        :hasPublic
          ?"Mesma conta pública"
          :bestStalker
            ?"Tibia Stalker · "+bestStalker+" matches"
            :"Ligação transitiva forte dentro do componente";
      return {group_id:groupId,character_id:ch.id,source:"AUTO_V6",confidence_score:score,notes};
    });
    if(rows.length){const up=await db.from("identity_members").upsert(rows,{onConflict:"character_id"});if(up.error)throw up.error}
  }
  const obsolete=existing.map(g=>g.id).filter(id=>!used.has(id));
  if(obsolete.length){const del=await db.from("identity_groups").delete().in("id",obsolete);if(del.error)throw del.error}
  return count;
}

export async function rebuildAutomaticIdentities(db){
  const cleanup=await pruneUnsupportedDiscoveries(db);
  const [charsRes,sugRes,relRes,deathRes]=await Promise.all([
    db.from("characters").select("id,name,monitored,tags,worlds(name)").eq("archived",false).eq("monitored",true),
    db.from("stalker_suggestions").select("character_id,suggested_name,match_count,relative_score,first_match_date,last_match_date,characters(name,worlds(name))"),
    db.from("player_relations").select("character_a_id,character_b_id,status,confidence_score"),
    db.from("death_events").select("killers,raw_data,occurred_at").order("occurred_at",{ascending:false}).limit(3000)
  ]);
  if(charsRes.error)throw charsRes.error;if(sugRes.error)throw sugRes.error;if(relRes.error)throw relRes.error;if(deathRes.error)throw deathRes.error;

  const chars=(charsRes.data??[]).filter(c=>c.worlds?.name==="Jadebra"&&(PK_SEED_SET.has(String(c.name).toLowerCase())||(c.tags??[]).includes("PK_SEED")||(c.tags??[]).includes("AUTO_DISCOVERED")));
  const byId=new Map(chars.map(c=>[c.id,c])),byName=new Map(chars.map(c=>[String(c.name).toLowerCase(),c]));

  const coKillPairs=new Set();
  for(const d of deathRes.data??[]){
    const names=(Array.isArray(d.killers)?d.killers:[]).map(k=>String(k?.name||k||"").toLowerCase()).filter(n=>byName.has(n));
    for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){const a=byName.get(names[i]),b=byName.get(names[j]);if(a&&b&&a.id!==b.id)coKillPairs.add(pairKey(a.id,b.id))}
  }

  const directed=new Map();
  for(const s of sugRes.data??[]){const a=byId.get(s.character_id),b=byName.get(String(s.suggested_name||"").toLowerCase());if(a&&b&&a.id!==b.id)directed.set(a.id+">"+b.id,s)}
  const edges=new Map();
  for(const r of relRes.data??[]){const a=byId.get(r.character_a_id),b=byId.get(r.character_b_id);if(a&&b&&!coKillPairs.has(pairKey(a.id,b.id))&&r.status==="CONFIRMED")edges.set(pairKey(a.id,b.id),{a:a.id,b:b.id,strength:100,matches:999,kind:"PUBLIC_ACCOUNT"})}

  for(let i=0;i<chars.length;i++)for(let j=i+1;j<chars.length;j++){
    const a=chars[i],b=chars[j];if(coKillPairs.has(pairKey(a.id,b.id)))continue;
    const ab=directed.get(a.id+">"+b.id),ba=directed.get(b.id+">"+a.id),arr=[ab,ba].filter(Boolean);if(!arr.length)continue;
    const best=[...arr].sort((x,y)=>Number(y.match_count||0)-Number(x.match_count||0))[0],bestMatches=Number(best.match_count||0);
    const evidence=stalkerEvidence(bestMatches,best.first_match_date,best.last_match_date);
    if(evidence.autoGroup){const key=pairKey(a.id,b.id),old=edges.get(key);if(!old||evidence.internalStrength>old.strength)edges.set(key,{a:a.id,b:b.id,strength:evidence.internalStrength,matches:bestMatches,kind:"STALKER_MATCHES"})}
  }

  const parent=new Map(),componentMembers=new Map();for(const c of chars){parent.set(c.id,c.id);componentMembers.set(c.id,new Set([c.id]))}
  function find(x){const p=parent.get(x);if(p===x)return x;const root=find(p);parent.set(x,root);return root}
  function conflict(A,B){for(const x of A)for(const y of B)if(coKillPairs.has(pairKey(x,y)))return true;return false}
  function union(a,b){let ra=find(a),rb=find(b);if(ra===rb)return;let A=componentMembers.get(ra),B=componentMembers.get(rb);if(conflict(A,B))return;if(A.size<B.size){[ra,rb]=[rb,ra];[A,B]=[B,A]}parent.set(rb,ra);for(const x of B)A.add(x);componentMembers.delete(rb)}
  const edgeList=[...edges.values()].sort((a,b)=>b.strength-a.strength||b.matches-a.matches);
  for(const e of edgeList)union(e.a,e.b);

  const clusters=[...componentMembers.values()].map(s=>[...s]).sort((a,b)=>b.length-a.length),grouped=clusters.filter(ids=>ids.length>1);
  const profiles=await reconcileClusters(db,grouped,byId,edgeList);
  return {profiles,strongEdges:edgeList.length,chars:chars.length,isolated:clusters.filter(ids=>ids.length===1).length,largestCluster:Math.max(0,...clusters.map(ids=>ids.length)),cleanup}
}
