// REPORT SNAPSHOT v2 (Manager 2.0): Google / SEO, Presença em IA or Completo. Immutable, self-contained:
// every number in the PDF comes from here. AI data is copied from the chosen approved measurement version,
// so later edits to the measurement never change an already generated report.
import { createHash } from 'node:crypto';
import { db } from '../db';
import { loadSearchData } from '../gsc/insights';
import { addDays, iso, resolvePeriod } from '../gsc/metrics';
import { indicators, platformRate, compatibility } from '../ai-measurement/metrics';
import { providerLabel } from '../ai-measurement/parse';
import { HttpError } from '../security';
import { narrativeV2 } from './narrative-v2';
import { loadComparison } from '../competitive/service';
import { dataUri } from '../brand/service';

export const TEMPLATE_VERSION = 'citavel-report-v2.1';
export const REPORT_KINDS = ['GOOGLE', 'IA', 'COMPLETO'] as const;
export const REPORT_FORMATS = ['EXECUTIVO', 'COMPLETO'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportRequest = { kind: ReportKind; format: ReportFormat; period?: string; from?: string; to?: string; measurementId?: string | null };

const r4 = (n: number | null | undefined, d = 4) => n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
const agg = (a: { clicks: number; impressions: number; ctr: number | null; position: number | null }) => ({ clicks: a.clicks, impressions: a.impressions, ctr: r4(a.ctr), position: r4(a.position, 2) });

async function gscBlock(clientId: string, req: ReportRequest) {
  const gsc = await loadSearchData(clientId, { period: req.period, from: req.from, to: req.to });
  if (gsc.state !== 'READY') return { block: { status: 'UNAVAILABLE', reason: gsc.state === 'NOT_BOUND' ? 'NO_PROPERTY_BOUND' : 'NO_DATA_IMPORTED' } as any, period: resolvePeriod(req.period, addDays(iso(new Date()), -1), { from: req.from, to: req.to }) };
  const services = gsc.queries.filter(q => q.classification.category === 'SERVICE').sort((a, b) => b.impressions - a.impressions).slice(0, 12);
  return { period: gsc.period, block: {
    status: 'AVAILABLE', source: 'Google Search Console API · Search Analytics · pesquisa na Web · dataState=final',
    property: gsc.binding.property.siteUrl, property_type: gsc.binding.property.propertyType,
    available_range: { start: gsc.binding.availableStartDate, end: gsc.binding.availableEndDate },
    coverage: gsc.coverage, last_synced_at: gsc.lastSuccess?.finishedAt?.toISOString() || null,
    totals: agg(gsc.totals), previous_totals: gsc.previousTotals ? agg(gsc.previousTotals) : null,
    deltas: gsc.coverage.comparable ? Object.fromEntries(Object.entries(gsc.deltas).map(([k, v]) => [k, { abs: r4(v.abs), pct: r4(v.pct) }])) : null,
    series: gsc.series.map(s => ({ date: s.date, clicks: s.clicks, impressions: s.impressions })),
    previous_series: gsc.previousSeries.map(s => ({ date: s.date, clicks: s.clicks, impressions: s.impressions })),
    monthly: gsc.monthly.map(m => ({ month: m.month, clicks: m.clicks, impressions: m.impressions, ctr: r4(m.ctr), position: r4(m.position, 2), partial: m.partial })),
    top_queries: gsc.topQueries.slice(0, 15).map(q => ({ query: q.key, ...agg(q), category: q.classification.category })),
    commercial_queries: gsc.commercialQueries.slice(0, 10).map(q => ({ query: q.key, ...agg(q), category: q.classification.category })),
    service_queries: gsc.terms.services.length ? { status: 'AVAILABLE', terms: gsc.terms.services, rows: services.map(q => ({ query: q.key, ...agg(q) })) } : { status: 'UNAVAILABLE', reason: 'NO_CONFIRMED_SERVICES' },
    brand: { terms: gsc.terms.brand, branded: agg(gsc.branded), non_branded: agg(gsc.nonBranded), share_of_identified_clicks: r4(gsc.queryTable.clicks ? gsc.branded.clicks / gsc.queryTable.clicks : null) },
    by_category: gsc.byCategory.filter(c => c.queries).map(c => ({ category: c.category, queries: c.queries, ...agg(c) })),
    top_pages: gsc.topPages.slice(0, 12).map(p => ({ page: p.key, ...agg(p) })),
    devices: gsc.devices.map(d => ({ device: d.key, ...agg(d) })),
    hidden_query_share: { clicks: r4(gsc.hiddenQueryShare.clicks), impressions: r4(gsc.hiddenQueryShare.impressions) },
    opportunities: gsc.opportunities.slice(0, 8).map(o => ({ kind: o.kind, severity: o.severity, title: o.title, description: o.description, caveat: o.caveat })),
  } };
}

async function aiBlock(clientId: string, measurementId: string | null | undefined) {
  const approved = await db.aiMeasurement.findMany({ where: { clientId, status: 'APPROVED' }, include: { platforms: true, competitors: true, findings: true }, orderBy: [{ executedAt: 'desc' }, { importedAt: 'desc' }] });
  const m = measurementId ? approved.find(x => x.id === measurementId) : approved[0];
  if (measurementId && !m) throw new HttpError(404, 'Medição de IA não encontrada ou não aprovada para este cliente.', 'MEASUREMENT_NOT_FOUND');
  if (!m) return { status: 'UNAVAILABLE', reason: 'NO_APPROVED_MEASUREMENT' } as any;
  const rows = m.platforms.map(p => ({ ...p, label: providerLabel(p.provider) }));
  const ind = indicators(rows);
  const prev = approved.filter(x => x.id !== m.id && (x.executedAt || '') <= (m.executedAt || '9999')).find(x => compatibility(m, x).compatible);
  const prevInd = prev ? indicators(prev.platforms) : null;
  const byType = (t: string) => m.findings.filter(f => f.type === t).map(f => f.description || f.title);
  return {
    status: 'AVAILABLE', measurement_id: m.id, measurement_version: m.version, title: m.title, classification: m.classification,
    source: m.source, methodology: m.methodology, methodology_version: m.methodologyVersion, executed_at: m.executedAt, period: { start: m.periodStart, end: m.periodEnd },
    raw_text_sha256: createHash('sha256').update(m.rawText).digest('hex'),
    platforms: rows.map(p => ({ provider: p.provider, label: p.label, model: p.model, collection_method: p.collectionMethod, prompts: p.promptCount, observations: p.observationCount, mentions: p.mentionCount, recommendations: p.recommendationCount, citations: p.citationCount,
      mention_rate: platformRate(p, 'mentionCount'), recommendation_rate: platformRate(p, 'recommendationCount'), citation_rate: platformRate(p, 'citationCount') })),
    indicators: ind, quantitative: Boolean(ind.mention || ind.recommendation || ind.citation),
    competitors: m.competitors.map(c => ({ name: c.name, platforms: c.platform ? c.platform.split(',').map(providerLabel) : [] })),
    sources: byType('SOURCE'), strengths: byType('STRENGTH'), weaknesses: byType('WEAKNESS'), opportunities: byType('OPPORTUNITY'), conclusions: byType('CONCLUSION'), limitations: byType('LIMITATION'), evidence: byType('EVIDENCE'),
    comparison: prev && prevInd ? { measurement_id: prev.id, executed_at: prev.executedAt, mention: prevInd.mention, recommendation: prevInd.recommendation } : null,
  };
}

/** Frozen competitive comparison for one measurement: numbers AND approved logos (as data URIs) are copied in, so a
 * historical PDF never changes when a logo is replaced later and rendering never touches the network. */
export async function competitiveBlock(clientId: string, measurementId: string) {
  const view = await loadComparison(clientId, { measurementId });
  if (!view || !view.comparison.hasComparableData) return { status: 'UNAVAILABLE', reason: 'NO_COMPARABLE_DATA' } as any;
  const { comparison: cmp, measurement: ms, logos } = view;
  const logo = async (key: string) => { const a = logos.get(key)?.approved; return a ? { data_uri: await dataUri(a), asset_id: a.id, sha256: a.sha256 } : null; };
  const row = async (r: any) => ({ id: r.id, name: r.name, is_client: r.isClient, domain: r.domain, mention: r.mention, recommendation: r.recommendation, citation: r.citation, share: r.share, diff: r.diff, measured: r.measured, platforms: r.platformsMeasured.map(providerLabel), skipped: r.skipped.map((x: any) => ({ platform: providerLabel(x.provider), reason: x.reason })), logo: await logo(r.id ?? 'CLIENT') });
  const rows = [await row(cmp.client), ...(await Promise.all(cmp.competitors.map(row)))];
  const matrix = cmp.matrix.rows.map(r => ({ name: r.name, is_client: r.isClient, cells: Object.fromEntries(Object.entries(r.cells).map(([p, v]: any) => [providerLabel(p), Object.fromEntries(Object.entries(v).map(([k, c]: any) => [k, c.state === 'RATE' ? { rate: c.rate } : { state: c.state, reason: c.reason ?? null, count: c.count ?? null }]))])) }));
  return { status: 'AVAILABLE', measurement_id: ms.id, measurement_version: ms.version, classification: ms.classification, methodology: ms.methodology, methodology_version: ms.methodologyVersion,
    period: { start: ms.periodStart, end: ms.periodEnd, executed_at: ms.executedAt }, platforms: ms.providers.map(providerLabel),
    rows, top: cmp.top ? { name: cmp.top.name, recommendation: cmp.top.recommendation, diff: cmp.top.diff?.recommendation ?? null } : null,
    matrix_platforms: cmp.matrix.providers.map(providerLabel), matrix, opportunities: cmp.opportunities, not_comparable: cmp.notComparable, without_data: view.withoutData.map(n => n.name) };
}

export async function buildSnapshotV2(clientId: string, req: ReportRequest, actorId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, domain: true, industry: true } });
  const now = new Date();
  const g = req.kind === 'IA' ? null : await gscBlock(clientId, req);
  const ai = req.kind === 'GOOGLE' ? null : await aiBlock(clientId, req.measurementId);
  if (req.kind === 'IA' && ai.status !== 'AVAILABLE') throw new HttpError(409, 'Não há medição de IA aprovada para este cliente. Importe e confirme uma medição antes de gerar o relatório de IA.', 'NO_MEASUREMENT');
  // Without Google data the report period is the measurement's own period (never an empty Google window).
  const period = g && (g.block.status === 'AVAILABLE' || !(ai?.status === 'AVAILABLE')) ? g.period : ai?.period?.start ? { key: 'measurement', start: ai.period.start, end: ai.period.end || ai.period.start, days: null } : { key: 'measurement', start: ai?.executed_at || iso(now), end: ai?.executed_at || iso(now), days: null };
  const competitive = req.kind !== 'GOOGLE' && ai?.status === 'AVAILABLE' ? await competitiveBlock(clientId, ai.measurement_id) : null;
  const provenance: { dataset: string; source: string; collected_at: string | null; notes: string }[] = [];
  if (g?.block.status === 'AVAILABLE') provenance.push({ dataset: 'Google Search Console', source: `${g.block.property} · Search Analytics API (Web, dados consolidados)`, collected_at: g.block.last_synced_at, notes: `Período solicitado ${g.period.start.split('-').reverse().join('/')} a ${g.period.end.split('-').reverse().join('/')}; dados disponíveis em ${g.block.coverage.currentDays} de ${g.block.coverage.requestedDays} dias. Totais diários da API; consultas anonimizadas não aparecem na tabela de consultas.` });
  if (ai?.status === 'AVAILABLE') provenance.push({ dataset: `Presença em IA · ${ai.classification}`, source: `${ai.source} · ${ai.methodology}${ai.methodology_version ? ' v' + ai.methodology_version : ''}`, collected_at: ai.executed_at, notes: `Medição externa importada e revisada no Manager (versão ${ai.measurement_version}). Taxas = contagens ÷ observações informadas.` });
  const content: any = {
    schema: 'citavel-report-snapshot/v2', template_version: TEMPLATE_VERSION, generated_at: now.toISOString(), created_by: actorId,
    report_type: req.kind, format: req.format, language: 'pt-BR',
    client: { name: client.name, domain: client.domain, industry: client.industry || null },
    period, gsc_metrics: g?.block ?? null, ai_visibility: ai, competitive,
    ai_measurement_ids: ai?.status === 'AVAILABLE' ? [ai.measurement_id] : [], ai_measurement_versions: ai?.status === 'AVAILABLE' ? { [ai.measurement_id]: ai.measurement_version } : {},
    data_provenance: provenance,
  };
  content.narrative = narrativeV2(content);
  content.next_steps = nextSteps(content);
  return content;
}

function nextSteps(s: any): string[] {
  const out: string[] = [];
  const g = s.gsc_metrics, ai = s.ai_visibility;
  if (g?.status === 'AVAILABLE') for (const o of g.opportunities.slice(0, 3)) out.push(`Google: ${o.title}.`);
  if (ai?.status === 'AVAILABLE') for (const o of ai.opportunities.slice(0, 3)) out.push(`IA: ${o}`);
  if (g?.status === 'AVAILABLE' && !g.coverage.comparable) out.push('Manter a sincronização diária do Search Console para formar uma base comparável com o período anterior.');
  if (ai?.status === 'AVAILABLE' && !ai.quantitative) out.push('Solicitar aos agentes contagens por plataforma (observações, menções, recomendações e citações) na próxima medição.');
  if (ai?.status === 'AVAILABLE' && ai.classification !== 'GOLDEN') out.push('Para resultados GOLDEN, incluir respostas originais e o método de coleta de cada plataforma.');
  if (ai && ai.status !== 'AVAILABLE') out.push('Realizar a primeira medição de presença em IA para estabelecer a linha de base.');
  return out;
}

export async function createSnapshotV2(clientId: string, actorId: string, req: ReportRequest) {
  const content = await buildSnapshotV2(clientId, req, actorId);
  return db.reportSnapshot.create({ data: { clientId, reportType: req.kind, language: 'pt-BR', periodStart: content.period.start, periodEnd: content.period.end, sections: { format: req.format, template: TEMPLATE_VERSION, ai_measurement_ids: content.ai_measurement_ids, ai_measurement_versions: content.ai_measurement_versions } as any, content, contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), createdById: actorId } });
}
