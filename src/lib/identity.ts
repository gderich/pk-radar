import {supabase} from "./supabase";
import {TARGET_WORLD} from "./data";
import {PK_SEED_SET} from "./seeds";

type Edge={a:string;b:string;strength:number;matches:number;kind:string};
function pairKey(a:string,b:string){return [a,b].sort().join(":")}
function daysBetween(a:any,b:any){if(!a||!b)return 0;const x=new Date(a).getTime(),y=new Date(b).getTime();if(!Number.isFinite(x)||!Number.isFinite(y))return 0;return Math.max(0,Math.round(Math.abs(y-x)/86400000))}

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
    const tags=seed?[...new Set([...(ch.tags??[]).filter((t:string)=>!t.startsWith("DISCOVERY_DEPTH:")&&t!=="AUTO_DISCOVERED"&&t!=="AUTO_NOISE"),"PK_SEED"])]:[...(ch.tags??[]).filter((t:string)=>t!=="PK_SEED"&&!t.startsWith("DISCOVERY_DEPTH:")),"AUTO_NOISE"];
    return {id:ch.id,name:ch.name,tags,monitored:seed,archived:false};
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

export async function rebuildAutomaticIdentities(){
  const [charsRes,sugRes,relRes]=await Promise.all([
    supabase.from("characters").select("id,name,monitored,tags,worlds(name)").eq("archived",false).eq("monitored",true),
    supabase.from("stalker_suggestions").select("character_id,suggested_name,match_count,relative_score,first_match_date,last_match_date,characters(name,worlds(name))"),
    supabase.from("player_relations").select("character_a_id,character_b_id,status,confidence_score")
  ]);
  if(charsRes.error)throw charsRes.error;
  if(sugRes.error)throw sugRes.error;
  if(relRes.error)throw relRes.error;

  const chars=(charsRes.data??[]).filter((c:any)=>c.worlds?.name===TARGET_WORLD&&(PK_SEED_SET.has(String(c.name).toLowerCase())||(c.tags??[]).includes("PK_SEED")||(c.tags??[]).includes("AUTO_DISCOVERED")));
  const byId=new Map(chars.map((c:any)=>[c.id,c]));
  const byName=new Map(chars.map((c:any)=>[String(c.name).toLowerCase(),c]));
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
    if(!a||!b)continue;
    if((r as any).status==="CONFIRMED"){
      edges.set(pairKey(a.id,b.id),{a:a.id,b:b.id,strength:100,matches:999,kind:"PUBLIC_ACCOUNT"});
    }
  }

  for(const a of chars){
    for(const b of chars){
      if(a.id>=b.id)continue;
      const ab=directed.get(a.id+">"+b.id);
      const ba=directed.get(b.id+">"+a.id);
      const arr=[ab,ba].filter(Boolean);
      if(!arr.length)continue;
      const best=arr.sort((x:any,y:any)=>Number(y.match_count||0)-Number(x.match_count||0))[0];
      const bestScore=Number(best.relative_score||0),bestMatches=Number(best.match_count||0);
      const span=daysBetween(best.first_match_date,best.last_match_date);

      let strength=0,kind="";
      if(ab&&ba){
        const minScore=Math.min(Number(ab.relative_score||0),Number(ba.relative_score||0));
        const minMatches=Math.min(Number(ab.match_count||0),Number(ba.match_count||0));
        const minSpan=Math.min(daysBetween(ab.first_match_date,ab.last_match_date),daysBetween(ba.first_match_date,ba.last_match_date));
        if(minScore>=70&&minMatches>=20&&minSpan>=7){
          strength=Math.min(99,Math.round(55+minScore*.25+Math.min(120,minMatches)*.15+Math.min(60,minSpan)*.08));
          kind="RECIPROCAL";
        }
      }
      if(!strength&&bestScore>=95&&bestMatches>=80&&span>=30){
        strength=Math.min(97,Math.round(72+Math.min(150,bestMatches)*.12+Math.min(90,span)*.05));
        kind="ULTRA_ONE_WAY";
      }
      if(strength){
        const key=pairKey(a.id,b.id);
        const existing=edges.get(key);
        if(!existing||strength>existing.strength)edges.set(key,{a:a.id,b:b.id,strength,matches:bestMatches,kind});
      }
    }
  }

  const parent=new Map<string,string>(); const members=new Map<string,Set<string>>();
  for(const c of chars){parent.set(c.id,c.id);members.set(c.id,new Set([c.id]))}
  function find(x:string):string{const p=parent.get(x)!;if(p===x)return x;const r=find(p);parent.set(x,r);return r}
  function union(a:string,b:string){let ra=find(a),rb=find(b);if(ra===rb)return;const A=members.get(ra)!,B=members.get(rb)!;if(A.size<B.size){[ra,rb]=[rb,ra]}parent.set(rb,ra);for(const x of members.get(rb)!)members.get(ra)!.add(x);members.delete(rb)}
  const edgeList=[...edges.values()].sort((a,b)=>b.strength-a.strength||b.matches-a.matches);
  const edgeLookup=new Map(edgeList.map(e=>[pairKey(e.a,e.b),e]));
  for(const e of edgeList){
    const ra=find(e.a),rb=find(e.b);if(ra===rb)continue;
    const A=members.get(ra)!,B=members.get(rb)!;const larger=Math.max(A.size,B.size);
    let cross=0,best=0;
    for(const x of A)for(const y of B){const ce=edgeLookup.get(pairKey(x,y));if(ce){cross++;best=Math.max(best,ce.strength)}}
    const required=larger<=2?1:Math.ceil(larger*.5);
    if(best>=90&&cross>=required)union(e.a,e.b);
  }

  const clusters=[...members.values()].map(set=>[...set]).sort((a,b)=>b.length-a.length);
  await supabase.from("identity_members").delete().neq("character_id","00000000-0000-0000-0000-000000000000");
  await supabase.from("identity_groups").delete().neq("id","00000000-0000-0000-0000-000000000000");

  for(const ids of clusters){
    const cs=ids.map(id=>byId.get(id)).filter(Boolean);
    const internal=edgeList.filter(e=>ids.includes(e.a)&&ids.includes(e.b));
    const avg=internal.length?Math.round(internal.reduce((n,e)=>n+e.strength,0)/internal.length):0;
    const max=Math.max(0,...internal.map(e=>e.strength));
    const label=cs.slice(0,4).map((x:any)=>x.name).join(" / ")+(cs.length>4?" +"+(cs.length-4):"");
    const confidence=max===100&&internal.every(e=>e.strength===100)?"CONFIRMED":internal.length?"HIGH":"LOW";
    const {data:g,error}=await supabase.from("identity_groups").insert({
      label,confidence,
      notes:ids.length===1?"AUTO · ainda sem ligação forte":"AUTO · "+ids.length+" chars · "+internal.length+" relações fortes · confiança média "+avg+"%"
    }).select("id").single();
    if(error||!g)throw error||new Error("Falha ao criar perfil automático");
    const rows=cs.map((ch:any)=>{
      const support=internal.filter(e=>e.a===ch.id||e.b===ch.id);
      const score=support.length?Math.max(...support.map(e=>e.strength)):0;
      return {group_id:g.id,character_id:ch.id,source:"AUTO_V3",confidence_score:score||1,notes:support.length?support.map(e=>e.kind+" "+e.matches+"m").join(" · "):"Sem ligação forte ainda"};
    });
    if(rows.length){const ins=await supabase.from("identity_members").insert(rows);if(ins.error)throw ins.error}
  }
  return {profiles:clusters.length,strongEdges:edgeList.length,chars:chars.length};
}
