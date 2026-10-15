import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { getSession, canOperate } from '@/lib/auth';
import { requireClientAccess } from '@/lib/clients';
import { db } from '@/lib/db';
import { providerLabel } from '@/lib/ai-measurement/parse';
import { platformRate, indicators } from '@/lib/ai-measurement/metrics';
import { CLASS_BADGE, fmtRate } from '@/components/ai-presence';
import { DateLabel } from '@/components/ui';
import { ArchiveButton } from '@/components/archive-button';
export const dynamic = 'force-dynamic';
const day = (d: string | null) => d ? d.split('-').reverse().join('/') : 'não informado';
const FL: Record<string, string> = { STRENGTH: 'Pontos fortes', WEAKNESS: 'Pontos fracos', OPPORTUNITY: 'Oportunidades', CONCLUSION: 'Conclusões', LIMITATION: 'Limitações', EVIDENCE: 'Evidências', SOURCE: 'Fontes citadas' };
export default async function MeasurementPage({ params, searchParams }: { params: Promise<{ id: string; measurementId: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id, measurementId } = await params; await requireClientAccess(actor, id);
  const m = await db.aiMeasurement.findFirst({ where: { id: measurementId, clientId: id }, include: { platforms: true, competitors: true, findings: true, revisions: { orderBy: { version: 'desc' } } } });
  if (!m) notFound();
  const users = new Map((await db.user.findMany({ where: { id: { in: [m.importedById, m.updatedById, ...m.revisions.map(r => r.changedById)].filter(Boolean) as string[] } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  const sd = m.structuredData as any; const ind = indicators(m.platforms); const [cls, tone] = CLASS_BADGE[m.classification] || [m.classification, 'qual'];
  const operate = canOperate(actor);
  return <div className="section-stack">
    {(await searchParams).salvo && <p className="notice" role="status">Medição salva. Os indicadores da Presença em IA já foram atualizados.</p>}
    <div className="section-intro"><div><Link href={`/clients/${id}/ia`} className="crumb">Presença em IA</Link><h2 className="section-title big">{m.title}</h2><p className="kicker">Versão {m.version} · importada por {users.get(m.importedById) || '—'} em <DateLabel value={m.importedAt} time />{m.updatedById ? <> · última revisão por {users.get(m.updatedById) || '—'}</> : null}{m.status === 'ARCHIVED' ? ' · ARQUIVADA' : ''}</p></div>
      {operate && <div className="section-actions"><Link className="button" href={`/clients/${id}/ia/${m.id}/editar`}><Pencil size={14} /> Editar (nova versão)</Link><ArchiveButton clientId={id} measurementId={m.id} archived={m.status === 'ARCHIVED'} /></div>}</div>
    <section className="card"><div className="summary-head"><div className="card-label">Identificação</div><span className={`class-badge ${tone}`}>{cls}</span></div>
      <dl className="summary-grid"><div><dt>Execução</dt><dd>{day(m.executedAt)}</dd></div><div><dt>Período</dt><dd>{m.periodStart ? `${day(m.periodStart)} a ${day(m.periodEnd)}` : 'não informado'}</dd></div><div><dt>Origem</dt><dd>{m.source}</dd></div><div><dt>Metodologia</dt><dd>{m.methodology}{m.methodologyVersion ? ` · v${m.methodologyVersion}` : ''}</dd></div><div><dt>Formato lido</dt><dd>{sd?.format || '—'} · {sd?.parserVersion || ''}</dd></div><div><dt>Campos editados na revisão</dt><dd>{sd?.edits?.length ? sd.edits.length : 'nenhum'}</dd></div></dl>
      {sd?.classificationReason && <p className="fine-print">Sugestão automática: {sd.suggestedClassification} — {sd.classificationReason}</p>}
    </section>
    <section><h2 className="section-title">Indicadores e procedência</h2><div className="table-wrap"><table className="table"><thead><tr><th>Plataforma</th><th className="n">Prompts</th><th className="n">Observações</th><th className="n">Menções</th><th className="n">Recomendações</th><th className="n">Citações</th><th>Evidência</th></tr></thead><tbody>{m.platforms.map(p => { const sp = sd?.platforms?.find((x: any) => x.provider === p.provider); const evs = ['observationCount', 'mentionCount', 'recommendationCount', 'citationCount'].map(f => sp?.[f]).filter((x: any) => x?.value != null); return <tr key={p.id}><td><strong>{providerLabel(p.provider)}</strong><small>{p.model || ''} {p.collectionMethod ? `· ${p.collectionMethod}` : ''}</small></td><td className="n">{p.promptCount ?? '—'}</td><td className="n">{p.observationCount ?? '—'}</td><td className="n">{p.mentionCount ?? '—'}{platformRate(p, 'mentionCount') && <small> {fmtRate(platformRate(p, 'mentionCount'))}</small>}</td><td className="n">{p.recommendationCount ?? '—'}{platformRate(p, 'recommendationCount') && <small> {fmtRate(platformRate(p, 'recommendationCount'))}</small>}</td><td className="n">{p.citationCount ?? '—'}{platformRate(p, 'citationCount') && <small> {fmtRate(platformRate(p, 'citationCount'))}</small>}</td><td className="evidence-cell">{evs.map((e: any, i: number) => <small key={i} className={e.origin === 'EDITED' ? 'edited' : 'evidence'}>{e.origin === 'EDITED' ? `Editado na revisão: ${e.value}` : e.evidence ? `L${e.evidence.line || ''} ${e.evidence.text}` : ''}</small>)}</td></tr>; })}</tbody></table></div>
      <p className="fine-print">Totais da medição: menção {fmtRate(ind.mention) || 'não calculável'} · recomendação {fmtRate(ind.recommendation) || 'não calculável'} · citação {fmtRate(ind.citation) || 'não calculável'}. Taxas = soma das contagens ÷ soma das observações das plataformas que informaram ambos.</p>
    </section>
    <div className="grid grid-2">{Object.keys(FL).map(t => { const items = m.findings.filter(f => f.type === t); return items.length ? <section key={t} className="card"><h3 className="card-label">{FL[t]}</h3><ul className="plain-list">{items.map(f => <li key={f.id}>{t === 'SOURCE' ? <span className="url-cell">{f.title}</span> : f.description || f.title}</li>)}</ul></section> : null; })}
      {m.competitors.length > 0 && <section className="card"><h3 className="card-label">Concorrentes</h3><ul className="plain-list">{m.competitors.map(c => <li key={c.id}><strong>{c.name}</strong>{c.platform ? <span className="kicker"> · {c.platform.split(',').map(providerLabel).join(', ')}</span> : null}</li>)}</ul></section>}</div>
    {Array.isArray(m.warnings) && (m.warnings as any[]).length > 0 && <details className="card"><summary>Avisos da análise ({(m.warnings as any[]).length})</summary><ul>{(m.warnings as any[]).map((w, i) => <li key={i}>{w.message}</li>)}</ul></details>}
    <details className="card raw-text"><summary>Texto original importado</summary><ol>{m.rawText.split('\n').map((l, i) => <li key={i}>{l || ' '}</li>)}</ol></details>
    <section><h2 className="section-title">Histórico de revisões</h2>{m.revisions.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Versão substituída</th><th>Alterada por</th><th>Quando</th><th>Motivo</th></tr></thead><tbody>{m.revisions.map(r => <tr key={r.id}><td>v{r.version}</td><td>{users.get(r.changedById) || '—'}</td><td><DateLabel value={r.changedAt} time /></td><td>{r.note || '—'}</td></tr>)}</tbody></table></div> : <p className="kicker">Versão original, sem revisões.</p>}<p className="fine-print">Relatórios já gerados mantêm os dados da versão usada na época.</p></section>
  </div>;
}
