import Link from 'next/link';
import { Plus } from 'lucide-react';
import { db } from '@/lib/db';
import { listMeasurements, type MeasurementWithIndicators } from '@/lib/ai-measurement/service';
import { compatibility, platformRate, type Rate } from '@/lib/ai-measurement/metrics';
import { providerLabel } from '@/lib/ai-measurement/parse';
import { buildBriefing, DELIVERY_TEMPLATE } from '@/lib/ai-measurement/briefing';
import { loadSearchData, clientTerms } from '@/lib/gsc/insights';
import { DateLabel, EmptyState } from './ui';
import { CopyButton } from './copy-button';
import { CompetitivePanel } from './competitive-panel';

export const CLASS_BADGE: Record<string, [string, string]> = { GOLDEN: ['GOLDEN', 'golden'], LAB: ['LAB', 'lab'], QUALITATIVE: ['Qualitativa / não verificada', 'qual'] };
export const fmtRate = (r: Rate) => r ? `${(r.value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : null;
const day = (d: string | null) => d ? d.split('-').reverse().join('/') : null;

export async function briefingFor(clientId: string, measurements: MeasurementWithIndicators[]) {
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const terms = await clientTerms(clientId);
  const gsc = await loadSearchData(clientId, { period: '12m' });
  const top = gsc.state === 'READY' ? [...gsc.queries].sort((a, b) => b.impressions - a.impressions).filter(q => !/\[(telefone|email|cpf|cnpj|número)\]/.test(q.key)).slice(0, 15).map(q => ({ query: q.key, impressions: q.impressions, clicks: q.clicks })) : [];
  const commercial = gsc.state === 'READY' ? gsc.commercialQueries.map(q => q.key).filter(k => !/\[/.test(k)).slice(0, 10) : [];
  const prev = measurements[0];
  return buildBriefing({ clientName: c.name, domain: c.domain, industry: c.industry || null, locations: terms.display.locations, services: terms.display.services, topQueries: top, commercialQueries: commercial,
    previous: prev ? { title: prev.title, executedAt: prev.executedAt, classification: prev.classification, platforms: prev.platforms.map(p => providerLabel(p.provider)), methodology: prev.methodology } : null });
}

function Indicator({ label, rate, what }: { label: string; rate: Rate; what: string }) {
  return <div className="kpi"><div className="kpi-label">{label}</div>{rate ? <><div className="kpi-value">{fmtRate(rate)}</div><div className="kpi-note">{rate.numerator} de {rate.denominator} respostas ({what}) · {rate.platforms} {rate.platforms === 1 ? 'plataforma' : 'plataformas'}</div></> : <><div className="kpi-value muted-text">—</div><div className="kpi-note">Não calculável: a medição não informou {what} e total de observações.</div></>}</div>;
}

export async function AiPresence({ id, operate, query = {} }: { id: string; operate: boolean; query?: { m?: string; p?: string; k?: string } }) {
  const list = await listMeasurements(id);
  const briefing = operate ? await briefingFor(id, list) : '';
  const actions = operate && <div className="section-actions"><CopyButton text={briefing} label="Copiar briefing de medição" /><CopyButton text={DELIVERY_TEMPLATE} label="Copiar modelo de entrega" ghost /><Link className="button primary" href={`/clients/${id}/ia/importar`}><Plus size={15} /> Importar medição</Link></div>;
  const intro = <div className="section-intro"><div><h2 className="section-title big">Presença em IA</h2><p className="kicker">Acompanhe como a empresa aparece nas respostas das inteligências artificiais monitoradas. As medições são feitas externamente e importadas aqui após revisão.</p></div>{actions}</div>;
  if (!list.length) return <div className="section-stack">{intro}<EmptyState title="Nenhuma medição de IA foi importada." description={operate ? 'Copie o briefing, envie aos agentes e importe o relatório que eles devolverem.' : 'A equipe CITÁVEL publicará aqui as medições revisadas.'} action={operate ? <Link className="button primary" href={`/clients/${id}/ia/importar`}>Importar primeira medição</Link> : undefined} /></div>;
  const m = list[0]; const [cls, tone] = CLASS_BADGE[m.classification] || [m.classification, 'qual'];
  const quantitative = m.indicators.mention || m.indicators.recommendation || m.indicators.citation;
  const findings = (t: string) => m.findings.filter(f => f.type === t);
  const prevCompatible = list.slice(1).find(x => compatibility(m, x).compatible);
  const prev = list[1]; const compat = prev ? compatibility(m, prev) : null;
  return <div className="section-stack">{intro}
    <section className="card summary-card">
      <div className="summary-head"><div><div className="card-label">Última medição aprovada</div><h3>{m.title}</h3></div><span className={`class-badge ${tone}`}>{cls}</span></div>
      <dl className="summary-grid">
        <div><dt>Execução</dt><dd>{day(m.executedAt) || 'não informada'}</dd></div>
        <div><dt>Período avaliado</dt><dd>{m.periodStart ? `${day(m.periodStart)} a ${day(m.periodEnd) || '—'}` : 'não informado'}</dd></div>
        <div><dt>Plataformas</dt><dd>{m.platforms.map(p => providerLabel(p.provider) + (p.model ? ` (${p.model})` : '')).join(', ') || 'não informadas'}</dd></div>
        <div><dt>Observações</dt><dd>{m.indicators.observations != null ? m.indicators.observations.toLocaleString('pt-BR') : 'não informadas'}</dd></div>
        <div><dt>Origem</dt><dd>{m.source}</dd></div>
        <div><dt>Metodologia</dt><dd>{m.methodology}{m.methodologyVersion ? ` · v${m.methodologyVersion}` : ''}</dd></div>
      </dl>
      <Link className="text-link" href={`/clients/${id}/ia/${m.id}`}>Ver medição completa, texto original e evidências →</Link>
    </section>

    {quantitative ? <div className="kpi-row three">
      <Indicator label="Cobertura de menção" rate={m.indicators.mention} what="menções" />
      <Indicator label="Cobertura de recomendação" rate={m.indicators.recommendation} what="recomendações" />
      <Indicator label="Taxa de citação" rate={m.indicators.citation} what="citações do site" />
    </div> : <p className="notice">Esta medição traz apenas análise qualitativa: nenhum percentual é exibido porque o relatório não informou contagens com total de observações.</p>}

    <CompetitivePanel id={id} operate={operate} params={query} />

    {m.platforms.length > 0 && <section><h2 className="section-title">Resultados por plataforma</h2>
      <div className="table-wrap"><table className="table"><thead><tr><th>Plataforma</th><th>Modelo</th><th>Coleta</th><th className="n">Observações</th><th className="n">Menção</th><th className="n">Recomendação</th><th className="n">Citação</th></tr></thead><tbody>{m.platforms.map(p => { const cell = (f: 'mentionCount' | 'recommendationCount' | 'citationCount') => { const r = platformRate(p, f); return r ? <>{fmtRate(r)}<small> {r.numerator}/{r.denominator}</small></> : p[f] != null ? <>{p[f]}<small> sem total</small></> : <span className="muted-text">—</span>; }; return <tr key={p.id}><td><strong>{providerLabel(p.provider)}</strong></td><td>{p.model || <span className="muted-text">—</span>}</td><td>{p.collectionMethod || <span className="muted-text">não informado</span>}</td><td className="n">{p.observationCount ?? '—'}</td><td className="n">{cell('mentionCount')}</td><td className="n">{cell('recommendationCount')}</td><td className="n">{cell('citationCount')}</td></tr>; })}</tbody></table></div>
    </section>}

    <div className="grid grid-2">
      <section className="card"><h3 className="card-label">Concorrentes identificados</h3>{m.competitors.length ? <ul className="plain-list">{m.competitors.map(c => <li key={c.id}><strong>{c.name}</strong>{c.platform && <span className="kicker"> · {c.platform.split(',').map(providerLabel).join(', ')}</span>}</li>)}</ul> : <p className="kicker">Nenhum concorrente citado nesta medição.</p>}</section>
      <section className="card"><h3 className="card-label">Principais descobertas</h3>{[...findings('CONCLUSION'), ...findings('STRENGTH'), ...findings('WEAKNESS')].slice(0, 8).map(f => <p key={f.id} className="finding"><span className="pill">{f.type === 'STRENGTH' ? 'Ponto forte' : f.type === 'WEAKNESS' ? 'Ponto fraco' : 'Conclusão'}</span> {f.description || f.title}</p>)}{![...findings('CONCLUSION'), ...findings('STRENGTH'), ...findings('WEAKNESS')].length && <p className="kicker">Sem descobertas registradas.</p>}</section>
    </div>
    {findings('OPPORTUNITY').length > 0 && <section className="card"><h3 className="card-label">Oportunidades</h3><ul className="plain-list">{findings('OPPORTUNITY').map(f => <li key={f.id}>{f.description || f.title}</li>)}</ul></section>}

    <section><h2 className="section-title">Histórico de medições</h2>
      {compat && !compat.compatible && <p className="notice warning">A medição anterior não é comparável com a atual ({compat.reasons.join('; ')}). Variações percentuais não são exibidas.</p>}
      {prevCompatible && m.indicators.mention && prevCompatible.indicators.mention && <p className="notice">Em relação à medição compatível de {day(prevCompatible.executedAt) || 'data anterior'}, a cobertura de menção passou de {fmtRate(prevCompatible.indicators.mention)} para {fmtRate(m.indicators.mention)}. A comparação descreve o observado e não indica causa.</p>}
      <div className="table-wrap"><table className="table"><thead><tr><th>Medição</th><th>Execução</th><th>Classificação</th><th>Plataformas</th><th className="n">Menção</th><th>Versão</th></tr></thead><tbody>{list.map(x => <tr key={x.id}><td><Link href={`/clients/${id}/ia/${x.id}`}><strong>{x.title}</strong></Link></td><td>{day(x.executedAt) || <DateLabel value={x.importedAt} />}</td><td><span className={`class-badge small ${(CLASS_BADGE[x.classification] || [])[1]}`}>{(CLASS_BADGE[x.classification] || [x.classification])[0]}</span></td><td>{x.platforms.length}</td><td className="n">{fmtRate(x.indicators.mention) || '—'}</td><td>v{x.version}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
