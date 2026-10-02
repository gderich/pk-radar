import {useEffect,useMemo,useState} from "react";
import {Activity,Bell,Database,LayoutDashboard,Network,Search,Skull,Swords,Users,Wifi} from "lucide-react";
import {Link,NavLink,Navigate,Route,Routes,useLocation,useParams} from "react-router-dom";

const nav=[
  ["/publico/dashboard","Dashboard",LayoutDashboard],
  ["/publico/personagens","Personagens",Users],
  ["/publico/quem-e-quem","Quem é quem",Network],
  ["/publico/horarios","Horários",Activity],
  ["/publico/kills","Kills",Skull],
  ["/publico/eventos","Eventos",Activity],
  ["/publico/alertas","Alertas",Bell],
  ["/publico/fontes","Fontes",Database]
] as const;

function fmt(v:any){return v?new Date(v).toLocaleString("pt-BR"):"—"}
function textCmp(a:any,b:any){return String(a??"").localeCompare(String(b??""),"pt-BR",{sensitivity:"base"})}
function age(v:any){return v?Date.now()-new Date(v).getTime():Infinity}
function dateNum(v:any){const n=v?new Date(v).getTime():0;return Number.isFinite(n)?n:0}
function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:string}){return <span className={"badge "+tone}>{children}</span>}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function Origin({value}:{value:string}){return <Badge tone={value==="ADICIONADO POR VOCÊ"?"info":"warn"}>{value}</Badge>}
function SortControl({value,onChange,options}:{value:string;onChange:(v:string)=>void;options:[string,string][]}){return <select className="filter-select sort-select" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
function Page({title,eyebrow,children}:{title:string;eyebrow?:string;children:React.ReactNode}){return <><div className="page-title">{eyebrow&&<span>{eyebrow}</span>}<h1>{title}</h1></div>{children}</>}
function Metric({label,value,sub}:{label:string;value:any;sub:string}){return <div className="metric"><div><span>{label}</span><b>{value}</b><small>{sub}</small></div></div>}

function useKillPulse(){useEffect(()=>{let stopped=false,busy=false;const run=async()=>{if(stopped||busy)return;busy=true;try{await fetch("/api/pvp-pulse",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})}catch(e){console.debug("Public PvP pulse",e)}finally{busy=false}};const first=window.setTimeout(()=>void run(),1500);const t=window.setInterval(()=>void run(),15000);return()=>{stopped=true;window.clearTimeout(first);window.clearInterval(t)}},[])}

function usePublicData(){
  const [data,setData]=useState<any>(null),[error,setError]=useState("");
  useEffect(()=>{let alive=true;const load=async()=>{try{const r=await fetch("/api/public-data",{headers:{accept:"application/json"}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Falha ao carregar");if(alive){setData(j);setError("")}}catch(e){if(alive)setError(e instanceof Error?e.message:"Falha ao carregar")}};void load();const t=window.setInterval(()=>void load(),15000);return()=>{alive=false;window.clearInterval(t)}},[]);
  return {data,error};
}

function PublicLayout({children,data}:{children:React.ReactNode;data:any}){
  const loc=useLocation();
  const current=nav.find(([to])=>loc.pathname.startsWith(to))?.[1]??"Dashboard";
  return <div className="app public-app">
    <aside className="public-sidebar">
      <div className="brand"><div className="brand-icon"><Swords size={19}/></div><div><b>TIBIA PK</b><small>INTELLIGENCE</small></div></div>
      <div className="public-mode"><span/>VISUALIZAÇÃO PÚBLICA</div>
      <nav>{nav.map(([to,label,Icon])=><NavLink key={to} to={to} className={({isActive})=>isActive?"active":""}><Icon size={16}/>{label}</NavLink>)}</nav>
      <div className="public-share-note">Somente leitura<br/><small>Dados atualizados automaticamente.</small></div>
    </aside>
    <main>
      <header><span className="crumb">PAINEL PÚBLICO / <b>{current}</b></span><div className="header-right"><span className="realtime"><span/>MONITORAMENTO</span></div></header>
      <div className="content">{children}</div>
      <div className="public-site-footer">Último snapshot: {fmt(data?.updatedAt)} · Servidor base: {data?.world??"Jadebra"}</div>
    </main>
  </div>
}

function Dashboard({d}:{d:any}){
  const chars=d.characters??[],ev=d.events??[],online=chars.filter((x:any)=>x.online);
  return <Page title="Dashboard" eyebrow="VISÃO PÚBLICA DO RADAR">
    <div className="metrics">
      <Metric label="Monitorados" value={chars.length} sub="Base ativa"/>
      <Metric label="Online agora" value={online.length} sub="Estado mais recente"/>
      <Metric label="Logins recentes" value={ev.filter((x:any)=>x.kind==="LOGIN"&&age(x.occurredAt)<7200000).length} sub="Últimas 2h"/>
      <Metric label="Mass logs" value={ev.filter((x:any)=>x.kind==="MASS_LOGIN"&&age(x.occurredAt)<86400000).length} sub="Últimas 24h"/>
      <Metric label="Kills PvP" value={ev.filter((x:any)=>x.kind==="PVP_KILL"&&age(x.occurredAt)<86400000).length} sub="Kills dos monitorados · 24h"/>
      <Metric label="Level-ups" value={ev.filter((x:any)=>x.kind==="LEVEL_UP"&&age(x.occurredAt)<604800000).length} sub="Últimos 7 dias"/>
    </div>
    <div className="grid2">
      <section className="panel"><div className="panel-head"><div><h2>Online agora</h2><p>Personagens monitorados marcados como online.</p></div><Badge tone="good">{online.length} ONLINE</Badge></div>
        <div className="rows">{online.length?online.map((c:any)=><Link className="event-row" to={"/publico/personagens/"+encodeURIComponent(c.name)} key={c.name}><span className="dot"/><b>{c.name}</b><Origin value={c.origin}/><span className="muted">{c.guild??c.world}</span><span className="time">{fmt(c.lastEvent)}</span></Link>):<Empty text="Nenhum personagem monitorado está online."/>}</div>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Eventos recentes</h2><p>Últimos sinais registrados pelo radar.</p></div><Link to="/publico/eventos">Ver todos →</Link></div>
        <div className="rows">{ev.slice(0,8).map((x:any,i:number)=><div className="event-row" key={x.kind+x.name+x.occurredAt+i}><Badge tone={x.kind==="LOGIN"?"good":x.kind==="LOGOUT"?"neutral":x.kind==="DEATH"?"bad":"info"}>{x.kind}</Badge><b>{x.name}</b><span className="muted">{x.opponent??""}</span><span className="time">{fmt(x.occurredAt)}</span></div>)}{!ev.length&&<Empty text="Nenhum evento registrado."/>}</div>
      </section>
    </div>
  </Page>
}

function Characters({d}:{d:any}){
  const [sort,setSort]=useState("online"),[q,setQ]=useState("");
  const rows=useMemo(()=>[...(d.characters??[])].filter((c:any)=>!q||String(c.name).toLowerCase().includes(q.toLowerCase())||String(c.guild??"").toLowerCase().includes(q.toLowerCase())).sort((a:any,b:any)=>{
    if(sort==="system")return Number(a.origin==="ADICIONADO POR VOCÊ")-Number(b.origin==="ADICIONADO POR VOCÊ")||textCmp(a.name,b.name);
    if(sort==="manual")return Number(b.origin==="ADICIONADO POR VOCÊ")-Number(a.origin==="ADICIONADO POR VOCÊ")||textCmp(a.name,b.name);
    if(sort==="level")return Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name);
    if(sort==="name")return textCmp(a.name,b.name);
    return Number(b.online)-Number(a.online)||Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name);
  }),[d.characters,sort,q]);
  return <Page title="Personagens" eyebrow={(d.characters?.length||0)+" CHARS DE "+String(d.world||"JADEBRA").toUpperCase()}>
    <div className="notice">Visualização pública. É possível pesquisar e ordenar livremente; alterações na base continuam bloqueadas.</div>
    <div className="toolbar">
      <label className="search"><Search size={15}/><input placeholder="Buscar personagem ou guild…" value={q} onChange={e=>setQ(e.target.value)}/></label>
      <SortControl value={sort} onChange={setSort} options={[["online","Online primeiro"],["system","Descobertos pelo sistema primeiro"],["manual","Adicionados por você primeiro"],["level","Maior level"],["name","Nome A–Z"]]}/>
      <span className="muted">{rows.length} exibidos</span>
    </div>
    <div className="table-wrap"><table><thead><tr><th>Personagem</th><th>Origem</th><th>Level</th><th>Vocação</th><th>Guild</th><th>Status</th><th>Último evento</th></tr></thead><tbody>
      {rows.map((c:any)=><tr key={c.name}><td><Link className="link" to={"/publico/personagens/"+encodeURIComponent(c.name)}>{c.name}</Link><small>{c.source}</small></td><td><Origin value={c.origin}/></td><td>{c.level??"—"}</td><td>{c.vocation??"—"}</td><td>{c.guild??"—"}</td><td><Badge tone={c.online?"good":"neutral"}>{c.online?"ONLINE":"OFFLINE"}</Badge></td><td>{fmt(c.lastEvent)}</td></tr>)}
      {!rows.length&&<tr><td colSpan={7}>Nenhum personagem encontrado.</td></tr>}
    </tbody></table></div>
  </Page>
}

function CharacterDetail({d}:{d:any}){
  const {name}=useParams();const decoded=decodeURIComponent(name??"");
  const c=(d.characters??[]).find((x:any)=>x.name.toLowerCase()===decoded.toLowerCase());
  if(!c)return <Page title="Personagem"><Empty text="Personagem não encontrado."/></Page>;
  const suggestions=(d.suggestions??[]).filter((s:any)=>s.character===c.name).sort((a:any,b:any)=>Number(b.matchCount)-Number(a.matchCount));
  return <Page title={c.name} eyebrow={c.online?"● ONLINE":"○ OFFLINE"}>
    <div className="profile-grid">
      <section className="panel"><h2>Estado atual</h2><div className="facts">
        <Fact k="Mundo" v={c.world}/><Fact k="Level" v={String(c.level??"—")}/><Fact k="Vocação" v={c.vocation}/><Fact k="Guild" v={c.guild}/><Fact k="Fonte" v={c.source}/><Fact k="Origem no radar" v={c.origin}/><Fact k="Último login" v={fmt(c.lastLogin)}/><Fact k="Último evento" v={fmt(c.lastEvent)}/><Fact k="Confiança" v={c.confidence}/>
        {c.main&&<Fact k="Main externo" v={c.main.name+" · "+c.main.world+" · Lv "+(c.main.level??"—")}/>}
      </div></section>
      <section className="panel"><div className="panel-head"><div><h2>Possíveis outros personagens</h2><p>Correlação já registrada pelo Tibia Stalker. Página somente leitura.</p></div></div>
        {suggestions.length?suggestions.map((s:any,i:number)=><div className="relation" key={s.suggestedName+i}><b>{s.suggestedName}</b><Badge tone={Number(s.score)>=80?"bad":Number(s.score)>=40?"warn":"neutral"}>{Number(s.score||0).toFixed(0)}%</Badge><span>{s.matchCount} matches · {s.first??"—"} → {s.last??"—"}</span></div>):<Empty text="Nenhuma correlação registrada."/>}
      </section>
    </div>
  </Page>
}
function Fact({k,v}:{k:string;v:any}){return <div><small>{k}</small><b>{v||"—"}</b></div>}

function Who({d}:{d:any}){
  const [sort,setSort]=useState("size"),[pathView,setPathView]=useState<any>(null);
  const chars=d.characters??[],evidence=d.evidenceLinks??[];
  const charByName=useMemo(()=>new Map(chars.map((x:any)=>[String(x.name).toLowerCase(),x])),[chars]);
  function pathTo(targetName:string,allowedNames?:string[]){
    const allowed=allowedNames?new Set(allowedNames.map(x=>x.toLowerCase())):new Set(chars.map((x:any)=>String(x.name).toLowerCase()));
    const targetKey=targetName.toLowerCase();allowed.add(targetKey);
    const allSeeds=chars.filter((x:any)=>allowed.has(String(x.name).toLowerCase())&&x.origin==="ADICIONADO POR VOCÊ");
    // If the target itself was manually added, find the evidence that connected it from another known char.
    const seeds=allSeeds.filter((x:any)=>String(x.name).toLowerCase()!==targetKey);
    const starts=(seeds.length?seeds:allSeeds.filter((x:any)=>String(x.name).toLowerCase()!==targetKey)).map((x:any)=>String(x.name).toLowerCase());
    if(!starts.length)return null;
    const graph=new Map<string,{to:string;edge:any}[]>();
    for(const edge of evidence){
      const a=String(edge.from||"").toLowerCase(),b=String(edge.to||"").toLowerCase();
      if(!a||!b||!allowed.has(a)||!allowed.has(b))continue;
      if(!graph.has(a))graph.set(a,[]);if(!graph.has(b))graph.set(b,[]);
      graph.get(a)!.push({to:b,edge});graph.get(b)!.push({to:a,edge});
    }
    const queue=[...starts],seen=new Set(starts),parent=new Map<string,{prev:string;edge:any}>();
    while(queue.length&&!seen.has(targetKey)){
      const cur=queue.shift()!;
      for(const next of graph.get(cur)??[]){
        if(seen.has(next.to))continue;
        seen.add(next.to);parent.set(next.to,{prev:cur,edge:next.edge});queue.push(next.to);
        if(next.to===targetKey)break;
      }
    }
    if(!seen.has(targetKey))return null;
    const names=[targetKey],edges=[] as any[];let cur=targetKey;
    while(parent.has(cur)){const p=parent.get(cur)!;edges.unshift(p.edge);names.unshift(p.prev);cur=p.prev}
    if(!edges.length)return null;
    return {nodes:names.map(n=>charByName.get(n)).filter(Boolean),edges};
  }
  function openPath(target:any,allowedNames?:string[]){setPathView({target,path:pathTo(target.name,allowedNames)})}
  const profiles=useMemo(()=>[...(d.profiles??[])].sort((a:any,b:any)=>{
    if(sort==="system")return b.members.filter((m:any)=>m.origin==="DESCOBERTO PELO SISTEMA").length-a.members.filter((m:any)=>m.origin==="DESCOBERTO PELO SISTEMA").length||b.count-a.count;
    if(sort==="online")return b.members.filter((m:any)=>m.online).length-a.members.filter((m:any)=>m.online).length||b.count-a.count;
    if(sort==="confidence")return textCmp(b.confidence,a.confidence)||b.count-a.count;
    if(sort==="name")return textCmp(a.label,b.label);
    return b.count-a.count||textCmp(a.label,b.label);
  }),[d.profiles,sort]);
  const isolated=useMemo(()=>[...(d.isolated??[])].sort((a:any,b:any)=>{
    if(sort==="system")return Number(a.origin==="ADICIONADO POR VOCÊ")-Number(b.origin==="ADICIONADO POR VOCÊ")||textCmp(a.name,b.name);
    if(sort==="online")return Number(b.online)-Number(a.online)||textCmp(a.name,b.name);
    if(sort==="name")return textCmp(a.name,b.name);
    return Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name);
  }),[d.isolated,sort]);
  return <Page title="Quem é quem" eyebrow="MAPA PÚBLICO DE IDENTIDADES · JADEBRA">
    <div className="notice">A versão pública pode explorar, ordenar e auditar as evidências do mapa. Apenas ações que acrescentam, removem ou alteram informações permanecem bloqueadas.</div>
    <div className="toolbar public-summary"><SortControl value={sort} onChange={setSort} options={[["size","Mais chars no perfil"],["system","Mais descobertos pelo sistema"],["online","Mais online agora"],["confidence","Maior confiança"],["name","Nome A–Z"]]}/><Badge tone="good">Servidor: {d.world}</Badge><span className="muted">{d.profiles?.length??0} perfis agrupados · {d.isolated?.length??0} isolados · {d.characters?.length??0} chars</span></div>
    <h2 className="section-title">Perfis identificados</h2>
    <div className="identity-grid">{profiles.map((g:any)=>{const allowed=g.members.map((m:any)=>m.name);return <section className="panel identity-card" key={g.label}><div className="panel-head"><div><h2>{g.label}</h2><p>{g.count} chars de {d.world}{g.main?" + main externo":""}</p></div><Badge tone="info">{g.count} CHARS</Badge></div><div className="chips">
      {g.members.map((m:any)=>{const p=pathTo(m.name,allowed);return <div className="identity-member" key={m.name}><Link className={"identity-chip "+(m.online?"online":"")} to={"/publico/personagens/"+encodeURIComponent(m.name)}><b>{m.name}</b><small>{m.world}{m.level?" · Level "+m.level:""}{m.guild?" · "+m.guild:""}</small><span>{m.origin}</span></Link>{p&&<button className="discovery-path-btn" onClick={()=>openPath(m,allowed)}>Ver caminho</button>}</div>})}
      {g.main&&<div className="identity-chip external-main public-chip"><b>{g.main.name}</b><small>Level {g.main.level??"—"}{g.main.guild?" · "+g.main.guild:""}</small><span>MAIN · {g.main.world}</span></div>}
    </div></section>})}{!profiles.length&&<Empty text="Ainda não há perfis agrupados."/>}</div>
    <h2 className="section-title">Ainda isolados</h2>
    <div className="table-wrap"><table><thead><tr><th>Char</th><th>Level</th><th>Guild</th><th>Status</th><th>Origem</th><th>Main externo</th><th>Evidência</th></tr></thead><tbody>{isolated.map((x:any)=>{const p=pathTo(x.name);return <tr key={x.name}><td><Link className="link" to={"/publico/personagens/"+encodeURIComponent(x.name)}>{x.name}</Link></td><td>{x.level??"—"}</td><td>{x.guild??"—"}</td><td><Badge tone={x.online?"good":"neutral"}>{x.online?"ONLINE":"OFFLINE"}</Badge></td><td><Origin value={x.origin}/></td><td>{x.main?<span className="public-main"><b>{x.main.name}</b><small>MAIN · {x.main.world} · Lv {x.main.level??"—"}</small></span>:"—"}</td><td>{p?<button className="discovery-path-inline" onClick={()=>openPath(x)}>Ver caminho</button>:"—"}</td></tr>})}</tbody></table></div>
    {pathView&&<div className="modal-bg" onClick={()=>setPathView(null)}><div className="modal discovery-modal" onClick={e=>e.stopPropagation()}><div className="discovery-modal-head"><div><h2>Caminho até {pathView.target?.name}</h2><p>Cadeia de evidências em modo somente leitura.</p></div><button className="secondary close-path" onClick={()=>setPathView(null)}>×</button></div>{pathView.path?<div className="discovery-path">{pathView.path.nodes.map((node:any,i:number)=><div className="path-fragment" key={node.name}><div className={"path-node "+(i===pathView.path.nodes.length-1?"target":"")}><b>{node.name}</b><span>{node.origin}</span></div>{i<pathView.path.edges.length&&(()=>{const edge=pathView.path.edges[i];return <div className="path-edge"><span>↓</span><b>{edge.kind==="PUBLIC_ACCOUNT"?"MESMA CONTA PÚBLICA":edge.kind==="CONFIRMED_RELATION"?"RELAÇÃO CONFIRMADA":"TIBIA STALKER"}</b><small>{edge.kind==="STALKER_PERCENT"?(edge.from+" → "+edge.to+" · "+Math.round(Number(edge.score||0))+"% · "+edge.matches+" matches"):"100% de evidência confirmada"}</small></div>})()}</div>)}</div>:<div className="notice path-unavailable">Não foi possível reconstruir uma cadeia completa com as evidências atuais.</div>}<div className="modal-actions"><button className="secondary" onClick={()=>setPathView(null)}>Fechar</button></div></div></div>}
  </Page>
}

function Patterns({d}:{d:any}){
  const [sort,setSort]=useState("sessions");
  const stats=useMemo(()=>{const map=new Map<string,{name:string;count:number;total:number;hours:number[];days:number[]}>();for(const r of d.sessions??[]){const x=map.get(r.character)??{name:r.character,count:0,total:0,hours:Array(24).fill(0),days:Array(7).fill(0)};x.count++;x.total+=Number(r.durationMinutes||0);const dt=new Date(r.loginAt);x.hours[dt.getHours()]++;x.days[dt.getDay()]++;map.set(r.character,x)}const days=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];return [...map.values()].map(x=>{const hm=Math.max(...x.hours),dm=Math.max(...x.days),hour=x.hours.indexOf(hm);return {...x,peakHour:hm?String(hour).padStart(2,"0")+":00":"—",peakHourNum:hm?hour:99,peakDay:dm?days[x.days.indexOf(dm)]:"—",avg:x.count?Math.round(x.total/x.count):0}}).sort((a,b)=>{if(sort==="name")return textCmp(a.name,b.name);if(sort==="duration")return b.avg-a.avg||textCmp(a.name,b.name);if(sort==="hour")return a.peakHourNum-b.peakHourNum||textCmp(a.name,b.name);if(sort==="day")return textCmp(a.peakDay,b.peakDay)||textCmp(a.name,b.name);return b.count-a.count||textCmp(a.name,b.name)})},[d.sessions,sort]);
  return <Page title="Horários" eyebrow="PADRÕES DE LOGIN"><div className="notice">Padrões calculados a partir das sessões registradas pelo monitor.</div><div className="toolbar"><SortControl value={sort} onChange={setSort} options={[["sessions","Mais sessões"],["duration","Maior duração média"],["hour","Horário mais cedo"],["day","Dia mais comum"],["name","Nome A–Z"]]}/><Badge tone="good">Servidor: {d.world}</Badge></div><div className="table-wrap"><table><thead><tr><th>Personagem</th><th>Sessões</th><th>Horário mais comum</th><th>Dia mais comum</th><th>Duração média</th></tr></thead><tbody>{stats.map(x=><tr key={x.name}><td><b>{x.name}</b></td><td>{x.count}</td><td>{x.peakHour}</td><td>{x.peakDay}</td><td>{x.avg?x.avg+" min":"—"}</td></tr>)}{!stats.length&&<tr><td colSpan={5}>Ainda não há sessões registradas.</td></tr>}</tbody></table></div></Page>
}

function Kills({d}:{d:any}){
  const [selected,setSelected]=useState<Set<string>>(new Set()),[pairSort,setPairSort]=useState("count"),[deathSort,setDeathSort]=useState("recent");
  const h=d.killMonitor??{};const scanAge=h.lastScanAt?Date.now()-new Date(h.lastScanAt).getTime():Infinity;const scanTone=scanAge<45000?"good":scanAge<180000?"warn":"bad";const scanLabel=scanAge<45000?"VARREDURA ATIVA":scanAge<180000?"VARREDURA ATRASADA":"VARREDURA PARADA";
  const chars=d.characters??[],byName=new Map(chars.map((c:any)=>[c.name.toLowerCase(),c]));
  const guilds=useMemo(()=>[...new Set(chars.map((c:any)=>c.guild).filter(Boolean) as string[])].sort((a,b)=>textCmp(a,b)),[chars]);
  function toggleGuild(g:string){setSelected(s=>{const n=new Set(s);n.has(g)?n.delete(g):n.add(g);return n})}
  const rows=useMemo(()=>(d.deaths??[]).map((x:any)=>({...x,participants:(x.participants??[]).map((p:any)=>({...p,guild:p.guild??byName.get(p.name.toLowerCase())?.guild??null}))})).filter((x:any)=>selected.size===0||x.participants.some((p:any)=>p.guild&&selected.has(p.guild))).sort((a:any,b:any)=>{if(deathSort==="oldest")return dateNum(a.occurredAt)-dateNum(b.occurredAt);if(deathSort==="killers")return b.participants.length-a.participants.length||dateNum(b.occurredAt)-dateNum(a.occurredAt);if(deathSort==="victim")return textCmp(a.victim,b.victim)||dateNum(b.occurredAt)-dateNum(a.occurredAt);return dateNum(b.occurredAt)-dateNum(a.occurredAt)}),[d.deaths,selected,deathSort]);
  const pairs=useMemo(()=>{const m=new Map<string,any>();for(const death of rows){const u=[...new Map(death.participants.map((p:any)=>[p.name.toLowerCase(),p])).values()] as any[];for(let i=0;i<u.length;i++)for(let j=i+1;j<u.length;j++){const [a,b]=[u[i],u[j]].sort((x,y)=>textCmp(x.name,y.name));const k=a.name.toLowerCase()+"|"+b.name.toLowerCase();const old=m.get(k);if(old)old.count++;else m.set(k,{a:a.name,b:b.name,guildA:a.guild,guildB:b.guild,count:1})}}return [...m.values()].sort((a,b)=>{if(pairSort==="name")return textCmp(a.a,b.a)||textCmp(a.b,b.b);if(pairSort==="guild")return textCmp(a.guildA,b.guildA)||textCmp(a.guildB,b.guildB)||textCmp(a.a,b.a);return b.count-a.count||textCmp(a.a,b.a)}).slice(0,50)},[rows,pairSort]);
  return <Page title="Kills" eyebrow="QUEM MATOU JUNTO"><div className="notice">Cada morte é contada uma única vez e só entra aqui quando pelo menos um personagem monitorado participou como killer ou assist. A versão pública também mantém uma pulsação do scanner enquanto estiver aberta.</div><div className="toolbar"><Badge tone={scanTone}>{scanLabel}</Badge><Badge tone="info">Pool: {h.poolSize||"—"}</Badge><Badge tone="info">Lote: {h.batchSize||"—"}</Badge>{h.lastCaller&&<Badge tone="info">Execução: {h.lastCaller}</Badge>}<span className="muted">Última varredura: {fmt(h.lastScanAt)}{h.estimatedCycleSeconds?" · ciclo ~"+Math.ceil(Number(h.estimatedCycleSeconds)/60)+" min":""}</span></div>{h.lastError&&<div className="notice">{h.lastError}</div>}<div className="filter-chips">{guilds.map(g=><button key={g} className={selected.has(g)?"filter-chip active":"filter-chip"} onClick={()=>toggleGuild(g)}>{g}</button>)}{selected.size>0&&<button className="filter-chip clear" onClick={()=>setSelected(new Set())}>Limpar guilds</button>}</div><div className="section-head"><h2 className="section-title">Duplas que mataram juntas</h2><SortControl value={pairSort} onChange={setPairSort} options={[["count","Mais kills juntos"],["name","Nome A–Z"],["guild","Guild A–Z"]]}/></div><div className="table-wrap"><table><thead><tr><th>Char A</th><th>Guild</th><th>Char B</th><th>Guild</th><th>Kills juntos</th></tr></thead><tbody>{pairs.map((p:any)=><tr key={p.a+"|"+p.b}><td><b>{p.a}</b></td><td>{p.guildA??"—"}</td><td><b>{p.b}</b></td><td>{p.guildB??"—"}</td><td>{p.count}</td></tr>)}{!pairs.length&&<tr><td colSpan={5}>Ainda não há kills conjuntas para este filtro.</td></tr>}</tbody></table></div>
    <div className="section-head"><h2 className="section-title">Mortes analisadas</h2><SortControl value={deathSort} onChange={setDeathSort} options={[["recent","Mais recentes"],["oldest","Mais antigas"],["killers","Mais participantes"],["victim","Vítima A–Z"]]}/></div><div className="panel rows">{rows.map((x:any,i:number)=><div className="kill-row" key={x.victim+x.occurredAt+i}><div className="kill-main"><div><small>{fmt(x.occurredAt)}</small><b>{x.victim}</b><span className="muted">{x.source} · {x.victimWorld??d.world}</span></div><Badge tone="bad">{x.participants.length} participantes</Badge></div><div className="killer-list">{[...x.participants].sort((a:any,b:any)=>Number(Boolean(b.tracked))-Number(Boolean(a.tracked))||Number(a.role==="ASSIST")-Number(b.role==="ASSIST")||textCmp(a.name,b.name)).map((p:any)=><span className={p.tracked?"killer tracked":"killer"} key={p.name}><b>{p.name}</b><small>{p.role}{p.guild?" · "+p.guild:""}</small></span>)}</div></div>)}{!rows.length&&<Empty text="Nenhuma morte analisada para este filtro."/>}</div>
  </Page>
}

function Events({d}:{d:any}){const [sort,setSort]=useState("recent");const rows=useMemo(()=>[...(d.events??[])].sort((a:any,b:any)=>{if(sort==="oldest")return dateNum(a.occurredAt)-dateNum(b.occurredAt);if(sort==="character")return textCmp(a.name,b.name)||dateNum(b.occurredAt)-dateNum(a.occurredAt);if(sort==="type")return textCmp(a.kind,b.kind)||dateNum(b.occurredAt)-dateNum(a.occurredAt);return dateNum(b.occurredAt)-dateNum(a.occurredAt)}),[d.events,sort]);return <Page title="Eventos" eyebrow="TIMELINE"><div className="toolbar"><SortControl value={sort} onChange={setSort} options={[["recent","Mais recentes"],["oldest","Mais antigos"],["character","Personagem A–Z"],["type","Tipo de evento"]]}/><span className="muted">{rows.length} eventos</span></div><div className="panel rows">{rows.map((x:any,i:number)=><div className="event-row" key={x.kind+x.name+x.occurredAt+i}><Badge tone={x.kind==="LOGIN"?"good":x.kind==="LOGOUT"?"neutral":x.kind==="DEATH"?"bad":"info"}>{x.kind}</Badge><b>{x.name}</b><span className="muted">{x.opponent??""}</span><span className="time">{fmt(x.occurredAt)}</span></div>)}{!rows.length&&<Empty text="Nenhum evento registrado."/>}</div></Page>}
function Alerts({d}:{d:any}){const [sort,setSort]=useState("recent");const rows=useMemo(()=>[...(d.alerts??[])].sort((a:any,b:any)=>{if(sort==="oldest")return dateNum(a.triggeredAt)-dateNum(b.triggeredAt);if(sort==="title")return textCmp(a.title,b.title)||dateNum(b.triggeredAt)-dateNum(a.triggeredAt);if(sort==="character")return textCmp(a.character,b.character)||dateNum(b.triggeredAt)-dateNum(a.triggeredAt);return dateNum(b.triggeredAt)-dateNum(a.triggeredAt)}),[d.alerts,sort]);return <Page title="Alertas" eyebrow="SINAIS IMPORTANTES"><div className="notice">Histórico público de alertas já disparados pelo radar.</div><div className="toolbar"><SortControl value={sort} onChange={setSort} options={[["recent","Mais recentes"],["oldest","Mais antigos"],["title","Título A–Z"],["character","Personagem A–Z"]]}/><span className="muted">{rows.length} alertas</span></div><div className="panel rows">{rows.map((x:any,i:number)=><div className="event-row" key={x.title+x.triggeredAt+i}><Bell size={15}/><b>{x.title}</b><span className="muted">{x.body}</span><span className="time">{fmt(x.triggeredAt)}</span></div>)}{!rows.length&&<Empty text="Nenhum alerta disparado."/>}</div></Page>}
function Sources({d}:{d:any}){const [sort,setSort]=useState("status");const rank=(s:string)=>s==="ERROR"?0:s==="RUNNING"?1:s==="IDLE"?2:s==="SUCCESS"?3:4;const rows=useMemo(()=>[...(d.sources??[])].sort((a:any,b:any)=>{if(sort==="name")return textCmp(a.source,b.source);if(sort==="recent")return dateNum(b.lastSuccessAt)-dateNum(a.lastSuccessAt)||textCmp(a.source,b.source);if(sort==="next")return dateNum(a.nextSyncAt)-dateNum(b.nextSyncAt)||textCmp(a.source,b.source);return rank(a.status)-rank(b.status)||textCmp(a.source,b.source)}),[d.sources,sort]);return <Page title="Fontes" eyebrow="SAÚDE DAS INTEGRAÇÕES"><div className="toolbar"><SortControl value={sort} onChange={setSort} options={[["status","Problemas primeiro"],["name","Fonte A–Z"],["recent","Último sucesso recente"],["next","Próximo sync"]]}/></div><div className="source-grid">{rows.map((s:any)=><div className="panel source" key={s.source}><div className="panel-head"><h2>{s.source}</h2><Badge tone={s.status==="SUCCESS"?"good":s.status==="ERROR"?"bad":"warn"}>{s.status}</Badge></div><p>Último sucesso: {fmt(s.lastSuccessAt)}</p><p>Próximo sync: {fmt(s.nextSyncAt)}</p>{s.note&&<p className="error">{s.note}</p>}</div>)}{!rows.length&&<Empty text="Nenhuma fonte registrada."/>}</div></Page>}

export default function PublicSite(){
  useKillPulse();
  const {data,error}=usePublicData();
  if(error&&!data)return <div className="public-who"><div className="public-shell"><div className="public-brand"><div className="brand-icon"><Swords size={19}/></div><div><b>TIBIA PK</b><small>INTELLIGENCE</small></div></div><div className="public-error">{error}</div></div></div>;
  if(!data)return <div className="center">Carregando painel público…</div>;
  return <PublicLayout data={data}><Routes>
    <Route path="dashboard" element={<Dashboard d={data}/>}/>
    <Route path="personagens" element={<Characters d={data}/>}/>
    <Route path="personagens/:name" element={<CharacterDetail d={data}/>}/>
    <Route path="quem-e-quem" element={<Who d={data}/>}/>
    <Route path="horarios" element={<Patterns d={data}/>}/>
    <Route path="kills" element={<Kills d={data}/>}/>
    <Route path="eventos" element={<Events d={data}/>}/>
    <Route path="alertas" element={<Alerts d={data}/>}/>
    <Route path="fontes" element={<Sources d={data}/>}/>
    <Route path="*" element={<Navigate to="/publico/dashboard" replace/>}/>
  </Routes></PublicLayout>
}
