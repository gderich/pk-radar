import {PK_SEED_SET,stalkerEvidence} from "./seeds.mjs";
function pairKey(a,b){return [a,b].sort().join(":")}
function overlapCount(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n}
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

    const rows=cs.map(ch=>{const support=internal.filter(e=>e.a===ch.id||e.b===ch.id),score=support.length?Math.max(...support.map(e=>e.strength)):1;return {group_id:groupId,character_id:ch.id,source:"AUTO_V5",confidence_score:score,notes:support.length?support.map(e=>e.kind+" "+e.matches+"m").join(" · "):"Ligação transitiva forte dentro do componente"}});
    if(rows.length){const up=await db.from("identity_members").upsert(rows,{onConflict:"character_id"});if(up.error)throw up.error}
  }
  const obsolete=existing.map(g=>g.id).filter(id=>!used.has(id));
  if(obsolete.length){const del=await db.from("identity_groups").delete().in("id",obsolete);if(del.error)throw del.error}
  return count;
}

export async function rebuildAutomaticIdentities(db){
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
  return {profiles,strongEdges:edgeList.length,chars:chars.length,isolated:clusters.filter(ids=>ids.length===1).length,largestCluster:Math.max(0,...clusters.map(ids=>ids.length))}
}
