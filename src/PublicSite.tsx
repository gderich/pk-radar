import {useEffect,useMemo,useState} from "react";
import {Activity,Bell,Database,LayoutDashboard,Network,Skull,Swords,Users,Wifi} from "lucide-react";
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
function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:string}){return <span className={"badge "+tone}>{children}</span>}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function Origin({value}:{value:string}){return <Badge tone={value==="ADICIONADO POR VOCÊ"?"info":"warn"}>{value}</Badge>}
function Page({title,eyebrow,children}:{title:string;eyebrow?:string;children:React.ReactNode}){return <><div className="page-title">{eyebrow&&<span>{eyebrow}</span>}<h1>{title}</h1></div>{children}</>}
function Metric({label,value,sub}:{label:string;value:any;sub:string}){return <div className="metric"><div><span>{label}</span><b>{value}</b><small>{sub}</small></div></div>}

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
      <Metric label="Mortes / PvP" value={ev.filter((x:any)=>["DEATH","PVP_KILL"].includes(x.kind)&&age(x.occurredAt)<86400000).length} sub="Últimas 24h"/>
      <Metric label="Level-ups" value={ev.filter((x:any)=>x.kind==="LEVEL_UP"&&age(x.occurredAt)<604800000).length} sub="Últimos 7 dias"/>
    </div>
    <div className="grid2">
      <section className="panel"><div className="panel-head"><div><h2>Online agora</h2><p>Personagens monitorados marcados como online.</p></div><Badge tone="good">{online.length} ONLINE</Badge></div>
        <div className="rows">{online.length?online.map((c:any)=><Link className="event-row" to={"/publico/personagens/"+encodeURIComponent(c.name)} key={c.name}><span className="dot"/><b>{c.name}</b><Origin value={c.origin}/><span className="muted">{c.guild??c.world}</span><span className="time">{fmt(c.lastEvent)}</span></Link>):<Empty text="Nenhum personagem monitorado está online."/ >}</div>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Eventos recentes</h2><p>Últimos sinais registrados pelo radar.</p></div><Link to="/publico/eventos">Ver todos →</Link></div>
        <div className="rows">{ev.slice(0,8).map((x:any,i:number)=><div className="event-row" key={x.kind+x.name+x.occurredAt+i}><Badge tone={x.kind==="LOGIN"?"good":x.kind==="LOGOUT"?"neutral":x.kind==="DEATH"?"bad":"info"}>{x.kind}</Badge><b>{x.name}</b><span className="muted">{x.opponent??""}</span><span className="time">{fmt(x.occurredAt)}</span></div>)}{!ev.length&&<Empty text="Nenhum evento registrado."/ >}</div>
      </section>
    </div>
  </Page>
}

function Characters({d}:{d:any}){
  const rows=[...(d.characters??[])].sort((a:any,b:any)=>Number(b.online)-Number(a.online)||Number(b.level||0)-Number(a.level||0)||textCmp(a.name,b.name));
  return <Page title="Personagens" eyebrow={(rows.length||0)+" CHARS DE "+String(d.world||"JADEBRA").toUpperCase()}>
    <div className="notice">Lista pública dos personagens monitorados. Não há ações de cadastro, exclusão ou consulta manual.</div>
    <div className="table-wrap"><table><thead><tr><th>Personagem</th><th>Origem</th><th>Level</th><th>Vocação</th><th>Guild</th><th>Status</th><th>Último evento</th></tr></thead><tbody>
      {rows.map((c:any)=><tr key={c.name}><td><Link className="link" to={"/publico/personagens/"+encodeURIComponent(c.name)}>{c.name}</Link><small>{c.source}</small></td><td><Origin value={c.origin}/></td><td>{c.level??"—"}</td><td>{c.vocation??"—"}</td><td>{c.guild??"—"}</td><td><Badge tone={c.online?"good":"neutral"}>{c.online?"ONLINE":"OFFLINE"}</Badge></td><td>{fmt(c.lastEvent)}</td></tr>)}
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
        {suggestions.length?suggestions.map((s:any,i:number)=><div className="relation" key={s.suggestedName+i}><b>{s.suggestedName}</b><Badge tone={Number(s.score)>=80?"bad":Number(s.score)>=40?"warn":"neutral"}>{Number(s.score||0).toFixed(0)}%</Badge><span>{s.matchCount} matches · {s.first??"—"} → {s.last??"—"}</span></div>):<Empty text="Nenhuma correlação registrada."/ >}
      </section>
    </div>
  </Page>
}
function Fact({k,v}:{k:string;v:any}){return <div><small>{k}</small><b>{v||"—"}</b></div>}

function Who({d}:{d:any}){
  return <Page title="Quem é quem" eyebrow="MAPA PÚBLICO DE IDENTIDADES · JADEBRA">
    <div className="notice">Visualização pública dos perfis aceitos pelo radar. Não há controles de edição ou recálculo.</div>
    <div className="toolbar public-summary"><Badge tone="good">Servidor: {d.world}</Badge><span className="muted">{d.profiles?.length??0} perfis agrupados · {d.isolated?.length??0} isolados · {d.characters?.length??0} chars</span></div>
    <h2 className="section-title">Perfis identificados</h2>
    <div className="identity-grid">{(d.profiles??[]).map((g:any)=><section className="panel identity-card" key={g.label}><div className="panel-head"><div><h2>{g.label}</h2><p>{g.count} chars de {d.world}{g.main?" + main externo":""}</p></div><Badge tone="info">{g.count} CHARS</Badge></div><div className="chips">
      {g.members.map((m:any)=><Link className={"identity-chip "+(m.online?"online":"")} to={"/publico/personagens/"+encodeURIComponent(m.name)} key={m.name}><b>{m.name}</b><small>{m.world}{m.level?" · Level "+m.level:""}{m.guild?" · "+m.guild:""}</small><span>{m.origin}</span></Link>)}
      {g.main&&<div className="identity-chip external-main public-chip"><b>{g.main.name}</b><small>Level {g.main.level??"—"}{g.main.guild?" · "+g.main.guild:""}</small><span>MAIN · {g.main.world}</span></div>}
    </div></section>)}{!(d.profiles??[]).length&&<Empty text="Ainda não há perfis agrupados."/ >}</div>
    <h2 className="section-title">Ainda isolados</h2>
    <div className="table-wrap"><table><thead><tr><th>Char</th><th>Level</th><th>Guild</th><th>Status</th><th>Origem</th><th>Main externo</th></tr></thead><tbody>{(d.isolated??[]).map((c:any)=><tr key={c.name}><td><Link className="link" to={"/publico/personagens/"+encodeURIComponent(c.name)}>{c.name}</Link></td><td>{c.level??"—"}</td><td>{c.guild??"—"}</td><td><Badge tone={c.online?"good":"neutral"}>{c.online?"ONLINE":"OFFLINE"}</Badge></td><td><Origin value={c.origin}/></td><td>{c.main?<span className="public-main"><b>{c.main.name}</b><small>MAIN · {c.main.world} · Lv {c.main.level??"—"}</small></span>:"—"}</td></tr>)}</tbody></table></div>
  </Page>
}

function Patterns({d}:{d:any}){
  const stats=useMemo(()=>{const map=new Map<string,{name:string;count:number;total:number;hours:number[];days:number[]}>();for(const r of d.sessions??[]){const x=map.get(r.character)??{name:r.character,count:0,total:0,hours:Array(24).fill(0),days:Array(7).fill(0)};x.count++;x.total+=Number(r.durationMinutes||0);const dt=new Date(r.loginAt);x.hours[dt.getHours()]++;x.days[dt.getDay()]++;map.set(r.character,x)}const days=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];return [...map.values()].map(x=>{const hm=Math.max(...x.hours),dm=Math.max(...x.days);return {...x,peakHour:hm?String(x.hours.indexOf(hm)).padStart(2,"0")+":00":"—",peakDay:dm?days[x.days.indexOf(dm)]:"—",avg:x.count?Math.round(x.total/x.count):0}}).sort((a,b)=>b.count-a.count||textCmp(a.name,b.name))},[d.sessions]);
  return <Page title="Horários" eyebrow="PADRÕES DE LOGIN"><div className="notice">Padrões calculados a partir das sessões registradas pelo monitor.</div><div className="table-wrap"><table><thead><tr><th>Personagem</th><th>Sessões</th><th>Horário mais comum</th><th>Dia mais comum</th><th>Duração média</th></tr></thead><tbody>{stats.map(x=><tr key={x.name}><td><b>{x.name}</b></td><td>{x.count}</td><td>{x.peakHour}</td><td>{x.peakDay}</td><td>{x.avg?x.avg+" min":"—"}</td></tr>)}{!stats.length&&<tr><td colSpan={5}>Ainda não há sessões registradas.</td></tr>}</tbody></table></div></Page>
}

function Kills({d}:{d:any}){
  const chars=d.characters??[],byName=new Map(chars.map((c:any)=>[c.name.toLowerCase(),c]));
  const rows=(d.deaths??[]).map((x:any)=>({...x,participants:(x.participants??[]).map((p:any)=>({...p,guild:p.guild??byName.get(p.name.toLowerCase())?.guild??null}))}));
  const pairs=useMemo(()=>{const m=new Map<string,any>();for(const death of rows){const u=[...new Map(death.participants.map((p:any)=>[p.name.toLowerCase(),p])).values()] as any[];for(let i=0;i<u.length;i++)for(let j=i+1;j<u.length;j++){const [a,b]=[u[i],u[j]].sort((x,y)=>textCmp(x.name,y.name));const k=a.name.toLowerCase()+"|"+b.name.toLowerCase();const old=m.get(k);if(old)old.count++;else m.set(k,{a:a.name,b:b.name,guildA:a.guild,guildB:b.guild,count:1})}}return [...m.values()].sort((a,b)=>b.count-a.count).slice(0,50)},[d.deaths]);
  return <Page title="Kills" eyebrow="QUEM MATOU JUNTO"><div className="notice">Histórico público das mortes coletadas e das combinações de jogadores que participaram juntos.</div><h2 className="section-title">Duplas que mataram juntas</h2><div className="table-wrap"><table><thead><tr><th>Char A</th><th>Guild</th><th>Char B</th><th>Guild</th><th>Kills juntos</th></tr></thead><tbody>{pairs.map((p:any)=><tr key={p.a+"|"+p.b}><td><b>{p.a}</b></td><td>{p.guildA??"—"}</td><td><b>{p.b}</b></td><td>{p.guildB??"—"}</td><td>{p.count}</td></tr>)}{!pairs.length&&<tr><td colSpan={5}>Ainda não há kills conjuntas registradas.</td></tr>}</tbody></table></div>
    <h2 className="section-title">Mortes analisadas</h2><div className="panel rows">{rows.map((x:any,i:number)=><div className="kill-row" key={x.victim+x.occurredAt+i}><div className="kill-main"><div><small>{fmt(x.occurredAt)}</small><b>{x.victim}</b><span className="muted">{x.source} · {x.victimWorld??d.world}</span></div><Badge tone="bad">{x.participants.length} participantes</Badge></div><div className="killer-list">{x.participants.map((p:any)=><span className={p.tracked?"killer tracked":"killer"} key={p.name}><b>{p.name}</b><small>{p.role}{p.guild?" · "+p.guild:""}</small></span>)}</div></div>)}{!rows.length&&<Empty text="Nenhuma morte analisada."/ >}</div>
  </Page>
}

function Events({d}:{d:any}){const rows=d.events??[];return <Page title="Eventos" eyebrow="TIMELINE"><div className="panel rows">{rows.map((x:any,i:number)=><div className="event-row" key={x.kind+x.name+x.occurredAt+i}><Badge tone={x.kind==="LOGIN"?"good":x.kind==="LOGOUT"?"neutral":x.kind==="DEATH"?"bad":"info"}>{x.kind}</Badge><b>{x.name}</b><span className="muted">{x.opponent??""}</span><span className="time">{fmt(x.occurredAt)}</span></div>)}{!rows.length&&<Empty text="Nenhum evento registrado."/ >}</div></Page>}
function Alerts({d}:{d:any}){return <Page title="Alertas" eyebrow="SINAIS IMPORTANTES"><div className="notice">Histórico público de alertas já disparados pelo radar.</div><div className="panel rows">{(d.alerts??[]).map((x:any,i:number)=><div className="event-row" key={x.title+x.triggeredAt+i}><Bell size={15}/><b>{x.title}</b><span className="muted">{x.body}</span><span className="time">{fmt(x.triggeredAt)}</span></div>)}{!(d.alerts??[]).length&&<Empty text="Nenhum alerta disparado."/ >}</div></Page>}
function Sources({d}:{d:any}){const rank=(s:string)=>s==="ERROR"?0:s==="RUNNING"?1:s==="IDLE"?2:s==="SUCCESS"?3:4;const rows=[...(d.sources??[])].sort((a:any,b:any)=>rank(a.status)-rank(b.status)||textCmp(a.source,b.source));return <Page title="Fontes" eyebrow="SAÚDE DAS INTEGRAÇÕES"><div className="source-grid">{rows.map((s:any)=><div className="panel source" key={s.source}><div className="panel-head"><h2>{s.source}</h2><Badge tone={s.status==="SUCCESS"?"good":s.status==="ERROR"?"bad":"warn"}>{s.status}</Badge></div><p>Último sucesso: {fmt(s.lastSuccessAt)}</p><p>Próximo sync: {fmt(s.nextSyncAt)}</p>{s.note&&<p className="error">{s.note}</p>}</div>)}{!rows.length&&<Empty text="Nenhuma fonte registrada."/ >}</div></Page>}

export default function PublicSite(){
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
