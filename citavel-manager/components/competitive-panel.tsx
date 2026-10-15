import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { loadComparison, listCompetitors, type ComparisonView } from '@/lib/competitive/service';
import type { Row, Rate, Cell } from '@/lib/competitive/metrics';
import { providerLabel } from '@/lib/ai-measurement/parse';
import { CompetitiveManage } from './competitive-manage';

const pct = (r: Rate | null) => r ? `${(r.value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : null;
export const fmtPp = (v: number | null) => v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export function Logo({ clientId, assetId, name, size = 34 }: { clientId: string; assetId?: string | null; name: string; size?: number }) {
  return assetId
    // eslint-disable-next-line @next/next/no-img-element
    ? <span className="cmp-logo" style={{ width: size, height: size }}><img src={`/api/clients/${clientId}/brand-assets/${assetId}`} alt={`Logo de ${name}`} /></span>
    : <span className="cmp-logo avatar" style={{ width: size, height: size }} title="Logo não cadastrada (iniciais)" aria-hidden="true">{initials(name)}</span>;
}

function RateCell({ rate, what }: { rate: Rate | null; what: string }) {
  if (!rate) return <span className="muted-text" title="Sem numerador e total de observações informados">—</span>;
  return <span title={`${what}: ${rate.numerator} ÷ ${rate.denominator} respostas (${rate.platforms} ${rate.platforms === 1 ? 'plataforma' : 'plataformas'})`}>{pct(rate)}<small> {rate.numerator}/{rate.denominator}</small></span>;
}
function MatrixCell({ c }: { c: Cell }) {
  if (c.state === 'RATE') return <>{pct(c.rate)}<small> {c.rate.numerator}/{c.rate.denominator}</small></>;
  if (c.state === 'NO_COUNT') return <>{c.count}<small> sem total</small></>;
  if (c.state === 'NOT_COMPARABLE') return <span className="muted-text" title={c.reason}>Não comparável</span>;
  return <span className="muted-text">Não medido</span>;
}

const KEYS = { mention: 'Menções', recommendation: 'Recomendações', citation: 'Citações' } as const;

export async function CompetitivePanel({ id, operate, params }: { id: string; operate: boolean; params: { m?: string; p?: string; k?: string } }) {
  const view: ComparisonView | null = await loadComparison(id, { measurementId: params.m || null, provider: params.p || null });
  if (!view) return null;
  const { comparison: cmp, measurement: ms, logos } = view;
  const key = (['mention', 'recommendation', 'citation'] as const).find(k => k === params.k) || 'recommendation';
  const logoOf = (r: { id: string | null }) => logos.get(r.id ?? 'CLIENT')?.approved?.id ?? null;
  const rows: Row[] = [cmp.client, ...cmp.competitors];
  const top = cmp.top; const manage = operate ? await listCompetitors(id) : null;
  const pending = manage ? manage.filter(c => c.logo.pending && !c.logo.approved).length + (logos.get('CLIENT')?.pending && !logos.get('CLIENT')?.approved ? 1 : 0) : 0;
  const qs = (patch: Record<string, string | undefined>) => { const q = new URLSearchParams(); const merged = { m: params.m, p: params.p, k: params.k, ...patch }; for (const [a, b] of Object.entries(merged)) if (b) q.set(a, b); const s = q.toString(); return s ? `?${s}` : '?'; };

  return <section className="card cmp" aria-labelledby="cmp-title">
    <div className="cmp-head"><div><h2 id="cmp-title" className="section-title big">Como sua marca se compara?</h2>
      <p className="kicker">Compare a presença da empresa com os concorrentes identificados nas respostas das inteligências artificiais monitoradas.</p></div>
      <form className="cmp-filters" method="get">
        <label>Medição<select name="m" defaultValue={ms.id} aria-label="Medição">{(await measurementOptions(id)).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label>Plataforma<select name="p" defaultValue={params.p || ''} aria-label="Plataforma"><option value="">Todas</option>{ms.providers.map(p => <option key={p} value={p}>{providerLabel(p)}</option>)}</select></label>
        <button className="button" type="submit">Aplicar</button></form></div>
    <p className="cmp-meta"><span className={`class-badge small ${ms.classification === 'GOLDEN' ? 'golden' : ms.classification === 'LAB' ? 'lab' : 'qual'}`}>{ms.classification === 'QUALITATIVE' ? 'Qualitativa' : ms.classification}</span> {ms.title} · {ms.methodology}{ms.methodologyVersion ? ` v${ms.methodologyVersion}` : ''} · {ms.periodStart ? `${ms.periodStart.split('-').reverse().join('/')} a ${(ms.periodEnd || ms.periodStart).split('-').reverse().join('/')}` : ms.executedAt ? `execução em ${ms.executedAt.split('-').reverse().join('/')}` : 'período não informado'}{cmp.provider ? ` · ${providerLabel(cmp.provider)}` : ' · todas as plataformas'}. Medições LAB e GOLDEN nunca são combinadas.</p>

    {!cmp.hasComparableData ? <p className="notice">Não há dados competitivos suficientes para produzir uma comparação validada neste período. {view.withoutData.length || cmp.notComparable.length ? 'Concorrentes cadastrados sem contagens da medição aparecem como “Sem dados de medição”.' : 'Quando a medição importada trouxer as contagens dos concorrentes (campo competitive_analysis), a tabela será montada aqui.'}</p> : <>
      {top && top.diff?.recommendation != null && <div className="cmp-highlight"><span className="card-label">Concorrente mais presente nas recomendações</span><strong>{top.name}</strong>
        <span>{pct(top.recommendation)} <small>{top.recommendation!.numerator}/{top.recommendation!.denominator}</small> × {cmp.client.name} {pct(cmp.client.recommendation) || '—'}</span>
        <span className={`cmp-diff ${top.diff.recommendation! > 0 ? 'pos' : top.diff.recommendation! < 0 ? 'neg' : ''}`}>{fmtPp(top.diff.recommendation)} <small>para {cmp.client.name}, nas mesmas plataformas</small></span></div>}
      <div className="table-wrap"><table className="table cmp-table"><thead><tr><th>Empresa</th><th className="n">Menções</th><th className="n">Recomendações</th><th className="n">Citações</th><th className="n" title="Recomendações da empresa ÷ recomendações de todas as empresas identificadas nesta amostra. Não é market share.">Participação nas recomendações</th><th className="n" title="Cobertura de recomendação do cliente menos a da empresa, em pontos percentuais">Diferença para o cliente</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id ?? 'client'} className={r.isClient ? 'is-client' : ''}>
          <td><span className="cmp-company"><Logo clientId={id} assetId={logoOf(r)} name={r.name} /><span><strong>{r.name}</strong>{r.isClient && <em className="cmp-you">cliente</em>}{r.domain && <small>{r.domain}</small>}</span></span></td>
          {r.measured ? <>
            <td className="n"><RateCell rate={r.mention} what="Menções" /></td><td className="n"><RateCell rate={r.recommendation} what="Recomendações" /></td><td className="n"><RateCell rate={r.citation} what="Citações do domínio" /></td>
            <td className="n"><RateCell rate={r.share} what="Participação nas recomendações da amostra" /></td>
            <td className="n">{r.isClient ? <span className="muted-text">—</span> : r.diff?.recommendation != null ? <span className={`cmp-diff ${r.diff.recommendation > 0 ? 'pos' : r.diff.recommendation < 0 ? 'neg' : ''}`}>{fmtPp(r.diff.recommendation)}</span> : <span className="muted-text">—</span>}</td></>
            : <td colSpan={5} className="muted-text">{r.skipped.length ? `Não comparável: ${r.skipped.map(s => `${providerLabel(s.provider)} (${s.reason})`).join('; ')}` : 'Sem dados de medição.'}</td>}
        </tr>)}{view.withoutData.map(n => <tr key={n.id}><td><span className="cmp-company"><Logo clientId={id} assetId={logos.get(n.id)?.approved?.id ?? null} name={n.name} /><span><strong>{n.name}</strong>{n.domain && <small>{n.domain}</small>}</span></span></td><td colSpan={5} className="muted-text">Sem dados de medição.</td></tr>)}</tbody></table></div>
      <p className="fine-print">Percentuais = contagens ÷ respostas analisadas, com numerador/denominador ao passar o mouse e ao lado do valor. A participação é calculada só sobre as empresas identificadas nesta amostra e não representa market share. Empresas só aparecem comparadas quando foram medidas sobre as mesmas respostas do cliente.</p>
      {cmp.notComparable.length > 0 && <p className="notice warning"><AlertTriangle size={14} /> Dados não comparáveis ignorados: {cmp.notComparable.map(n => `${n.competitor} em ${n.platform} (${n.reason})`).join('; ')}.</p>}

      <h3 className="card-label cmp-sub">Presença por plataforma</h3>
      <div className="cmp-toggle" role="tablist" aria-label="Métrica">{(Object.keys(KEYS) as (keyof typeof KEYS)[]).map(k => <Link key={k} role="tab" aria-selected={k === key} className={`chip ${k === key ? 'active' : ''}`} href={qs({ k })} scroll={false}>{KEYS[k]}</Link>)}</div>
      <div className="table-wrap"><table className="table cmp-matrix"><thead><tr><th>Empresa</th>{cmp.matrix.providers.map(p => <th key={p} className="n">{providerLabel(p)}</th>)}</tr></thead>
        <tbody>{cmp.matrix.rows.map(r => <tr key={r.id ?? 'client'} className={r.isClient ? 'is-client' : ''}><td><span className="cmp-company"><Logo clientId={id} assetId={logoOf(r)} name={r.name} size={26} /><strong>{r.name}</strong></span></td>{cmp.matrix.providers.map(p => <td key={p} className="n"><MatrixCell c={(r.cells as any)[p][key]} /></td>)}</tr>)}</tbody></table></div>

      <h3 className="card-label cmp-sub">Onde existem oportunidades?</h3>
      {cmp.opportunities.length ? <div className="cmp-opps">{cmp.opportunities.map(o => <article key={o.id} className="cmp-opp"><span className={`sev ${o.priority === 'ALTA' ? 'high' : ''}`}>PRIORIDADE {o.priority}</span><h4>{o.title}</h4><p>{o.description}</p><small>Evidência: {o.evidence}</small></article>)}</div>
        : <p className="kicker">Nenhuma diferença desfavorável ao cliente foi observada nos dados comparáveis desta medição.</p>}
      <p className="fine-print">Oportunidades descrevem o observado nesta amostra; não indicam causa nem garantem recomendações futuras.</p>
    </>}
    {manage && <CompetitiveManage clientId={id} competitors={JSON.parse(JSON.stringify(manage))} clientLogo={JSON.parse(JSON.stringify(logos.get('CLIENT') ?? { approved: null, pending: null }))} pending={pending} />}
  </section>;
}

async function measurementOptions(id: string) {
  const { listMeasurements } = await import('@/lib/ai-measurement/service');
  return (await listMeasurements(id)).map(m => ({ id: m.id, label: `${m.title} · ${m.classification === 'QUALITATIVE' ? 'Qualitativa' : m.classification}${m.executedAt ? ' · ' + m.executedAt.split('-').reverse().join('/') : ''}` }));
}
