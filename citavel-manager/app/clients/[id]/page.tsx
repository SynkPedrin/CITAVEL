import Link from 'next/link';
import { getClientData } from '@/lib/sync';
import { db } from '@/lib/db';
import { getSession,canOperate,canManage } from '@/lib/auth';
import { Badge,DateLabel,Metric,PageHeader,Panel,Percent,SectionHead } from '@/components/ui';
import { ActionStatusControl,GoogleSyncButton,SyncClientButton } from '@/components/client-controls';
export const dynamic='force-dynamic';
const observed=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR'):'—';
export default async function ClientOverview({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [data,actor]=await Promise.all([getClientData(id),getSession()]);
  if(!data)return null;
  const operate=actor&&canOperate(actor);const manage=actor&&canManage(actor);
  const lab=(data.metrics as any)?.LAB||{};const golden=(data.metrics as any)?.GOLDEN||{};
  const latest=data.seoSnapshots[0];
  const statusCounts=await db.action.groupBy({by:['status'],where:{clientId:id},_count:{_all:true}});
  const lifecycleCount=(...statuses:string[])=>statusCounts.filter(s=>statuses.includes(s.status)).reduce((total,s)=>total+s._count._all,0);
  const positiveSignal=await db.actionResult.findMany({where:{resultStatus:'POSITIVE_SIGNAL',action:{clientId:id}},select:{actionId:true},distinct:['actionId']});
  const weekEvents=await db.systemEvent.findMany({where:{clientId:id,createdAt:{gte:new Date(Date.now()-7*24*60*60*1000)}},select:{message:true},take:500});
  const eventCounts=new Map<string,number>();for(const e of weekEvents)eventCounts.set(e.message,(eventCounts.get(e.message)||0)+1);
  const actions=(data.actions as any[]).filter(a=>!['DONE','DISMISSED','IMPLEMENTED'].includes(a.status)).slice(0,3);
  const search=(data.integrations as any[]).find(i=>i.provider==='SEARCH_CONSOLE');
  const analytics=(data.integrations as any[]).find(i=>i.provider==='GA4');
  const sc=search?.snapshot;const ga4=analytics?.snapshot;
  const googleProviders=(data.integrations as any[]).filter(i=>['GA4','SEARCH_CONSOLE'].includes(i.provider)).map(i=>i.provider) as ('GA4'|'SEARCH_CONSOLE')[];
  // AiRun não tem batchId: tratamos como "lote" as execuções consecutivas do mesmo runType separadas por no máximo 2h
  const gapMs=2*60*60*1000;const batches=(type:string)=>{const runs=(data.aiRuns as any[]).filter(r=>r.runType===type).slice().sort((a,b)=>+new Date(a.createdAt)-+new Date(b.createdAt));const out:any[][]=[];for(const r of runs){const last=out[out.length-1];if(last&&+new Date(r.createdAt)-+new Date(last[last.length-1].createdAt)<=gapMs)last.push(r);else out.push([r])}return out};
  const goldenBatches=batches('GOLDEN');const labBatches=batches('LAB');const series=goldenBatches.length>=2?{list:goldenBatches,label:'GOLDEN'}:labBatches.length>=2?{list:labBatches,label:'LAB'}:null;
  let movement:{won:number;stable:number;lost:number;label:string}|null=null;
  if(series){const [prev,curr]=series.list.slice(-2);const byPrompt=(batch:any[])=>{const map=new Map<string,boolean>();for(const r of batch)if(r.promptId)map.set(r.promptId,r.brandRecommended===true);return map};const before=byPrompt(prev);const after=byPrompt(curr);movement={won:0,stable:0,lost:0,label:series.label};for(const [promptId,cur] of after){if(!before.has(promptId))continue;const prevRecommended=before.get(promptId)!;if(cur&&!prevRecommended)movement.won++;else if(!cur&&prevRecommended)movement.lost++;else movement.stable++}}
  const period=(snapshot:any)=>snapshot?.startDate&&snapshot?.endDate?`${new Date(snapshot.startDate+'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(snapshot.endDate+'T12:00:00').toLocaleDateString('pt-BR')}`:'Aguardando integração';
  return <div className="page">
    <PageHeader eyebrow="Visão geral" title={data.name} description={<span>Última sincronização: <DateLabel value={data.lastSyncedAt} time/> · {data.status==='PARTIALLY_READY'?'operação em atenção':data.status==='ACTIVE'?'operação ativa':'operação '+data.status.toLowerCase()}</span>} actions={<><Link className="button" href={`/clients/${id}/reports`}>Relatórios</Link>{operate&&<SyncClientButton clientId={id}/>}<Link className="button primary" href={`/clients/${id}/ai-presence`}>Ver presença</Link></>}/>
    <div className="notice" style={{marginBottom:15}}>O painel separa observações <strong>GOLDEN</strong> de execuções <strong>LAB</strong>. Valores ausentes ficam pendentes até existir uma fonte real.</div>
    <div className="metric-grid">
      <Metric label="Cobertura de recomendação" value={<Percent value={golden.recommendation_coverage}/>} note={golden.runs?'GOLDEN observado':'Aguardando GOLDEN'} accent/>
      <Metric label="Taxa de menção" value={<Percent value={golden.mention_rate}/>} note={golden.runs?'GOLDEN observado':'GOLDEN ainda não disponível'}/>
      <Metric label="Participação nas respostas" value={<Percent value={golden.share_of_voice}/>} note="Concorrentes confirmados quando houver"/>
      <Metric label="Cliques na busca Google" value={observed(sc?.clicks)} note={sc?`Search Console · ${period(sc)}`:'Conecte o Search Console'}/>
    </div>
    <SectionHead title="Onde estamos" description="A presença observada pelo diagnóstico automatizado, com a fonte de cada leitura."/>
    <div className="grid grid-2">
      <Panel wallpaper><div className="hero-signal"><div><div className="eyebrow">GOLDEN</div><h2>{golden.runs?'Observado':'Ainda sem observação'}</h2><p>{golden.runs?'Resultados revisados e separados do diagnóstico automatizado.':'Importe respostas revisadas para acompanhar a cobertura real da marca.'}</p><Badge status="LAB">EXPERIMENTAL · {lab.runs??0} execuções</Badge></div><img src="/brand/citavel-icon.png" alt="" width="60" height="60"/></div></Panel>
      <Panel><div className="eyebrow">SEO</div><h2 style={{margin:'0 0 9px'}}>{latest?.healthScore!=null?`${latest.healthScore}/100`:'—'}</h2><p className="kicker">{latest?'Saúde técnica observada no último crawl.':'Aguardando crawl do site.'}</p><Link className="text-link" href={`/clients/${id}/seo`} style={{marginTop:15}}>Abrir SEO</Link></Panel>
    </div>
    <SectionHead title="Da presença à oportunidade" description="Cada etapa mostra a sua fonte. Eventos e tráfego só entram quando a integração fornece uma observação." href={`/clients/${id}/demand`} link="Abrir demanda"/>
    <div className="funnel">
      <div className="funnel-step"><span className="funnel-number">01</span><h3>Presença em IA</h3><strong><Percent value={golden.recommendation_coverage}/></strong><small>Recomendações GOLDEN</small></div>
      <div className="funnel-step"><span className="funnel-number">02</span><h3>Cliques na busca</h3><strong>{observed(sc?.clicks)}</strong><small>{sc?`Total Search Console · ${period(sc)}`:'Aguardando Search Console'}</small></div>
      <div className="funnel-step"><span className="funnel-number">03</span><h3>Sessões no site</h3><strong>{observed(ga4?.sessions)}</strong><small>{ga4?`Total GA4 · ${period(ga4)}`:'Aguardando Analytics'}</small></div>
      <div className="funnel-step"><span className="funnel-number">04</span><h3>Contatos</h3><strong>—</strong><small>Aguardando origem de leads</small></div>
      <div className="funnel-step"><span className="funnel-number">05</span><h3>Oportunidades</h3><strong>—</strong><small>Aguardando integração comercial</small></div>
    </div>
    {manage&&(!sc||!ga4)&&<div className="notice" style={{marginTop:12}}>Conecte as fontes para preencher os indicadores de busca e tráfego. <Link className="text-link" style={{display:'inline-flex'}} href="/admin/integrations">Configurar integrações</Link></div>}
    {operate&&googleProviders.length>0&&<div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}>{googleProviders.map(provider=><GoogleSyncButton key={provider} clientId={id} provider={provider}/>)}</div>}
    <SectionHead title="Operação atual" description="Estado real das ações do Engine, calculado do banco do Manager." href={`/clients/${id}/aprovacoes`} link="Abrir aprovações"/>
    <div className="grid grid-3">
      <Panel><div className="eyebrow">EM ANÁLISE</div><h2>{lifecycleCount('PROPOSED')}</h2><p className="kicker">Ações propostas pelo Engine aguardando triagem.</p></Panel>
      <Panel><div className="eyebrow">AGUARDANDO APROVAÇÃO</div><h2>{lifecycleCount('WAITING_APPROVAL')}</h2><p className="kicker">Decisão humana necessária antes de qualquer execução.</p></Panel>
      <Panel><div className="eyebrow">EXECUTANDO</div><h2>{lifecycleCount('APPROVED','EXECUTING','VALIDATING','READY_TO_PUBLISH','PUBLISHING')}</h2><p className="kicker">Aprovadas, em execução, validação ou publicação.</p></Panel>
      <Panel><div className="eyebrow">PUBLICADOS</div><h2>{lifecycleCount('PUBLISHED')}</h2><p className="kicker">Conteúdo em produção no domínio do cliente.</p></Panel>
      <Panel><div className="eyebrow">EM MONITORAMENTO</div><h2>{lifecycleCount('MONITORING','MEASURED')}</h2><p className="kicker">Medição ativa nas janelas do Engine.</p></Panel>
      <Panel><div className="eyebrow">COM SINAL POSITIVO</div><h2>{positiveSignal.length}</h2><p className="kicker">Ações com ActionResult de sinal positivo medido.</p></Panel>
    </div>
    <SectionHead title="Próximas prioridades" description="Ações atuais do Engine, rastreáveis aos gaps e perguntas impactadas." href={`/clients/${id}/actions`}/>
    <div className="grid grid-3">{actions.length?actions.map(a=><Panel key={a.id}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><Badge status={a.priority}/><Badge status={a.status}/></div><h3>{a.title}</h3><p className="kicker">{a.description}</p><small className="kicker">Origem: {a.gapId?'gap identificado':'observação LAB'} · {Array.isArray((a.data as any)?.affected_prompts)?(a.data as any).affected_prompts.length:'—'} prompts impactados</small>{operate&&<ActionStatusControl actionId={a.id} status={a.status}/>}</Panel>):<Panel><h3>Nenhuma ação aberta</h3><p className="kicker">O próximo diagnóstico preencherá este espaço quando encontrar uma oportunidade.</p></Panel>}</div>
    <SectionHead title="O que a CITÁVEL fez" description="Eventos reais registrados para este cliente nos últimos 7 dias." href={`/clients/${id}/atividade`} link="Abrir atividade"/>
    <Panel>{eventCounts.size?<ul style={{margin:0,paddingLeft:18,display:'grid',gap:8}}>{[...eventCounts.entries()].map(([message,total])=><li key={message} className="kicker"><strong style={{color:'var(--text)'}}>{total}×</strong> {message}</li>)}</ul>:<p className="kicker" style={{margin:0}}>Sem atividade registrada nos últimos 7 dias.</p>}</Panel>
    <SectionHead title="Sinais de evolução" description="Comparações só aparecem quando existe uma série comparável."/>
    <div className="grid grid-3"><Panel><div className="eyebrow">PROMPTS GANHOS</div><h2>{movement?movement.won:'—'}</h2><p className="kicker">{movement?`Comparativo ${movement.label} entre os dois lotes mais recentes.`:'Execute uma nova medição para comparar.'}</p></Panel><Panel><div className="eyebrow">PROMPTS ESTÁVEIS</div><h2>{movement?movement.stable:'—'}</h2><p className="kicker">{movement?`Comparativo ${movement.label} entre os dois lotes mais recentes.`:'Execute uma nova medição para comparar.'}</p></Panel><Panel><div className="eyebrow">PROMPTS PERDIDOS</div><h2>{movement?movement.lost:'—'}</h2><p className="kicker">{movement?`Comparativo ${movement.label} entre os dois lotes mais recentes.`:'Execute uma nova medição para comparar.'}</p></Panel></div>
  </div>
}
