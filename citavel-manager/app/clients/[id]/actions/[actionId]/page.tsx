import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession, canOperate } from '@/lib/auth';
import { stripPrivatePaths } from '@/lib/redact';
import { Badge, DateLabel, EmptyState, PageHeader, Panel, Percent, SectionHead } from '@/components/ui';
import { ClientTabs } from '@/components/client-sections';
import { ApproveRejectControl } from '@/components/approval-controls';

export const dynamic = 'force-dynamic';

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];
const signal = (value: unknown) => value == null ? '—' : value ? 'Sim' : 'Não';

export default async function ActionTracePage({ params }: { params: Promise<{ id: string; actionId: string }> }) {
  const { id, actionId } = await params;
  const [action, actor] = await Promise.all([
    db.action.findUnique({ where: { id: actionId }, include: { gap: true } }),
    getSession(),
  ]);
  if (!action || action.clientId !== id) notFound();
  const raw = (action.data || {}) as any;
  const origin = raw.origin || {};
  const affected = asArray(raw.affected_prompts);
  const promptIds: string[] = affected.length ? affected : asArray(origin.prompt_ids);
  const runIds: string[] = asArray(origin.run_ids).length ? asArray(origin.run_ids) : asArray(raw.source_run_ids);
  const supporting: string[] = asArray(raw.supporting_sources);
  const [prompts, runs, sources, executions, deployments, results] = await Promise.all([
    promptIds.length ? db.prompt.findMany({ where: { clientId: id, externalId: { in: promptIds } } }) : Promise.resolve([]),
    runIds.length ? db.aiRun.findMany({ where: { clientId: id, externalId: { in: runIds } }, select: { id: true, externalId: true, platform: true, runType: true, brandMentioned: true, brandRecommended: true, createdAt: true } }) : Promise.resolve([]),
    supporting.length ? db.source.findMany({ where: { clientId: id, url: { in: supporting } } }) : Promise.resolve([]),
    db.actionExecution.findMany({ where: { actionId }, orderBy: { startedAt: 'desc' } }),
    db.deployment.findMany({ where: { actionId }, include: { page: true }, orderBy: { createdAt: 'desc' } }),
    db.actionResult.findMany({ where: { actionId }, orderBy: { measuredAt: 'desc' } }),
  ]);
  const preview = (action.preview || null) as any;
  const execution = (action.execution || null) as any;
  const deployment = stripPrivatePaths((action.deployment || null) as any);
  const lifecycle = asArray(action.lifecycle);
  const page = deployments.find(d => d.page)?.page || (execution?.page_id ? await db.page.findFirst({ where: { clientId: id, externalId: String(execution.page_id) } }) : null);
  const decidable = ['PROPOSED', 'WAITING_APPROVAL'].includes(action.status);
  const operate = Boolean(actor && canOperate(actor));
  return <div className="page">
    <PageHeader eyebrow="Rastreabilidade" title={action.title} description={<span>{action.description}</span>} actions={<Link className="button" href={`/clients/${id}/actions`}>Todas as ações</Link>} />
    <ClientTabs id={id} active="actions" />
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 16px' }}>
      <Badge status={action.priority} />
      <Badge status={action.status} />
      {action.actionType && <Badge status={action.actionType} />}
      {action.automationLevel && <Badge status={action.automationLevel} />}
      {action.risk && <Badge status={action.risk}>Risco: {action.risk}</Badge>}
    </div>
    <SectionHead title="Por que esta ação existe?" description="A cadeia completa de evidência: da pergunta monitorada até o resultado medido após a publicação." />
    <div className="grid grid-2">
      <Panel>
        <div className="eyebrow">01 · PROMPTS DE ORIGEM</div>
        {prompts.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{prompts.map(p => <li key={p.id}><strong style={{ fontSize: 12 }}>{p.prompt}</strong><small className="kicker" style={{ display: 'block' }}>{p.cluster} · {p.intent}</small></li>)}</ul> : <p className="kicker">{promptIds.length ? promptIds.join(', ') : '—'}</p>}
        <Link className="text-link" style={{ marginTop: 10 }} href={`/clients/${id}/prompts`}>Abrir seção de prompts</Link>
      </Panel>
      <Panel>
        <div className="eyebrow">02 · EXECUÇÕES DE IA OBSERVADAS</div>
        {runs.length ? <div className="table-wrap" style={{ marginTop: 10 }}><table className="table" style={{ minWidth: 0 }}><thead><tr><th>Plataforma</th><th>Tipo</th><th>Mencionada</th><th>Recomendada</th><th>Data</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{r.platform}</td><td><Badge status={r.runType} /></td><td>{signal(r.brandMentioned)}</td><td>{signal(r.brandRecommended)}</td><td><DateLabel value={r.createdAt} /></td></tr>)}</tbody></table></div> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">03 · FONTES E CONCORRENTES</div>
        {sources.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{sources.map(s => <li key={s.id}><a className="text-link" style={{ display: 'inline-flex' }} href={s.url} target="_blank" rel="noreferrer">{s.domain || s.url}</a><small className="kicker" style={{ display: 'block' }}>{s.citationCount} citação(ões) · marca presente: {signal(s.clientPresent)}</small></li>)}</ul> : supporting.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{supporting.map(url => <li key={url}><a className="text-link" style={{ display: 'inline-flex' }} href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : <p className="kicker">—</p>}
        <Link className="text-link" style={{ marginTop: 10 }} href={`/clients/${id}/competitors`}>Abrir concorrentes</Link>
      </Panel>
      <Panel>
        <div className="eyebrow">04 · GAP IDENTIFICADO</div>
        {action.gap ? <><div style={{ display: 'flex', gap: 6, margin: '10px 0' }}><Badge status={action.gap.type} /><Badge status={action.gap.severity} /></div><p className="kicker">{action.gap.description}</p><small className="kicker">Confiança: {action.gap.confidence == null ? '—' : `${Math.round(action.gap.confidence * 100)}%`}</small></> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">05 · A AÇÃO PROPOSTA</div>
        <p className="kicker" style={{ marginTop: 10 }}>{action.description}</p>
        <small className="kicker" style={{ display: 'block', marginTop: 8 }}>Sinal esperado: {raw.expected_signal || '—'} · Prioridade: {action.priority}{action.priorityScore != null ? ` (${action.priorityScore})` : ''}</small>
        {asArray(raw.affected_urls).length > 0 && <small className="kicker" style={{ display: 'block', marginTop: 6 }}>URLs afetadas: {asArray(raw.affected_urls).join(', ')}</small>}
      </Panel>
      <Panel>
        <div className="eyebrow">06 · PREVIEW DO CONTEÚDO</div>
        {preview ? <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {preview.title && <small className="kicker">Título: {preview.title}</small>}
          {preview.meta_description && <small className="kicker">Meta description: {preview.meta_description}</small>}
          {preview.h1 && <small className="kicker">H1: {preview.h1}</small>}
          {preview.url_desired && <small className="kicker">URL desejada: {preview.url_desired}</small>}
          {asArray(preview.outline).length > 0 && <small className="kicker">Outline: {asArray(preview.outline).join(' → ')}</small>}
          {typeof preview.faq_count === 'number' && <small className="kicker">FAQ: {preview.faq_count} pergunta(s)</small>}
          {preview.cta && <small className="kicker">CTA: {preview.cta}</small>}
          {preview.missing_information === true && <div className="notice warning">O Engine marcou este conteúdo como “faltam informações”.</div>}
        </div> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">07 · EXECUÇÃO</div>
        {execution ? <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <small className="kicker">Status: {execution.status || '—'} · Início: <DateLabel value={execution.started_at} time /> · Fim: <DateLabel value={execution.finished_at} time /></small>
          {asArray(execution.log).length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>{asArray(execution.log).map((step: any, i: number) => <li key={i} className="kicker">{step.step || 'etapa'} — {step.status || '—'} <DateLabel value={step.at} time />{step.detail ? ` · ${step.detail}` : ''}</li>)}</ul>}
        </div> : <p className="kicker">—</p>}
        {executions.length > 0 && <small className="kicker" style={{ display: 'block', marginTop: 8 }}>{executions.length} execução(ões) registrada(s) no Manager.</small>}
      </Panel>
      <Panel>
        <div className="eyebrow">08 · PUBLICAÇÃO</div>
        {deployment || deployments.length ? <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {(deployment?.url || deployments[0]?.url) && <a className="text-link" style={{ display: 'inline-flex' }} href={deployment?.url || deployments[0]?.url} target="_blank" rel="noreferrer">Abrir página publicada</a>}
          <small className="kicker">Status: {deployment?.status || deployments[0]?.status || '—'} · Adapter: {deployment?.adapter || deployments[0]?.adapter || '—'}</small>
          {(deployment?.branch || deployments[0]?.branch) && <small className="kicker">Branch: {deployment?.branch || deployments[0]?.branch}</small>}
          {(deployment?.commit || deployments[0]?.commit) && <small className="kicker">Commit: {deployment?.commit || deployments[0]?.commit}</small>}
          {(deployment?.published_at || deployments[0]?.publishedAt) && <small className="kicker">Publicado em <DateLabel value={deployment?.published_at || deployments[0]?.publishedAt} time /></small>}
          {page && <Link className="text-link" href={`/clients/${id}/content/${page.id}`}>Ver detalhe do conteúdo</Link>}
        </div> : <p className="kicker">—</p>}
      </Panel>
    </div>
    <SectionHead title="Monitoramento e resultado" description="Medições reais do Engine sobre os prompts afetados. Sem medição, nada é afirmado." />
    {results.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Janela</th><th>Medido em</th><th>Baseline (menção/rec./citação)</th><th>Atual (menção/rec./citação)</th><th>Resultado</th><th>Notas</th></tr></thead><tbody>{results.map(r => { const b = (r.baseline || {}) as any; const c = (r.current || {}) as any; return <tr key={r.id}><td>{r.window}</td><td><DateLabel value={r.measuredAt} time /></td><td><Percent value={b.mention} /> / <Percent value={b.recommendation} /> / <Percent value={b.citation} /><small>{b.runs ?? '—'} runs</small></td><td><Percent value={c.mention} /> / <Percent value={c.recommendation} /> / <Percent value={c.citation} /><small>{c.runs ?? '—'} runs</small></td><td><Badge status={r.resultStatus} /></td><td>{r.notes || '—'}</td></tr>; })}</tbody></table></div> : <EmptyState compact title="Sem medição ainda" description="O Engine mede o resultado desta ação nas janelas D1 a D90 após a publicação." />}
    <SectionHead title="Lifecycle" description="Todas as transições registradas pelo Engine, sem estados pulados." />
    <Panel>
      {lifecycle.length ? <div className="timeline">{lifecycle.map((entry: any, i: number) => <div className="timeline-row" key={i}><span className="status-dot" /><div><strong><Badge status={entry.status} /></strong><small><DateLabel value={entry.at} time />{entry.actor ? ` · ${entry.actor}` : ''}{entry.note ? ` · ${entry.note}` : ''}</small></div></div>)}</div> : <p className="kicker">O Engine ainda não expôs o lifecycle desta ação. Estado atual: <Badge status={action.status} /></p>}
    </Panel>
    {decidable && operate && <Panel style={{ marginTop: 14 }}><div className="eyebrow">DECISÃO</div><p className="kicker">Aprovar dispara decide → execute → publish no Engine e registra cada transição na atividade do cliente.</p><ApproveRejectControl actionId={action.id} /></Panel>}
  </div>;
}
