// HTML template for the CITÁVEL report PDF. Pure function of the immutable snapshot: no data access, no JS.
// Brand: real assets from public/brand (logo, icon, wallpaper) and the Manager palette tokens.
import fs from 'node:fs';
import path from 'node:path';

const asset = (f: string, mime: string) => { try { return `data:${mime};base64,${fs.readFileSync(path.join(process.cwd(), 'lib/report/assets', f)).toString('base64')}`; } catch { return ''; } };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const T = {
  'pt-BR': { title: 'Relatório de presença digital e visibilidade em IA', client: 'Cliente', period: 'Período', type: { EXECUTIVO: 'Executivo', TECNICO: 'Técnico', COMPLETO: 'Completo' }, generated: 'Gerado em', snapshot: 'Snapshot',
    s: { summary: 'Resumo executivo', google: 'Desempenho no Google', impressions_clicks: 'Impressões e cliques', top_queries: 'Principais pesquisas', service_queries: 'Buscas por serviço', brand_queries: 'Buscas pela marca', evolution: 'Evolução', pages: 'Páginas com desempenho', ai_presence: 'Presença em IA', competitors: 'Comparação competitiva', implementations: 'Implementações realizadas', opportunities: 'Oportunidades', next_actions: 'Próximas ações', methodology: 'Metodologia e fontes' },
    impressions: 'Impressões', clicks: 'Cliques', ctr: 'CTR', position: 'Posição média', vsPrev: 'vs período anterior', noPrev: 'sem período anterior', query: 'Pesquisa', page: 'Página', category: 'Categoria', month: 'Mês', current: 'Período atual', previous: 'Período anterior',
    unavailable: 'Indisponível', branded: 'Com marca', nonBranded: 'Sem marca', hidden: 'Consultas não detalhadas pelo Google', property: 'Propriedade', range: 'Histórico disponível', synced: 'Última sincronização', sample: 'Amostra', platforms: 'Plataformas', mention: 'Menção da marca', recommendation: 'Recomendação', citation: 'Citação do site', dataset: 'Base', source: 'Origem', collected: 'Coleta', notes: 'Notas', status: 'Status', priority: 'Prioridade', device: 'Dispositivo',
    cat: { BRANDED: 'Marca', SERVICE: 'Serviço', LOCATION: 'Localidade', COMMERCIAL: 'Comercial', INFORMATIONAL: 'Informacional', OTHER: 'Outras', NON_BRANDED: 'Sem marca' },
    reasons: { NO_PROPERTY_BOUND: 'Nenhuma propriedade do Search Console vinculada a este cliente.', NO_DATA_IMPORTED: 'A propriedade está vinculada, mas os dados ainda não foram importados.', NO_CONFIRMED_SERVICES: 'Nenhum serviço confirmado foi configurado; a classificação por serviço não é estimada.', NO_GOLDEN_OBSERVATIONS: 'Nenhuma resposta real (GOLDEN) foi registrada.', NO_LAB_RUNS: 'Nenhuma execução LAB registrada.', NO_CONFIRMED_COMPETITORS: 'Sem concorrentes confirmados no universo monitorado.' } as Record<string, string>,
    limits: ['Impressões contam exibições do site nos resultados; não representam pessoas nem o volume total de pesquisas do mercado.', 'O Google omite consultas raras ou anonimizadas da tabela de pesquisas; por isso a soma das pesquisas é menor que o total.', 'CTR é recalculado como cliques ÷ impressões; a posição média é ponderada por impressões. Nenhuma taxa é somada.', 'Propriedades de domínio e de prefixo de URL são tratadas separadamente e nunca somadas.', 'O total de páginas indexadas não é fornecido pela API (UNAVAILABLE_FROM_API) e não é estimado a partir do sitemap.', 'Resultados LAB são testes automatizados; GOLDEN são respostas reais registradas pelo operador. Os dois nunca são combinados.', 'Variações descrevem associações observadas, sem afirmar causalidade.'] },
  en: { title: 'Digital presence and AI visibility report', client: 'Client', period: 'Period', type: { EXECUTIVO: 'Executive', TECNICO: 'Technical', COMPLETO: 'Complete' }, generated: 'Generated on', snapshot: 'Snapshot',
    s: { summary: 'Executive summary', google: 'Google performance', impressions_clicks: 'Impressions and clicks', top_queries: 'Top searches', service_queries: 'Searches by service', brand_queries: 'Brand searches', evolution: 'Evolution', pages: 'Top pages', ai_presence: 'AI presence', competitors: 'Competitive comparison', implementations: 'Implementations delivered', opportunities: 'Opportunities', next_actions: 'Next actions', methodology: 'Methodology and sources' },
    impressions: 'Impressions', clicks: 'Clicks', ctr: 'CTR', position: 'Average position', vsPrev: 'vs previous period', noPrev: 'no previous period', query: 'Search', page: 'Page', category: 'Category', month: 'Month', current: 'Current period', previous: 'Previous period',
    unavailable: 'Unavailable', branded: 'Branded', nonBranded: 'Non-branded', hidden: 'Queries not disclosed by Google', property: 'Property', range: 'Available history', synced: 'Last sync', sample: 'Sample', platforms: 'Platforms', mention: 'Brand mention', recommendation: 'Recommendation', citation: 'Site citation', dataset: 'Dataset', source: 'Source', collected: 'Collected', notes: 'Notes', status: 'Status', priority: 'Priority', device: 'Device',
    cat: { BRANDED: 'Brand', SERVICE: 'Service', LOCATION: 'Location', COMMERCIAL: 'Commercial', INFORMATIONAL: 'Informational', OTHER: 'Other', NON_BRANDED: 'Non-branded' },
    reasons: { NO_PROPERTY_BOUND: 'No Search Console property is linked to this client.', NO_DATA_IMPORTED: 'The property is linked but data has not been imported yet.', NO_CONFIRMED_SERVICES: 'No confirmed services configured; service classification is not estimated.', NO_GOLDEN_OBSERVATIONS: 'No real (GOLDEN) answers recorded.', NO_LAB_RUNS: 'No LAB runs recorded.', NO_CONFIRMED_COMPETITORS: 'No confirmed competitors in the monitored universe.' } as Record<string, string>,
    limits: ['Impressions count times the site was shown in results; they are not people nor total market search volume.', 'Google omits rare or anonymized queries from the query table, so query rows sum to less than the total.', 'CTR is recomputed as clicks ÷ impressions; average position is impression-weighted. No rates are summed.', 'Domain and URL-prefix properties are handled separately and never summed.', 'Total indexed pages is not provided by the API (UNAVAILABLE_FROM_API) and is not estimated from sitemaps.', 'LAB results are automated tests; GOLDEN are real answers recorded by the operator. They are never combined.', 'Changes describe observed associations without asserting causality.'] },
};

export function renderReportHtml(s: any, meta: { snapshotId: string; hash: string }) {
  const lang = s.language === 'en' ? 'en' : 'pt-BR'; const t = T[lang]; const loc = lang === 'en' ? 'en-US' : 'pt-BR';
  const int = (n: any) => n == null ? '—' : Number(n).toLocaleString(loc);
  const pct = (n: any, d = 1) => n == null ? '—' : `${(n * 100).toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
  const pos = (n: any) => n == null ? '—' : Number(n).toLocaleString(loc, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const day = (d: string) => d ? new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '—';
  const g = s.gsc_metrics; const gOk = g?.status === 'AVAILABLE';
  const deltaTxt = (d: any, kind: 'pct' | 'pp' | 'pos', invert = false) => {
    if (!d || d.abs == null) return `<span class="muted">${t.noPrev}</span>`;
    const v = kind === 'pct' ? d.pct : d.abs; if (v == null) return `<span class="muted">${t.noPrev}</span>`;
    const good = invert ? v < 0 : v > 0; const s2 = v > 0 ? '+' : '';
    const f = (x: number, d: number) => x.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
    const txt = kind === 'pct' ? `${s2}${f(v * 100, 1)}%` : kind === 'pp' ? `${s2}${f(v * 100, 2)} p.p.` : `${s2}${f(v, 1)}`;
    return `<span class="${v === 0 ? 'muted' : good ? 'up' : 'down'}">${txt}</span> <span class="muted">${t.vsPrev}</span>`;
  };
  const kpis = () => gOk ? `<div class="kpis">
    <div class="kpi hero"><div class="lbl">${t.impressions}</div><div class="val">${int(g.totals.impressions)}</div><div class="dl">${deltaTxt(g.deltas.impressions, 'pct')}</div></div>
    <div class="kpi"><div class="lbl">${t.clicks}</div><div class="val">${int(g.totals.clicks)}</div><div class="dl">${deltaTxt(g.deltas.clicks, 'pct')}</div></div>
    <div class="kpi"><div class="lbl">${t.ctr}</div><div class="val">${pct(g.totals.ctr, 2)}</div><div class="dl">${deltaTxt(g.deltas.ctr, 'pp')}</div></div>
    <div class="kpi"><div class="lbl">${t.position}</div><div class="val">${pos(g.totals.position)}</div><div class="dl">${deltaTxt(g.deltas.position, 'pos', true)}</div></div></div>` : '';
  const unavailable = (reason: string) => `<div class="na"><strong>${t.unavailable}.</strong> ${esc(t.reasons[reason] || reason)}</div>`;
  const table = (head: string[], rows: string[][], num: number[] = []) => `<table><thead><tr>${head.map((h, i) => `<th${num.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${num.includes(i) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  // Inline SVG line chart: one measure, current (solid brand) vs previous (dashed grey), no dual axis.
  const line = (metric: 'clicks' | 'impressions', label: string) => {
    const cur: number[] = g.series.map((p: any) => p[metric]); const prev: number[] = g.previous_series.map((p: any) => p[metric]);
    const W = 520, H = 170, L = 44, B = 22, max = Math.max(1, ...cur, ...prev) * 1.08, n = Math.max(cur.length, 2);
    const x = (i: number) => L + (i / (n - 1)) * (W - L - 6), y = (v: number) => H - B - (v / max) * (H - B - 8);
    const pathOf = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticks = [0, 0.5, 1].map(f => max / 1.08 * f);
    const labelIdx = [0, Math.floor((cur.length - 1) / 2), cur.length - 1];
    return `<figure class="chart"><figcaption>${esc(label)}<span class="legend"><i class="sw cur"></i>${t.current}${prev.length ? `<i class="sw prev"></i>${t.previous}` : ''}</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
      ${ticks.map(v => `<line x1="${L}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="#e6e6e1" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="ax">${Number(v.toFixed(0)).toLocaleString(loc, { notation: 'compact' })}</text>`).join('')}
      ${prev.length ? `<path d="${pathOf(prev.slice(0, n))}" fill="none" stroke="#8a8a8a" stroke-width="1.6" stroke-dasharray="4 3"/>` : ''}
      <path d="${pathOf(cur)}" fill="none" stroke="#5f8a00" stroke-width="2"/>
      ${[...new Set(labelIdx)].filter(i => g.series[i]).map(i => `<text x="${x(i)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === cur.length - 1 ? 'end' : 'middle'}" class="ax">${esc(g.series[i].date.slice(8, 10) + '/' + g.series[i].date.slice(5, 7))}</text>`).join('')}
      </svg></figure>`;
  };
  // Horizontal bars, one hue, value labels in text ink.
  const bars = (rows: { label: string; value: number; note?: string }[]) => {
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<div class="bars">${rows.map(r => `<div class="bar-row"><span class="bl">${esc(r.label)}</span><span class="track"><i style="width:${(r.value / max * 100).toFixed(1)}%"></i></span><span class="bv">${int(r.value)}${r.note ? ` <small>${esc(r.note)}</small>` : ''}</span></div>`).join('')}</div>`;
  };

  const sections: Record<string, () => string | null> = {
    summary: () => `<div class="lead">${s.narrative.map((p: string) => `<p>${esc(p)}</p>`).join('')}</div>${kpis()}`,
    google: () => gOk ? `${s.sections.includes('summary') ? '' : kpis()}<div class="meta-grid"><div><span>${t.property}</span><strong>${esc(g.property)}</strong></div><div><span>${t.range}</span><strong>${esc(g.available_range.start || '—')} ${lang === 'en' ? 'to' : 'a'} ${esc(g.available_range.end || '—')}</strong></div><div><span>${t.synced}</span><strong>${g.last_synced_at ? day(g.last_synced_at.slice(0, 10)) : '—'}</strong></div></div>${g.devices?.length ? `<h3>${t.device}</h3>${bars(g.devices.map((d: any) => ({ label: d.device, value: d.clicks, note: `${int(d.impressions)} ${t.impressions.toLowerCase()}` })))}` : ''}` : unavailable(g.reason),
    impressions_clicks: () => gOk ? `${line('impressions', t.impressions)}${line('clicks', t.clicks)}` : null,
    top_queries: () => gOk ? `${table([t.query, t.category, t.clicks, t.impressions, t.ctr, t.position], g.top_queries.map((q: any) => [esc(q.query), esc(t.cat[q.category as keyof typeof t.cat] || q.category), int(q.clicks), int(q.impressions), pct(q.ctr), pos(q.position)]), [2, 3, 4, 5])}<p class="note">${t.hidden}: ${pct(g.hidden_query_share.clicks)} ${t.clicks.toLowerCase()} · ${pct(g.hidden_query_share.impressions)} ${t.impressions.toLowerCase()}.</p>` : null,
    service_queries: () => !gOk ? null : g.service_queries.status !== 'AVAILABLE' ? unavailable(g.service_queries.reason) : g.service_queries.rows.length ? table([t.query, t.clicks, t.impressions, t.ctr, t.position], g.service_queries.rows.map((q: any) => [esc(q.query), int(q.clicks), int(q.impressions), pct(q.ctr), pos(q.position)]), [1, 2, 3, 4]) : `<p class="note">${lang === 'en' ? 'No identified search matched the confirmed services in this period.' : 'Nenhuma pesquisa identificada correspondeu aos serviços confirmados neste período.'}</p>`,
    brand_queries: () => gOk ? `<div class="split"><div class="kpi hero"><div class="lbl">${t.branded}</div><div class="val">${int(g.brand.branded.clicks)}</div><div class="dl">${int(g.brand.branded.impressions)} ${t.impressions.toLowerCase()} · CTR ${pct(g.brand.branded.ctr)}</div></div><div class="kpi"><div class="lbl">${t.nonBranded}</div><div class="val">${int(g.brand.non_branded.clicks)}</div><div class="dl">${int(g.brand.non_branded.impressions)} ${t.impressions.toLowerCase()} · CTR ${pct(g.brand.non_branded.ctr)}</div></div></div><h3>${t.category}</h3>${bars(g.by_category.map((c: any) => ({ label: t.cat[c.category as keyof typeof t.cat] || c.category, value: c.clicks, note: `${int(c.impressions)} ${t.impressions.toLowerCase()}` })))}<p class="note">${lang === 'en' ? 'Brand terms' : 'Termos de marca'}: ${esc(g.brand.terms.join(', ') || '—')}. ${lang === 'en' ? 'Based only on queries disclosed by Google.' : 'Baseado apenas nas pesquisas detalhadas pelo Google.'}</p>` : null,
    evolution: () => {
      if (!gOk || !g.monthly || g.monthly.length < 2) return null;
      const rows = g.monthly.slice(-16);
      return `${bars(rows.map((m: any) => ({ label: m.month + (m.partial ? '*' : ''), value: m.clicks, note: `${int(m.impressions)} ${t.impressions.toLowerCase()}` })))}${table([t.month, t.clicks, t.impressions, t.ctr, t.position], rows.map((m: any) => [esc(m.month + (m.partial ? '*' : '')), int(m.clicks), int(m.impressions), pct(m.ctr), pos(m.position)]), [1, 2, 3, 4])}<p class="note">* ${lang === 'en' ? 'partial month (start of available history or current month).' : 'mês parcial (início do histórico disponível ou mês corrente).'}</p>`;
    },
    pages: () => gOk && g.top_pages.length ? table([t.page, t.clicks, t.impressions, t.ctr, t.position], g.top_pages.map((p: any) => [`<span class="url">${esc(p.page)}</span>`, int(p.clicks), int(p.impressions), pct(p.ctr), pos(p.position)]), [1, 2, 3, 4]) : null,
    ai_presence: () => `<div class="ai">${['GOLDEN', 'LAB'].map(k => { const a = s.ai_visibility[k]; return `<div class="ai-card ${k.toLowerCase()}"><div class="tag">${k}</div>${a.status !== 'AVAILABLE' ? `<p class="muted">${esc(t.reasons[a.reason] || a.reason)}</p>` : `<div class="ai-grid"><div><span>${t.mention}</span><strong>${pct(a.mention_coverage)}</strong></div><div><span>${t.recommendation}</span><strong>${pct(a.recommendation_coverage)}</strong></div><div><span>${t.citation}</span><strong>${pct(a.citation_rate)}</strong></div></div><p class="note">${t.sample}: ${int(a.sample_size)} · ${t.platforms}: ${esc(a.platforms.join(', '))} · ${esc(a.from)} – ${esc(a.to)}</p><p class="note">${esc(a.methodology)}</p>`}</div>`; }).join('')}</div>`,
    competitors: () => s.competitors.status !== 'AVAILABLE' ? null : `${table([lang === 'en' ? 'Competitor' : 'Concorrente', lang === 'en' ? 'Mentions' : 'Menções', lang === 'en' ? 'Recommendations' : 'Recomendações', 'Share of voice'], s.competitors.rows.map((c: any) => [esc(c.name), int(c.mentions), int(c.recommendations), pct(c.share_of_voice)]), [1, 2, 3])}<p class="note">${esc(s.competitors.universe)}. ${lang === 'en' ? 'Not market share.' : 'Não representa participação de mercado.'}</p>`,
    implementations: () => s.implementations.status !== 'AVAILABLE' ? null : table([lang === 'en' ? 'Implementation' : 'Implementação', t.status], s.implementations.rows.map((a: any) => [esc(a.title), esc(a.status)])),
    opportunities: () => gOk && g.opportunities.length ? `<div class="opps">${g.opportunities.map((o: any) => `<div class="opp"><span class="sev ${o.severity.toLowerCase()}">${esc(o.severity)}</span><h4>${esc(o.title)}</h4><p>${esc(o.description)}</p><p class="note">${esc(o.caveat)}</p></div>`).join('')}</div>` : null,
    next_actions: () => s.next_actions.status !== 'AVAILABLE' ? null : table([lang === 'en' ? 'Action' : 'Ação', t.priority, t.status], s.next_actions.rows.map((a: any) => [esc(a.title), esc(a.priority), esc(a.status)])),
    methodology: () => `${table([t.dataset, t.source, t.collected, t.notes], s.data_provenance.map((p: any) => [esc(p.dataset), esc(p.source), esc(p.collected_at ? String(p.collected_at).slice(0, 10) : '—'), esc(p.notes)]))}<ul class="limits">${t.limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="note">${t.snapshot} ${esc(meta.snapshotId)} · SHA-256 ${esc(meta.hash.slice(0, 16))}… · ${esc(s.generated_at)}</p>`,
  };
  let num = 0;
  const body = (s.sections as string[]).map(id => { const html = sections[id]?.(); if (!html) return ''; num++; return `<section class="sec"><header class="sec-h"><span class="num">${String(num).padStart(2, '0')}</span><h2>${esc((t.s as any)[id])}</h2></header>${html}</section>`; }).join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>CITÁVEL · ${esc(s.client.name)}</title><style>
  @page{size:A4;margin:16mm 15mm 18mm}@page :first{margin:0}
  *{box-sizing:border-box}html,body{margin:0;background:#fff;color:#141414;font-family:Inter,"Open Sans",system-ui,sans-serif;font-size:9.6pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cover{height:297mm;width:210mm;position:relative;overflow:hidden;background:#050505 url(${asset('cover.jpg', 'image/jpeg')}) center/cover;color:#f7f7f5;page-break-after:always}
  .cover:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,5,5,.55),rgba(5,5,5,.25) 40%,rgba(5,5,5,.92) 78%)}
  .cover>*{position:relative;z-index:1}.cover .logo{position:absolute;top:22mm;left:20mm;width:62mm}
  .cover .block{position:absolute;left:20mm;right:20mm;bottom:26mm}
  .cover .kick{font-size:8pt;letter-spacing:.22em;text-transform:uppercase;color:#b8f52a;font-weight:700;margin-bottom:6mm}
  .cover h1{font-size:30pt;line-height:1.05;letter-spacing:-.03em;margin:0 0 12mm;font-weight:700;max-width:150mm}
  .cover .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm;border-top:1px solid rgba(255,255,255,.25);padding-top:5mm}
  .cover .facts span{display:block;font-size:7pt;letter-spacing:.16em;text-transform:uppercase;color:#a5a5a5}.cover .facts strong{font-size:11pt;font-weight:600}
  .sec{margin-top:11mm}.cover+.sec{margin-top:0}.sec-h{break-after:avoid;page-break-after:avoid}.sec>*:nth-child(2){break-before:avoid}
  .sec-h{display:flex;align-items:flex-end;gap:5mm;background:#050505;color:#f7f7f5;padding:7mm 8mm 6mm;border-radius:3mm;margin-bottom:7mm;position:relative;overflow:hidden}
  .sec-h:after{content:"";position:absolute;right:-10mm;top:-6mm;width:60mm;height:30mm;background:url(${asset('icon.png', 'image/png')}) no-repeat right center/contain;opacity:.16}
  .sec-h .num{font-size:24pt;font-weight:700;color:#b8f52a;line-height:1}.sec-h h2{margin:0;font-size:16pt;letter-spacing:-.02em;font-weight:650}
  h3{font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:#5f8a00;margin:7mm 0 3mm}
  .lead p{font-size:11pt;line-height:1.6;margin:0 0 3.5mm;color:#222}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin:6mm 0}.split{display:grid;grid-template-columns:1fr 1fr;gap:3mm}
  .kpi{border:1px solid #e3e3dc;border-radius:2.5mm;padding:4.5mm;background:#fafaf7;break-inside:avoid}.kpi.hero{background:#050505;color:#f7f7f5;border-color:#050505}
  .kpi .lbl{font-size:6.8pt;letter-spacing:.14em;text-transform:uppercase;color:#777;font-weight:700}.kpi.hero .lbl{color:#b8f52a}
  .kpi .val{font-size:19pt;font-weight:700;letter-spacing:-.03em;margin:2mm 0 1mm}.kpi .dl{font-size:7.4pt}.kpi.hero .muted{color:#aaa}
  .up{color:#4d7300;font-weight:600}.kpi.hero .up{color:#b8f52a}.down{color:#b4231c;font-weight:600}.kpi.hero .down{color:#ff8a80}.muted{color:#777}
  .meta-grid{display:grid;grid-template-columns:2fr 1.4fr 1fr;gap:3mm;margin-bottom:2mm}.meta-grid div{border-left:2px solid #b8f52a;padding-left:3mm}.meta-grid span{display:block;font-size:6.8pt;text-transform:uppercase;letter-spacing:.12em;color:#777}.meta-grid strong{font-size:9pt;word-break:break-all}
  table{width:100%;border-collapse:collapse;margin:2mm 0;font-size:8.6pt}thead th{text-align:left;font-size:6.6pt;letter-spacing:.12em;text-transform:uppercase;color:#666;border-bottom:1.5px solid #141414;padding:2mm 2mm}
  td{padding:2.1mm 2mm;border-bottom:1px solid #e8e8e2;vertical-align:top}tr{break-inside:avoid}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.url{word-break:break-all}
  .note{font-size:7.6pt;color:#666;margin:2mm 0}.na{border:1px dashed #c9c9c0;border-radius:2.5mm;padding:5mm;color:#444;background:#fff}
  figure.chart{margin:0 0 6mm;border:1px solid #e3e3dc;border-radius:2.5mm;background:#fff;padding:4mm 4mm 2mm;break-inside:avoid}
  figcaption{display:flex;justify-content:space-between;font-size:7.2pt;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#333;margin-bottom:2mm}
  .legend{font-weight:500;letter-spacing:0;text-transform:none;color:#555;display:flex;gap:2mm;align-items:center}.sw{display:inline-block;width:6mm;height:0;border-top:2px solid #5f8a00;margin-left:3mm}.sw.prev{border-top:2px dashed #8a8a8a}
  .ax{font-size:8px;fill:#777;font-family:inherit}
  .bars{display:flex;flex-direction:column;gap:1.8mm}.bar-row{display:grid;grid-template-columns:32mm 1fr 42mm;gap:3mm;align-items:center;font-size:8.4pt}.track{height:3.2mm;background:#efefe9;border-radius:1mm;overflow:hidden}.track i{display:block;height:100%;background:#5f8a00;border-radius:1mm}.bv{text-align:right;font-variant-numeric:tabular-nums}.bv small{color:#777}
  .ai{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.ai-card{border:1px solid #e3e3dc;border-radius:2.5mm;padding:5mm;background:#fff;break-inside:avoid}.ai-card.golden{border-top:3px solid #5f8a00}.ai-card.lab{border-top:3px solid #8a8a8a}
  .tag{font-size:7pt;letter-spacing:.18em;font-weight:700;color:#555;margin-bottom:3mm}.ai-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm}.ai-grid span{display:block;font-size:6.6pt;color:#777;text-transform:uppercase;letter-spacing:.08em}.ai-grid strong{font-size:15pt}
  .opps{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.opp{border:1px solid #e3e3dc;border-radius:2.5mm;padding:4mm;background:#fff;break-inside:avoid}.opp h4{margin:2mm 0 1.5mm;font-size:9.4pt}.opp p{margin:0 0 1.5mm;font-size:8.2pt}
  .sev{font-size:6.4pt;letter-spacing:.14em;font-weight:700;padding:.6mm 2mm;border-radius:5mm;background:#efefe9;color:#555}.sev.high{background:#141414;color:#b8f52a}
  .limits{font-size:8.2pt;color:#333;padding-left:5mm}.limits li{margin-bottom:1.5mm}
  </style></head><body>
  <div class="cover"><img class="logo" src="${asset('logo.png', 'image/png')}" alt="CITÁVEL"/>
    <div class="block"><div class="kick">${esc(t.type[s.report_type as keyof typeof t.type] || s.report_type)} · ${esc(s.client.domain)}</div><h1>${esc(t.title)}</h1>
    <div class="facts"><div><span>${t.client}</span><strong>${esc(s.client.name)}</strong></div><div><span>${t.period}</span><strong>${day(s.period.start)} — ${day(s.period.end)}</strong></div><div><span>${t.generated}</span><strong>${day(s.generated_at.slice(0, 10))}</strong></div></div></div></div>
  ${body}</body></html>`;
}

export function footerTemplate(s: any) {
  const lang = s.language === 'en' ? 'en' : 'pt-BR';
  return `<div style="width:100%;font-family:Inter,'Open Sans',sans-serif;font-size:7px;color:#888;padding:0 15mm;display:flex;justify-content:space-between"><span><b style="color:#141414">CITÁVEL</b> · ${esc(s.client.name)} · ${esc(s.period.start)} — ${esc(s.period.end)}</span><span>${lang === 'en' ? 'Confidential' : 'Confidencial'} · <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}
