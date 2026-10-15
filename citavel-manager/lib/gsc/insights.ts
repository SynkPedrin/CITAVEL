// Read model for the client "Google / SEO" dashboard and the report snapshot. Every query is scoped by client_id
// AND by a site_url that has an ACTIVE binding to that client, so data from another tenant cannot be addressed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db';
import { aggregate, delta, resolvePeriod, type Aggregate, type Period } from './metrics';
import { classifyQuery, defaultBrandTerms, normalize, type ClassifierTerms, type Classification } from './classify';
import { detectOpportunities, type Opportunity } from './opportunities';

export type KeyAgg = Aggregate & { key: string };
export const MIN_COVERAGE = 0.8;

export async function clientTerms(clientId: string): Promise<ClassifierTerms & { origin: Record<string, string>; display: { services: string[]; locations: string[] } }> {
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const meta = (c.metadata || {}) as any; const custom = meta.gsc?.terms || {};
  let engine: any = null;
  try { engine = JSON.parse(await fs.readFile(path.join(process.env.CITAVEL_ENGINE_PATH || '/Users/pedro/Documents/CITAVEL/citavel-engine', 'clients', c.engineClientId, 'config/client.json'), 'utf8')); } catch { /* draft clients have no Engine config */ }
  const services = [...(Array.isArray(engine?.priority_services) ? engine.priority_services : []), ...(meta.wizard?.priorityServices || []), ...(custom.services || [])];
  const locations = [...(Array.isArray(engine?.locations) ? engine.locations : []), ...(c.location ? [c.location] : []), ...(custom.locations || [])];
  return {
    brand: defaultBrandTerms(c.brandName, c.domain, custom.brand || []),
    services: [...new Set(services.map(String).map(normalize).filter(Boolean))],
    locations: [...new Set(locations.map(String).map(normalize).filter(Boolean))],
    // Original spelling for people-facing text (briefing); the normalized lists above are only for matching.
    display: { services: [...new Map(services.map(String).map(x => [normalize(x), x.trim()])).values()].filter(Boolean), locations: [...new Map(locations.map(String).map(x => [normalize(x), x.trim()])).values()].filter(Boolean) },
    origin: { brand: 'nome da marca + domínio + termos revisados', services: engine ? 'priority_services confirmados no Engine + revisão' : 'termos revisados no Manager', locations: engine ? 'locations do Engine + revisão' : 'termos revisados no Manager' },
  };
}

export async function activeBindings(clientId: string) {
  return db.clientPropertyBinding.findMany({ where: { clientId, status: 'ACTIVE' }, include: { property: true }, orderBy: [{ isPrimary: 'desc' }, { boundAt: 'asc' }] });
}

async function grouped(clientId: string, siteUrl: string, dimension: string, start: string, end: string): Promise<KeyAgg[]> {
  const rows = await db.$queryRaw<{ key: string; clicks: bigint; impressions: bigint; wpos: number | null }[]>`
    SELECT key, SUM(clicks)::bigint AS clicks, SUM(impressions)::bigint AS impressions, SUM(position * impressions) AS wpos
    FROM gsc_dimension_metrics WHERE client_id = ${clientId} AND site_url = ${siteUrl} AND search_type = 'web'
      AND dimension = ${dimension} AND date >= ${start} AND date <= ${end} GROUP BY key`;
  return rows.map(r => { const clicks = Number(r.clicks), impressions = Number(r.impressions); return { key: r.key, clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions && r.wpos != null ? Number(r.wpos) / impressions : null }; });
}
async function daily(clientId: string, siteUrl: string, start: string, end: string, searchType = 'web') {
  return db.gscDailyMetric.findMany({ where: { clientId, siteUrl, searchType, date: { gte: start, lte: end } }, orderBy: { date: 'asc' } });
}

export type SearchData = Awaited<ReturnType<typeof loadSearchData>>;
export async function loadSearchData(clientId: string, opts: { propertyId?: string; period?: string; from?: string; to?: string } = {}) {
  const bindings = await activeBindings(clientId);
  const binding = bindings.find(b => b.propertyId === opts.propertyId) || bindings[0];
  if (!binding) return { state: 'NOT_BOUND' as const, bindings: [] as typeof bindings };
  const site = binding.property.siteUrl;
  const latestRow = await db.gscDailyMetric.findFirst({ where: { clientId, siteUrl: site, searchType: 'web' }, orderBy: { date: 'desc' } });
  const lastJob = await db.gscSyncJob.findFirst({ where: { bindingId: binding.id }, orderBy: { createdAt: 'desc' } });
  if (!latestRow) return { state: 'NO_DATA' as const, bindings, binding, lastJob };
  const period: Period = resolvePeriod(opts.period, latestRow.date, { from: opts.from, to: opts.to });
  const [cur, prev] = await Promise.all([daily(clientId, site, period.start, period.end), daily(clientId, site, period.previous.start, period.previous.end)]);
  // Coverage: a comparison is only meaningful when both windows are (almost) fully covered by daily data.
  const coverage = { requestedDays: period.days, currentDays: cur.length, previousDays: prev.length, firstDate: cur[0]?.date || null, lastDate: cur.at(-1)?.date || null,
    comparable: cur.length >= Math.ceil(period.days * MIN_COVERAGE) && prev.length >= Math.ceil(period.days * MIN_COVERAGE) };
  const totals = aggregate(cur), previousTotals = coverage.comparable ? aggregate(prev) : null;
  const terms = await clientTerms(clientId);
  const labels = new Map((await db.gscQueryLabel.findMany({ where: { clientId } })).map(l => [l.query, l]));
  const classify = (r: KeyAgg) => ({ ...r, classification: classifyQuery(r.key, terms, labels.get(r.key)) as Classification });
  const [q, qPrev, pages, pagesPrev, devices, countries] = await Promise.all([
    grouped(clientId, site, 'QUERY', period.start, period.end), grouped(clientId, site, 'QUERY', period.previous.start, period.previous.end),
    grouped(clientId, site, 'PAGE', period.start, period.end), grouped(clientId, site, 'PAGE', period.previous.start, period.previous.end),
    grouped(clientId, site, 'DEVICE', period.start, period.end), grouped(clientId, site, 'COUNTRY', period.start, period.end),
  ]);
  const queries = q.map(classify), previousQueries = qPrev.map(classify);
  const sumOf = (list: KeyAgg[]) => aggregate(list.map(r => ({ clicks: r.clicks, impressions: r.impressions, position: r.position ?? 0 })));
  const queryTable = sumOf(queries);
  const branded = sumOf(queries.filter(r => r.classification.branded)), nonBranded = sumOf(queries.filter(r => !r.classification.branded));
  const prevBranded = coverage.comparable && previousQueries.length ? sumOf(previousQueries.filter(r => r.classification.branded)) : null;
  const byCategory = ['BRANDED', 'SERVICE', 'LOCATION', 'COMMERCIAL', 'INFORMATIONAL', 'OTHER'].map(cat => ({ category: cat, ...sumOf(queries.filter(r => r.classification.category === cat)), queries: queries.filter(r => r.classification.category === cat).length }));
  const otherTypes = await Promise.all(['image', 'video', 'news'].map(async t => ({ type: t, ...aggregate(await daily(clientId, site, period.start, period.end, t)) })));
  const opportunities: Opportunity[] = detectOpportunities({ queries, previousQueries: coverage.comparable ? previousQueries : [], pages, previousPages: coverage.comparable ? pagesPrev : [], days: period.days });
  // Monthly evolution over the whole imported history (sum of authoritative daily totals; CTR/position recomputed).
  const monthRows = await db.$queryRaw<{ month: string; clicks: bigint; impressions: bigint; wpos: number | null; days: bigint; first: string; last: string }[]>`
    SELECT substr(date, 1, 7) AS month, SUM(clicks)::bigint AS clicks, SUM(impressions)::bigint AS impressions, SUM(position * impressions) AS wpos,
      COUNT(*)::bigint AS days, MIN(date) AS first, MAX(date) AS last
    FROM gsc_daily_metrics WHERE client_id = ${clientId} AND site_url = ${site} AND search_type = 'web' GROUP BY 1 ORDER BY 1`;
  const monthly = monthRows.map(m => { const clicks = Number(m.clicks), impressions = Number(m.impressions); const dim = new Date(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5, 7), 0)).getUTCDate();
    return { month: m.month, clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions && m.wpos != null ? Number(m.wpos) / impressions : null, days: Number(m.days), partial: Number(m.days) < dim }; });
  const lastSuccess = await db.gscSyncJob.findFirst({ where: { bindingId: binding.id, status: { in: ['SUCCESS', 'PARTIAL'] } }, orderBy: { finishedAt: 'desc' } });
  const top = <T extends KeyAgg>(list: T[], n = 25) => [...list].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, n);
  return {
    state: 'READY' as const, bindings, binding, lastJob, lastSuccess, period, coverage, terms,
    totals, previousTotals,
    deltas: { clicks: delta(totals.clicks, previousTotals?.clicks ?? null), impressions: delta(totals.impressions, previousTotals?.impressions ?? null), ctr: delta(totals.ctr, previousTotals?.ctr ?? null), position: delta(totals.position, previousTotals?.position ?? null) },
    series: cur.map(r => ({ date: r.date, clicks: r.clicks, impressions: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : null, position: r.position })),
    previousSeries: (coverage.comparable ? prev : []).map(r => ({ date: r.date, clicks: r.clicks, impressions: r.impressions })),
    monthly, queries, topQueries: top(queries), topPages: top(pages), devices: top(devices, 10), countries: top(countries, 10),
    commercialQueries: top(queries.filter(q => ['COMMERCIAL', 'SERVICE', 'LOCATION'].includes(q.classification.category) || q.classification.tags.includes('COMMERCIAL')), 15),
    queryTable, branded, nonBranded, prevBranded, byCategory, otherTypes, opportunities,
    // Clicks/impressions of the property total that do not appear in the query table (anonymized + long tail).
    hiddenQueryShare: { clicks: totals.clicks ? 1 - queryTable.clicks / totals.clicks : null, impressions: totals.impressions ? 1 - queryTable.impressions / totals.impressions : null },
    sitemaps: ((lastSuccess?.details as any)?.sitemaps || null) as any[] | null,
  };
}

/** Persists detected opportunities as review-only Gaps in the Manager (never actions, never published). */
export async function saveOpportunities(clientId: string, list: Opportunity[], period: Period) {
  for (const o of list) {
    const data = { type: 'SEARCH_OPPORTUNITY', severity: o.severity, description: `${o.title}. ${o.description}`, confidence: o.confidence, data: { source: 'SEARCH_CONSOLE', kind: o.kind, subject: o.subject, evidence: o.evidence, caveat: o.caveat, period: { start: period.start, end: period.end }, detected_at: new Date().toISOString(), requires_review: true } as any };
    await db.gap.upsert({ where: { clientId_externalId: { clientId, externalId: o.id } }, create: { clientId, externalId: o.id, status: 'OPEN', ...data }, update: data });
  }
  return list.length;
}
