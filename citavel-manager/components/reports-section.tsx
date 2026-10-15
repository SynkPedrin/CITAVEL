import { db } from '@/lib/db';
import { DateLabel, EmptyState } from './ui';
import { ReportGenerator, DownloadButton } from './report-generator';
const KIND: Record<string, string> = { GOOGLE: 'Google / SEO', IA: 'Presença em IA', COMPLETO: 'Completo', EXECUTIVO: 'Executivo (v1)', TECNICO: 'Técnico (v1)' };
const day = (d: string) => d.split('-').reverse().join('/');
// v1 snapshots stored a section list; v2 stores {format, ai_measurement_ids, ...}.
function sourcesLabel(kind: string, sections: unknown) {
  if (Array.isArray(sections)) return 'Versão anterior (v1)';
  const ai = Boolean((sections as any)?.ai_measurement_ids?.length);
  if (kind === 'IA') return 'Medição de IA';
  if (kind === 'COMPLETO') return ai ? 'Search Console + medição de IA' : 'Search Console';
  return 'Search Console';
}
export async function ReportsSection({ id, operate }: { id: string; operate: boolean }) {
  const [snaps, measurements] = await Promise.all([
    db.reportSnapshot.findMany({ where: { clientId: id }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, reportType: true, sections: true, periodStart: true, periodEnd: true, pdfStatus: true, pdfError: true, createdAt: true, createdById: true } }),
    operate ? db.aiMeasurement.findMany({ where: { clientId: id, status: 'APPROVED' }, orderBy: [{ executedAt: 'desc' }, { importedAt: 'desc' }], select: { id: true, title: true, executedAt: true, classification: true, version: true } }) : Promise.resolve([]),
  ]);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(snaps.map(s => s.createdById))] } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  return <div className="section-stack">
    <div className="section-intro"><div><h2 className="section-title big">Relatórios</h2><p className="kicker">PDFs com a identidade CITÁVEL, gerados a partir dos dados do Google e das medições de IA aprovadas.</p></div>{operate && snaps.length > 0 && <ReportGenerator clientId={id} measurements={measurements} />}</div>
    {!snaps.length ? (operate ? <><EmptyState title="Nenhum relatório foi gerado." description="Escolha o tipo, o período e, se houver, a medição de IA." /><ReportGenerator clientId={id} measurements={measurements} startOpen /></> : <EmptyState title="Nenhum relatório foi gerado." description="A equipe CITÁVEL disponibilizará os relatórios aqui." />)
      : <div className="table-wrap"><table className="table"><thead><tr><th>Relatório</th><th>Fontes</th><th>Período</th><th>Gerado em</th><th>Status</th><th /></tr></thead><tbody>{snaps.map(s => { const fmt = (s.sections as any)?.format; return <tr key={s.id}>
        <td><strong>{KIND[s.reportType] || s.reportType}</strong>{fmt && <small>formato {fmt === 'EXECUTIVO' ? 'executivo' : 'completo'}</small>}<small>por {users.get(s.createdById) || '—'}</small></td>
        <td>{sourcesLabel(s.reportType, s.sections)}</td>
        <td>{day(s.periodStart)} a {day(s.periodEnd)}</td><td><DateLabel value={s.createdAt} time /></td>
        <td><span className={`status-chip ${s.pdfStatus === 'READY' ? 'ok' : s.pdfStatus === 'FAILED' ? 'warn' : 'muted'}`}><span className="dot" />{s.pdfStatus === 'READY' ? 'Pronto' : s.pdfStatus === 'FAILED' ? 'Falhou' : 'Pendente'}</span>{s.pdfError && <small title={s.pdfError}>{s.pdfError.slice(0, 50)}</small>}</td>
        <td className="row-actions"><a className="button ghost" href={`/api/clients/${id}/report-snapshots/${s.id}/view`} target="_blank" rel="noopener">Visualizar</a>{s.pdfStatus === 'READY' && <DownloadButton clientId={id} snapshotId={s.id} />}</td></tr>; })}</tbody></table></div>}
  </div>;
}
