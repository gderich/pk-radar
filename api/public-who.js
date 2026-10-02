import {createClient} from "@supabase/supabase-js";

const TARGET_WORLD="Jadebra";
const norm=v=>String(v||"").trim().toLocaleLowerCase("en-US");

function origin(tags){
  return Array.isArray(tags)&&tags.includes("PK_SEED")?"ADICIONADO POR VOCÊ":"DESCOBERTO PELO SISTEMA";
}
function textCmp(a,b){return String(a??"").localeCompare(String(b??""),"pt-BR",{sensitivity:"base"})}
function externalMainFor(coreIds,allById,graph){
  const visited=new Set(coreIds),stack=[...coreIds];
  while(stack.length){
    const id=stack.pop();
    for(const next of graph.get(id)??[]){
      if(!visited.has(next)){visited.add(next);stack.push(next)}
    }
  }
  const connected=[...visited].map(id=>allById.get(id)).filter(Boolean);
  const jadebraMax=Math.max(0,...connected.filter(x=>x.worlds?.name===TARGET_WORLD).map(x=>Number(x.level||0)));
  const external=connected
    .filter(x=>x.worlds?.name&&x.worlds.name!==TARGET_WORLD&&Number(x.level||0)>0)
    .sort((a,b)=>Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name));
  const candidate=external[0];
  return candidate&&Number(candidate.level)>jadebraMax
    ?{name:candidate.name,world:candidate.worlds?.name,level:candidate.level??null,vocation:candidate.vocation??null}
    :null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","public, s-maxage=20, stale-while-revalidate=60");
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(500).json({error:"Public snapshot is not configured"});

  const db=createClient(url,key,{auth:{persistSession:false}});
  try{
    const [groupsRes,charsRes,relationsRes]=await Promise.all([
      db.from("identity_groups")
        .select("label,confidence,updated_at,identity_members(character_id,characters(id,name,level,vocation,tags,monitored,archived,worlds(name),guilds(name)))")
        .order("updated_at",{ascending:false}),
      db.from("characters")
        .select("id,name,level,vocation,tags,monitored,archived,worlds(name),guilds(name)")
        .eq("archived",false),
      db.from("player_relations")
        .select("character_a_id,character_b_id,status,manual_note")
        .eq("status","CONFIRMED")
    ]);
    if(groupsRes.error)throw groupsRes.error;
    if(charsRes.error)throw charsRes.error;
    if(relationsRes.error)throw relationsRes.error;

    const all=charsRes.data??[];
    const active=all.filter(c=>c.monitored&&c.worlds?.name===TARGET_WORLD);
    const activeIds=new Set(active.map(c=>c.id));
    const allById=new Map(all.map(c=>[c.id,c]));

    const graph=new Map();
    for(const r of relationsRes.data??[]){
      if(!String(r.manual_note||"").includes("Mesma conta pública"))continue;
      if(!graph.has(r.character_a_id))graph.set(r.character_a_id,new Set());
      if(!graph.has(r.character_b_id))graph.set(r.character_b_id,new Set());
      graph.get(r.character_a_id).add(r.character_b_id);
      graph.get(r.character_b_id).add(r.character_a_id);
    }

    const groupedIds=new Set();
    const profiles=[];
    for(const g of groupsRes.data??[]){
      const members=(g.identity_members??[])
        .map(m=>m.characters)
        .filter(Boolean)
        .filter(c=>activeIds.has(c.id))
        .sort((a,b)=>Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name));
      if(members.length<2)continue;
      members.forEach(c=>groupedIds.add(c.id));
      const main=externalMainFor(members.map(c=>c.id),allById,graph);
      profiles.push({
        label:members.map(c=>c.name).slice(0,4).join(" / ")+(members.length>4?" +"+(members.length-4):""),
        count:members.length,
        members:members.map(c=>({
          name:c.name,
          world:c.worlds?.name??TARGET_WORLD,
          level:c.level??null,
          vocation:c.vocation??null,
          guild:c.guilds?.name??null,
          origin:origin(c.tags)
        })),
        main
      });
    }
    profiles.sort((a,b)=>b.count-a.count||textCmp(a.label,b.label));

    const isolated=active
      .filter(c=>!groupedIds.has(c.id))
      .sort((a,b)=>textCmp(a.name,b.name))
      .map(c=>({
        name:c.name,
        world:c.worlds?.name??TARGET_WORLD,
        level:c.level??null,
        vocation:c.vocation??null,
        guild:c.guilds?.name??null,
        origin:origin(c.tags),
        main:externalMainFor([c.id],allById,graph)
      }));

    return res.status(200).json({
      title:"Quem é quem",
      world:TARGET_WORLD,
      updatedAt:new Date().toISOString(),
      totals:{characters:active.length,profiles:profiles.length,isolated:isolated.length},
      profiles,
      isolated
    });
  }catch(e){
    console.error("public-who",e);
    return res.status(500).json({error:"Não foi possível carregar o mapa público."});
  }
}
