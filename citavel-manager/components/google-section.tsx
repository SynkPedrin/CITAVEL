import Link from 'next/link';
import { loadSearchData } from '@/lib/gsc/insights';
import type { Delta } from '@/lib/gsc/metrics';
import { DateLabel, EmptyState } from './ui';
import { GscTrend } from './gsc-chart';

export const fmtInt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR');
export const fmtPct = (n: number | null | undefined, d = 1) => n == null ? '—' : `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
export const fmtPos = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtDay = (d: string | null) => d ? d.split('-').reverse().join('/') : '—';
const catLabel: Record<string, string> = { BRANDED: 'Marca', NON_BRANDED: 'Sem marca', SERVICE: 'Serviço', LOCATION: 'Localidade', INFORMATIONAL: 'Informacional', COMMERCIAL: 'Comercial', OTHER: 'Outras' };
const PERIODS = [['7d', '7 dias'], ['28d', '28 dias'], ['3m', '3 meses'], ['6m', '6 meses'], ['12m', '12 meses']] as const;

function Change({ d, comparable, invert = false, kind = 'pct' }: { d: Delta; comparable: boolean; invert?: boolean; kind?: 'pct' | 'pp' | 'pos' }) {
  if (!comparable || d.abs == null) return <span className="muted-text">Sem período anterior comparável</span>;
  const v = kind === 'pct' ? d.pct : d.abs; if (v == null) return <span className="muted-text">Sem base de comparação</span>;
  const better = invert ? v < 0 : v > 0; const sign = v > 0 ? '+' : '';
  const n = (x: number, f: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: f, maximumFractionDigits: f });
  const text = kind === 'pct' ? `${sign}${n(v * 100, 1)}%` : kind === 'pp' ? `${sign}${n(v * 100, 2)} p.p.` : `${sign}${n(v, 1)}`;
  return <span className={v === 0 ? 'muted-text' : better ? 'delta-up' : 'delta-down'}>{text} vs. período anterior</span>;
}
function Kpi({ label, value, note, hero = false }: { label: string; value: string; note: React.ReactNode; hero?: boolean }) {
  return <div className={`kpi ${hero ? 'hero' : ''}`}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-note">{note}</div></div>;
}

export async function GoogleSection({ id, search, canAdmin }: { id: string; search: Record<string, string | undefined>; canAdmin: boolean }) {
  const data = await loadSearchData(id, { propertyId: search.property, period: search.period, from: search.from, to: search.to });
  if (data.state === 'NOT_BOUND') return <EmptyState title="Os dados do Google ainda não estão disponíveis." description={canAdmin ? 'Vincule a propriedade do Search Console deste cliente em Configurações → Integrações.' : 'A equipe CITÁVEL ainda não vinculou a propriedade do Search Console deste cliente.'} action={canAdmin ? <Link className="button primary" href="/admin/integrations">Vincular propriedade</Link> : undefined} />;
  if (data.state === 'NO_DATA') return <EmptyState title="Os dados do Google ainda não estão disponíveis." description={`Propriedade ${data.binding.property.siteUrl} vinculada. ${data.lastJob ? (data.lastJob.status === 'RUNNING' || data.lastJob.status === 'QUEUED' ? 'A importação está em andamento.' : data.lastJob.status === 'FAILED' ? `A última importação falhou${data.lastJob.errorDetail ? ': ' + data.lastJob.errorDetail : ''}.` : 'O Google não retornou dados para esta propriedade.') : 'A importação ainda não começou.'}`} />;
  const d = data; const p = d.period; const cov = d.coverage;
  const qs = (extra: Record<string, string>) => '?' + new URLSearchParams(Object.fromEntries(Object.entries({ property: search.property, period: search.period, from: search.from, to: search.to, ...extra }).filter(([, v]) => v)) as Record<string, string>).toString();
  const partial = cov.currentDays < p.days;
  return <div className="section-stack">
    <div className="filter-bar" role="group" aria-label="Período">
      {PERIODS.map(([k, l]) => <Link key={k} className={`chip ${p.key === k ? 'active' : ''}`} href={qs({ period: k, from: '', to: '' })} scroll={false}>{l}</Link>)}
      <form method="get" className="custom-range">
        {search.property && <input type="hidden" name="property" value={search.property} />}<input type="hidden" name="period" value="custom" />
        <input aria-label="Data inicial" type="date" name="from" defaultValue={p.key === 'custom' ? p.start : ''} />
        <input aria-label="Data final" type="date" name="to" defaultValue={p.key === 'custom' ? p.end : ''} />
        <button className={`chip ${p.key === 'custom' ? 'active' : ''}`}>Personalizado</button>
      </form>
      {d.bindings.length > 1 && <span className="filter-props">{d.bindings.map(b => <Link key={b.id} className={`chip ${b.id === d.binding.id ? 'active' : ''}`} href={qs({ property: b.propertyId })}>{b.property.siteUrl}</Link>)}</span>}
    </div>

    <dl className="source-strip">
      <div><dt>Período solicitado</dt><dd>{fmtDay(p.start)} a {fmtDay(p.end)} · {p.days} dias</dd></div>
      <div><dt>Dados disponíveis no período</dt><dd>{cov.firstDate ? `${fmtDay(cov.firstDate)} a ${fmtDay(cov.lastDate)} · ${cov.currentDays} ${cov.currentDays === 1 ? 'dia' : 'dias'}` : 'nenhum dia com dados'}</dd></div>
      <div><dt>Propriedade</dt><dd>{d.binding.property.siteUrl}</dd></div>
      <div><dt>Última sincronização</dt><dd><DateLabel value={d.lastSuccess?.finishedAt} time /></dd></div>
    </dl>
    {partial && <p className="notice warning">O Google tem dados para {cov.currentDays} de {p.days} dias deste período (histórico disponível desde {fmtDay(d.binding.availableStartDate)}). Os totais abaixo cobrem apenas os dias com dados.</p>}

    <div className="kpi-row">
      <Kpi hero label="Impressões" value={fmtInt(d.totals.impressions)} note={<Change d={d.deltas.impressions} comparable={cov.comparable} />} />
      <Kpi label="Cliques" value={fmtInt(d.totals.clicks)} note={<Change d={d.deltas.clicks} comparable={cov.comparable} />} />
      <Kpi label="CTR médio" value={fmtPct(d.totals.ctr, 2)} note={<Change d={d.deltas.ctr} comparable={cov.comparable} kind="pp" />} />
      <Kpi label="Posição média" value={fmtPos(d.totals.position)} note={<Change d={d.deltas.position} comparable={cov.comparable} kind="pos" invert />} />
    </div>
    <p className="fine-print">Fonte: Google Search Console, pesquisa na Web, dados consolidados (o Google leva 2–3 dias para consolidar). Impressões são exibições do site nos resultados, não pessoas nem volume total do mercado. CTR = cliques ÷ impressões; posição média ponderada por impressões.</p>

    <div className="grid grid-2">
      <section className="card"><GscTrend series={d.series} previous={d.previousSeries} metric="impressions" label="Evolução das impressões" /></section>
      <section className="card"><GscTrend series={d.series} previous={d.previousSeries} metric="clicks" label="Evolução dos cliques" /></section>
    </div>

    <div className="grid grid-3">
      <section className="card"><div className="card-label">Buscas pela marca</div><div className="card-value">{fmtInt(d.branded.clicks)} <small>cliques</small></div><p className="kicker">{fmtInt(d.branded.impressions)} impressões · CTR {fmtPct(d.branded.ctr)}</p>{!d.terms.brand.length && <p className="notice warning">Sem termos de marca configurados.</p>}</section>
      <section className="card"><div className="card-label">Buscas sem marca</div><div className="card-value">{fmtInt(d.nonBranded.clicks)} <small>cliques</small></div><p className="kicker">{fmtInt(d.nonBranded.impressions)} impressões · CTR {fmtPct(d.nonBranded.ctr)} · posição {fmtPos(d.nonBranded.position)}</p></section>
      <section className="card"><div className="card-label">Consultas não detalhadas pelo Google</div><div className="card-value">{fmtPct(d.hiddenQueryShare.clicks)} <small>dos cliques</small></div><p className="kicker">{fmtPct(d.hiddenQueryShare.impressions)} das impressões vêm de consultas anonimizadas ou raras, que o Google não lista. Marca/sem marca consideram só as consultas listadas.</p></section>
    </div>

    <section>
      <h2 className="section-title">Principais consultas</h2>
      <div className="table-wrap"><table className="table"><thead><tr><th>Consulta</th><th className="n">Cliques</th><th className="n">Impressões</th><th className="n">CTR</th><th className="n">Posição</th><th>Tipo</th></tr></thead><tbody>{d.topQueries.map(q => <tr key={q.key}><td><strong>{q.key}</strong></td><td className="n">{fmtInt(q.clicks)}</td><td className="n">{fmtInt(q.impressions)}</td><td className="n">{fmtPct(q.ctr)}</td><td className="n">{fmtPos(q.position)}</td><td><span className="pill">{catLabel[q.classification.category]}</span></td></tr>)}</tbody></table></div>
      {!d.topQueries.length && <p className="kicker">O Google não listou consultas para este período.</p>}
    </section>

    <section>
      <h2 className="section-title">Consultas comerciais identificadas</h2>
      {!d.terms.services.length && <p className="notice warning">Nenhum serviço confirmado no cadastro do cliente: consultas de serviço não são identificadas. {canAdmin && <Link href={`/clients/${id}/editar`}><u>Informar serviços</u></Link>}</p>}
      {d.commercialQueries.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Consulta</th><th>Motivo</th><th className="n">Cliques</th><th className="n">Impressões</th><th className="n">Posição</th></tr></thead><tbody>{d.commercialQueries.map(q => <tr key={q.key}><td><strong>{q.key}</strong></td><td className="kicker">{catLabel[q.classification.category]}{q.classification.matched.length ? `: ${q.classification.matched.join(', ')}` : ''}</td><td className="n">{fmtInt(q.clicks)}</td><td className="n">{fmtInt(q.impressions)}</td><td className="n">{fmtPos(q.position)}</td></tr>)}</tbody></table></div> : <p className="kicker">Nenhuma consulta comercial identificada nas consultas listadas pelo Google.</p>}
    </section>

    <section>
      <h2 className="section-title">Principais páginas</h2>
      <div className="table-wrap"><table className="table"><thead><tr><th>Página</th><th className="n">Cliques</th><th className="n">Impressões</th><th className="n">CTR</th><th className="n">Posição</th></tr></thead><tbody>{d.topPages.map(r => <tr key={r.key}><td className="url-cell">{r.key}</td><td className="n">{fmtInt(r.clicks)}</td><td className="n">{fmtInt(r.impressions)}</td><td className="n">{fmtPct(r.ctr)}</td><td className="n">{fmtPos(r.position)}</td></tr>)}</tbody></table></div>
    </section>

    <section>
      <h2 className="section-title">Oportunidades</h2>
      {d.opportunities.length ? <div className="grid grid-2">{d.opportunities.slice(0, 8).map(o => <article key={o.id} className="card opportunity"><span className={`pill ${o.severity === 'HIGH' ? 'strong' : ''}`}>{o.severity === 'HIGH' ? 'Prioridade alta' : 'Prioridade média'}</span><h3>{o.title}</h3><p>{o.description}</p><p className="fine-print">{o.caveat}</p></article>)}</div>
        : <p className="kicker">Nenhuma oportunidade com evidência suficiente neste período. Os critérios exigem volume mínimo de impressões, posição e intenção{cov.comparable ? '' : '; quedas e crescimentos só são avaliados com período anterior comparável'}.</p>}
    </section>
  </div>;
}
