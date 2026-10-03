import {supabase} from "./supabase";
import {TARGET_WORLD} from "./data";
import {PK_SEED_SET,stalkerEvidence} from "./seeds";

type Edge={a:string;b:string;strength:number;matches:number;kind:string};
type ExistingGroup={id:string;memberIds:Set<string>};

function pairKey(a:string,b:string){return [a,b].sort().join(":")}
function overlapCount(a:Set<string>,b:Set<string>){
  let n=0;for(const x of a)if(b.has(x))n++;return n;
}
export async function ensureAutonomousResetV4(){
  const {data:row,error}=await supabase.from("source_syncs").select("id,config").eq("source","MANUAL").maybeSingle();
  if(error)throw error;
  const config=(row?.config&&typeof row.config==="object")?row.config as Record<string,any>:{};
  if(Number(config.identity_mapping_version||0)>=4)return false;

  await supabase.from("identity_members").delete().neq("character_id","00000000-0000-0000-0000-000000000000");
  await supabase.from("identity_groups").delete().neq("id","00000000-0000-0000-0000-000000000000");
  await supabase.from("player_relations").delete().neq("id","00000000-0000-0000-0000-000000000000");
  await supabase.from("character_associations").delete().neq("character_a_id","00000000-0000-0000-0000-000000000000");
  await supabase.from("stalker_suggestions").delete().neq("id","00000000-0000-0000-0000-000000000000");

  const {data:allChars,error:charError}=await supabase.from("characters").select("id,name,tags,worlds(name)").eq("archived",false);
  if(charError)throw charError;
  const updates=(allChars??[]).map((ch:any)=>{
    const seed=PK_SEED_SET.has(String(ch.name).toLowerCase());
    const tags=seed
      ?[...new Set([...(ch.tags??[]).filter((t:string)=>!t.startsWith("DISCOVERY_DEPTH:")&&t!=="AUTO_DISCOVERED"&&t!=="AUTO_NOISE"),"PK_SEED"])]
      :[...(ch.tags??[]).filter((t:string)=>t!=="PK_SEED"&&!t.startsWith("DISCOVERY_DEPTH:")),"AUTO_NOISE"];
    return {id:ch.id,name:ch.name,tags,monitored:seed,archived:false,confidence:"LOW"};
  });
  if(updates.length){const u=await supabase.from("characters").upsert(updates,{onConflict:"id"});if(u.error)throw u.error}

  const nextConfig={...config,identity_mapping_version:4,identity_mapping_reset_at:new Date().toISOString(),mapping_anchor:"PK_SEEDS"};
  if(row?.id){
    const {error:updateError}=await supabase.from("source_syncs").update({config:nextConfig}).eq("id",row.id);
    if(updateError)throw updateError;
  }else{
    const {error:insertError}=await supabase.from("source_syncs").upsert({source:"MANUAL",enabled:true,status:"SUCCESS",config:nextConfig},{onConflict:"source"});
    if(insertError)throw insertError;
  }
  return true;
}

async function reconcileClusters(
  clusters:string[][],
  byId:Map<string,any>,
  edgeList:Edge[]
){
  const {data:existingRows,error}=await supabase
    .from("identity_groups")
    .select("id,identity_members(character_id)");
  if(error)throw error;

  const existing:ExistingGroup[]=(existingRows??[]).map((g:any)=>({
    id:g.id,
    memberIds:new Set<string>((g.identity_members??[]).map((m:any)=>m.character_id))
  }));
  const used=new Set<string>();
  const desiredGroupIds:string[]=[];

  for(const ids of clusters){
    if(ids.length<2)continue;
    const desired=new Set(ids);
    let chosen:ExistingGroup|undefined;
    let bestOverlap=0;
    let bestRatio=0;
    for(const g of existing){
      if(used.has(g.id))continue;
      const overlap=overlapCount(desired,g.memberIds);
      if(!overlap)continue;
      const ratio=overlap/Math.max(desired.size,g.memberIds.size);
      if(overlap>bestOverlap||(overlap===bestOverlap&&ratio>bestRatio)){
        chosen=g;bestOverlap=overlap;bestRatio=ratio;
      }
    }

    let groupId=chosen?.id;
    if(!groupId){
      const {data:g,error:createError}=await supabase
        .from("identity_groups")
        .insert({label:"Perfil automático",confidence:"HIGH",notes:"AUTO · perfil persistente"})
        .select("id")
        .single();
      if(createError||!g)throw createError||new Error("Falha ao criar perfil automático");
      groupId=g.id;
    }
    used.add(groupId);
    desiredGroupIds.push(groupId);

    const cs=ids.map(id=>byId.get(id)).filter(Boolean);
    const internal=edgeList.filter(e=>desired.has(e.a)&&desired.has(e.b));
    const avg=internal.length?Math.round(internal.reduce((n,e)=>n+e.strength,0)/internal.length):0;
    const max=Math.max(0,...internal.map(e=>e.strength));
    const label=cs.slice(0,4).map((x:any)=>x.name).join(" / ")+(cs.length>4?" +"+(cs.length-4):"");
    const confidence=max===100&&internal.length>0&&internal.every(e=>e.strength===100)?"CONFIRMED":"HIGH";
    const stalkerMatches=internal.filter(e=>e.kind==="STALKER_MATCHES").map(e=>e.matches);\n    const evidenceText=stalkerMatches.length?" · Stalker mínimo "+Math.min(...stalkerMatches)+" matches":"";\n    const notes="AUTO · "+ids.length+" chars · "+internal.length+" relações fortes"+evidenceText+" · sem percentual artificial";

    const {error:updateError}=await supabase.from("identity_groups").update({
      label,confidence,notes,updated_at:new Date().toISOString()
    }).eq("id",groupId);
    if(updateError)throw updateError;

    const current=chosen?.memberIds??new Set<string>();
    const stale=[...current].filter(id=>!desired.has(id));
    if(stale.length){
      const del=await supabase.from("identity_members").delete().eq("group_id",groupId).in("character_id",stale);
      if(del.error)throw del.error;
    }

    // Remove each desired char from any old group before attaching it to this persistent group.
    const move=await supabase.from("identity_members").delete().in("character_id",ids).neq("group_id",groupId);
    if(move.error)throw move.error;

    const rows=cs.map((ch:any)=>{
      const support=internal.filter(e=>e.a===ch.id||e.b===ch.id);
      const score=support.length?Math.max(...support.map(e=>e.strength)):1;
      return {
        group_id:groupId,
        character_id:ch.id,
        source:"AUTO_V5",
        confidence_score:score,
        notes:support.length?support.map(e=>e.kind+" "+e.matches+"m").join(" · "):"Ligação transitiva forte dentro do componente"
      };
    });
    if(rows.length){
      const up=await supabase.from("identity_members").upsert(rows,{onConflict:"character_id"});
      if(up.error)throw up.error;
    }
  }

  const obsolete=existing.map(g=>g.id).filter(id=>!used.has(id));
  if(obsolete.length){
    const del=await supabase.from("identity_groups").delete().in("id",obsolete);
    if(del.error)throw del.error;
  }
  return desiredGroupIds.length;
}

export async function rebuildAutomaticIdentities(){
  const [charsRes,sugRes,relRes,deathRes]=await Promise.all([
    supabase.from("characters").select("id,name,monitored,tags,worlds(name)").eq("archived",false).eq("monitored",true),
    supabase.from("stalker_suggestions").select("character_id,suggested_name,match_count,relative_score,first_match_date,last_match_date,characters(name,worlds(name))"),
    supabase.from("player_relations").select("character_a_id,character_b_id,status,confidence_score"),
    supabase.from("death_events").select("killers,raw_data,occurred_at").order("occurred_at",{ascending:false}).limit(3000)
  ]);
  if(charsRes.error)throw charsRes.error;
  if(sugRes.error)throw sugRes.error;
  if(relRes.error)throw relRes.error;
  if(deathRes.error)throw deathRes.error;

  const chars=(charsRes.data??[]).filter((c:any)=>
    c.worlds?.name===TARGET_WORLD&&(
      PK_SEED_SET.has(String(c.name).toLowerCase())||
      (c.tags??[]).includes("PK_SEED")||
      (c.tags??[]).includes("AUTO_DISCOVERED")
    )
  );
  const byId=new Map(chars.map((c:any)=>[c.id,c]));
  const byName=new Map(chars.map((c:any)=>[String(c.name).toLowerCase(),c]));

  // If two monitored chars are seen in the same kill, they were simultaneously active.
  // Treat that as a hard blocker against merging those two components.
  const coKillPairs=new Set<string>();
  for(const d of deathRes.data??[]){
    const names=(Array.isArray((d as any).killers)?(d as any).killers:[])
      .map((k:any)=>String(k?.name||k||"").toLowerCase())
      .filter((n:string)=>byName.has(n));
    for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
      const a=byName.get(names[i]),b=byName.get(names[j]);
      if(a&&b&&a.id!==b.id)coKillPairs.add(pairKey(a.id,b.id));
    }
  }

  const directed=new Map<string,any>();
  for(const s of sugRes.data??[]){
    const a=byId.get((s as any).character_id);
    const b=byName.get(String((s as any).suggested_name||"").toLowerCase());
    if(!a||!b||a.id===b.id)continue;
    directed.set(a.id+">"+b.id,s);
  }

  const edges=new Map<string,Edge>();
  for(const r of relRes.data??[]){
    const a=byId.get((r as any).character_a_id),b=byId.get((r as any).character_b_id);
    if(!a||!b||coKillPairs.has(pairKey(a.id,b.id)))continue;
    if((r as any).status==="CONFIRMED"){
      edges.set(pairKey(a.id,b.id),{a:a.id,b:b.id,strength:100,matches:999,kind:"PUBLIC_ACCOUNT"});
    }
  }

  for(let i=0;i<chars.length;i++)for(let j=i+1;j<chars.length;j++){
    const a=chars[i],b=chars[j];
    if(coKillPairs.has(pairKey(a.id,b.id)))continue;
    const ab=directed.get(a.id+">"+b.id),ba=directed.get(b.id+">"+a.id);
    const arr=[ab,ba].filter(Boolean);
    if(!arr.length)continue;
    const best=[...arr].sort((x:any,y:any)=>Number(y.match_count||0)-Number(x.match_count||0))[0];
    const bestMatches=Number(best.match_count||0);
    const evidence=stalkerEvidence(bestMatches,best.first_match_date,best.last_match_date);
    if(evidence.autoGroup){
      const key=pairKey(a.id,b.id),old=edges.get(key);
      if(!old||evidence.internalStrength>old.strength)edges.set(key,{a:a.id,b:b.id,strength:evidence.internalStrength,matches:bestMatches,kind:"STALKER_MATCHES"});
    }
  }

  const parent=new Map<string,string>();
  const componentMembers=new Map<string,Set<string>>();
  for(const ch of chars){parent.set(ch.id,ch.id);componentMembers.set(ch.id,new Set([ch.id]))}
  function find(x:string):string{
    const p=parent.get(x)!;if(p===x)return x;
    const root=find(p);parent.set(x,root);return root;
  }
  function componentsConflict(a:Set<string>,b:Set<string>){
    for(const x of a)for(const y of b)if(coKillPairs.has(pairKey(x,y)))return true;
    return false;
  }
  function union(a:string,b:string){
    let ra=find(a),rb=find(b);if(ra===rb)return;
    let A=componentMembers.get(ra)!,B=componentMembers.get(rb)!;
    if(componentsConflict(A,B))return;
    if(A.size<B.size){[ra,rb]=[rb,ra];[A,B]=[B,A]}
    parent.set(rb,ra);
    for(const x of B)A.add(x);
    componentMembers.delete(rb);
  }

  const edgeList=[...edges.values()].sort((a,b)=>b.strength-a.strength||b.matches-a.matches);
  // Unlimited transitive closure: every accepted strong edge may extend an identity component.
  for(const e of edgeList)union(e.a,e.b);

  const clusters=[...componentMembers.values()].map(s=>[...s]).sort((a,b)=>b.length-a.length);
  const grouped=clusters.filter(ids=>ids.length>1);
  const profileCount=await reconcileClusters(grouped,byId,edgeList);

  return {
    profiles:profileCount,
    strongEdges:edgeList.length,
    chars:chars.length,
    isolated:clusters.filter(ids=>ids.length===1).length,
    largestCluster:Math.max(0,...clusters.map(ids=>ids.length))
  };
}
