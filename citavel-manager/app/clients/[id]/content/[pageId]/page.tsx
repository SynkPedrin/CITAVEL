import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { Badge, DateLabel, PageHeader, Panel, Percent } from '@/components/ui';
import { ClientTabs } from '@/components/client-sections';

export const dynamic = 'force-dynamic';

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

export default async function ContentAssetPage({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page || page.clientId !== id) notFound();
  const [deployments, actionsWithExecution] = await Promise.all([
    db.deployment.findMany({ where: { pageId }, include: { action: true }, orderBy: { createdAt: 'desc' } }),
    db.action.findMany({ where: { clientId: id } }),
  ]);
  const linked = deployments[0]?.action || actionsWithExecution.find(a => (a.execution as any)?.page_id === page.externalId) || null;
  const [gap, prompts, latestResult] = await Promise.all([
    linked?.gapId ? db.gap.findUnique({ where: { id: linked.gapId } }) : Promise.resolve(null),
    (() => { const ids = asArray(page.targetPrompts).filter(x => typeof x === 'string'); return ids.length ? db.prompt.findMany({ where: { clientId: id, externalId: { in: ids } } }) : Promise.resolve([]); })(),
    linked ? db.actionResult.findFirst({ where: { actionId: linked.id }, orderBy: { measuredAt: 'desc' } }) : Promise.resolve(null),
  ]);
  const deployment = deployments[0] || null;
  const preview = (linked?.preview || null) as any;
  const evidenceIds = asArray(preview?.evidence_ids);
  const rawCreated = (page.data as any)?.created_at || (page.data as any)?.generated_at || null;
  const baseline = (latestResult?.baseline || {}) as any;
  const current = (latestResult?.current || {}) as any;
  return <div className="page">
    <PageHeader eyebrow="Conteúdo" title={page.title} description={<span>{page.type} · <Badge status={page.status} /></span>} actions={<Link className="button" href={`/clients/${id}/content`}>Todos os conteúdos</Link>} />
    <ClientTabs id={id} active="content" />
    <div className="grid grid-2">
      <Panel>
        <div className="eyebrow">URL REAL</div>
        {page.url ? <a className="text-link" style={{ display: 'inline-flex', marginTop: 10 }} href={page.url} target="_blank" rel="noreferrer">{page.url}</a> : <p className="kicker">Rascunho local — ainda não publicado.</p>}
        <small className="kicker" style={{ display: 'block', marginTop: 10 }}>{rawCreated ? <>Criado em <DateLabel value={rawCreated} time /> · </> : null}Publicado em <DateLabel value={page.publishedAt} time /></small>
      </Panel>
      <Panel>
        <div className="eyebrow">POR QUE ESTE CONTEÚDO EXISTE</div>
        {linked ? <><h3 style={{ margin: '10px 0 6px' }}>{linked.title}</h3><p className="kicker">{linked.description}</p><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}><Badge status={linked.priority} /><Badge status={linked.status} />{linked.actionType && <Badge status={linked.actionType} />}</div><Link className="text-link" href={`/clients/${id}/actions/${linked.id}`}>Ver rastreabilidade da ação</Link>{gap && <small className="kicker" style={{ display: 'block', marginTop: 10 }}>Gap vinculado: {gap.type} ({gap.severity}) — {gap.description}</small>}</> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">PROMPTS ALVO</div>
        {prompts.length ? <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 8 }}>{prompts.map(p => <li key={p.id}><strong style={{ fontSize: 12 }}>{p.prompt}</strong><small className="kicker" style={{ display: 'block' }}>{p.cluster} · {p.intent}</small></li>)}</ul> : asArray(page.targetPrompts).length ? <p className="kicker">{asArray(page.targetPrompts).join(', ')}</p> : <p className="kicker">—</p>}
        <Link className="text-link" style={{ marginTop: 10 }} href={`/clients/${id}/prompts`}>Abrir seção de prompts</Link>
      </Panel>
      <Panel>
        <div className="eyebrow">EVIDÊNCIAS USADAS</div>
        {evidenceIds.length ? <p className="kicker">{evidenceIds.length} evidência(s) vinculada(s) pelo Engine: {evidenceIds.slice(0, 6).join(', ')}{evidenceIds.length > 6 ? ` +${evidenceIds.length - 6}` : ''}</p> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">PUBLICAÇÃO</div>
        {deployment ? <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Badge status={deployment.status} /><Badge status={deployment.adapter} /></div>
          {deployment.url && <a className="text-link" style={{ display: 'inline-flex' }} href={deployment.url} target="_blank" rel="noreferrer">Abrir página publicada</a>}
          {deployment.branch && <small className="kicker">Branch: {deployment.branch}</small>}
          {deployment.commit && <small className="kicker">Commit: {deployment.commit}</small>}
          {deployment.publishedAt && <small className="kicker">Publicado em <DateLabel value={deployment.publishedAt} time /></small>}
        </div> : <p className="kicker">—</p>}
      </Panel>
      <Panel>
        <div className="eyebrow">RESULTADO MEDIDO</div>
        {latestResult ? <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Badge status={latestResult.resultStatus} /><small className="kicker">Janela {latestResult.window} · medido em <DateLabel value={latestResult.measuredAt} time /></small></div>
          <small className="kicker">Baseline — menção <Percent value={baseline.mention} /> · recomendação <Percent value={baseline.recommendation} /> · citação <Percent value={baseline.citation} /> ({baseline.runs ?? '—'} runs)</small>
          <small className="kicker">Atual — menção <Percent value={current.mention} /> · recomendação <Percent value={current.recommendation} /> · citação <Percent value={current.citation} /> ({current.runs ?? '—'} runs)</small>
          {latestResult.notes && <small className="kicker">{latestResult.notes}</small>}
        </div> : <p className="kicker">—</p>}
      </Panel>
    </div>
  </div>;
}
