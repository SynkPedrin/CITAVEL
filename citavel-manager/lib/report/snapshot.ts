// REPORT SNAPSHOT: the immutable, self-contained source for a report. Built only from persisted data; every
// number in the narrative is computed here and stored with the snapshot. Missing data is marked explicitly.
import { createHash } from 'node:crypto';
import { db } from '../db';
import { loadSearchData } from '../gsc/insights';
import { addDays, iso, resolvePeriod } from '../gsc/metrics';
import { narrative } from './narrative';

export const REPORT_TYPES = ['EXECUTIVO', 'TECNICO', 'COMPLETO'] as const;
export const SECTION_IDS = ['summary', 'google', 'impressions_clicks', 'top_queries', 'service_queries', 'brand_queries', 'evolution', 'pages', 'ai_presence', 'competitors', 'implementations', 'opportunities', 'next_actions', 'methodology'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const DEFAULT_SECTIONS: Record<(typeof REPORT_TYPES)[number], SectionId[]> = {
  EXECUTIVO: ['summary', 'google', 'impressions_clicks', 'top_queries', 'brand_queries', 'ai_presence', 'implementations', 'opportunities', 'next_actions', 'methodology'],
  TECNICO: ['summary', 'google', 'impressions_clicks', 'top_queries', 'service_queries', 'brand_queries', 'evolution', 'pages', 'opportunities', 'next_actions', 'methodology'],
  COMPLETO: [...SECTION_IDS],
};
export const UNAVAILABLE = (reason: string) => ({ status: 'UNAVAILABLE' as const, reason });

const r = (n: number | null | undefined, d = 4) => n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
const agg = (a: { clicks: number; impressions: number; ctr: number | null; position: number | null }) => ({ clicks: a.clicks, impressions: a.impressions, ctr: r(a.ctr), position: r(a.position, 2) });

export async function buildSnapshotContent(clientId: string, opts: { reportType: (typeof REPORT_TYPES)[number]; language: 'pt-BR' | 'en'; sections: SectionId[]; period?: string; from?: string; to?: string; propertyId?: string }) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, brandName: true, domain: true, location: true, industry: true } });
  const gsc = await loadSearchData(clientId, { propertyId: opts.propertyId, period: opts.period, from: opts.from, to: opts.to });
  const now = new Date();
  const period = gsc.state === 'READY' ? gsc.period : resolvePeriod(opts.period, addDays(iso(now), -1), { from: opts.from, to: opts.to });
  const provenance: { dataset: string; source: string; collected_at: string | null; notes: string }[] = [];

  // ---- Google Search Console ----
  let gscBlock: any;
  if (gsc.state === 'READY') {
    const services = gsc.queries.filter(q => q.classification.category === 'SERVICE').sort((a, b) => b.impressions - a.impressions).slice(0, 12);
    gscBlock = {
      status: 'AVAILABLE', property: gsc.binding.property.siteUrl, property_type: gsc.binding.property.propertyType, search_type: 'web',
      available_range: { start: gsc.binding.availableStartDate, end: gsc.binding.availableEndDate },
      last_synced_at: gsc.lastSuccess?.finishedAt?.toISOString() || null,
      totals: agg(gsc.totals), previous_totals: gsc.previousTotals ? agg(gsc.previousTotals) : null,
      deltas: Object.fromEntries(Object.entries(gsc.deltas).map(([k, v]) => [k, { abs: r(v.abs), pct: r(v.pct) }])),
      series: gsc.series.map(s => ({ date: s.date, clicks: s.clicks, impressions: s.impressions })),
      monthly: gsc.monthly.map(m => ({ month: m.month, clicks: m.clicks, impressions: m.impressions, ctr: r(m.ctr), position: r(m.position, 2), partial: m.partial })),
      previous_series: gsc.previousSeries.map(s => ({ date: s.date, clicks: s.clicks, impressions: s.impressions })),
      top_queries: gsc.topQueries.slice(0, 15).map(q => ({ query: q.key, ...agg(q), category: q.classification.category, rule: q.classification.rule, reviewed: q.classification.source === 'HUMAN' })),
      service_queries: gsc.terms.services.length ? { status: 'AVAILABLE', terms: gsc.terms.services, rows: services.map(q => ({ query: q.key, ...agg(q), matched: q.classification.matched })) } : UNAVAILABLE('NO_CONFIRMED_SERVICES'),
      brand: { terms: gsc.terms.brand, branded: agg(gsc.branded), non_branded: agg(gsc.nonBranded), previous_branded: gsc.prevBranded ? agg(gsc.prevBranded) : null, share_of_identified_clicks: r(gsc.queryTable.clicks ? gsc.branded.clicks / gsc.queryTable.clicks : null) },
      by_category: gsc.byCategory.filter(c => c.queries).map(c => ({ category: c.category, queries: c.queries, ...agg(c) })),
      top_pages: gsc.topPages.slice(0, 12).map(p => ({ page: p.key, ...agg(p) })),
      devices: gsc.devices.map(d => ({ device: d.key, ...agg(d) })),
      hidden_query_share: { clicks: r(gsc.hiddenQueryShare.clicks), impressions: r(gsc.hiddenQueryShare.impressions) },
      indexing: { indexed_pages: 'UNAVAILABLE_FROM_API', sitemaps: gsc.sitemaps || [] },
      opportunities: gsc.opportunities.slice(0, 10),
    };
    provenance.push({ dataset: 'Google Search Console', source: `Search Analytics API · ${gsc.binding.property.siteUrl} · pesquisa na Web · dataState=final`, collected_at: gscBlock.last_synced_at, notes: 'Totais por dia retornados pela API; consultas anonimizadas não aparecem na tabela de consultas. CTR = cliques/impressões; posição média ponderada por impressões.' });
  } else gscBlock = UNAVAILABLE(gsc.state === 'NOT_BOUND' ? 'NO_PROPERTY_BOUND' : 'NO_DATA_IMPORTED');

  // ---- SEO findings (crawler) ----
  const seo = await db.seoSnapshot.findMany({ where: { clientId }, orderBy: { date: 'desc' }, take: 40 });
  const seoBlock = seo.length ? { status: 'AVAILABLE', observed_at: seo[0].date.toISOString(), pages_sampled: seo.length, health_score: seo[0].healthScore, critical_issues: seo.reduce((n, s) => n + (s.criticalIssues || 0), 0), warnings: seo.reduce((n, s) => n + (s.warnings || 0), 0) } : UNAVAILABLE('NO_CRAWL');
  if (seo.length) provenance.push({ dataset: 'Auditoria técnica', source: 'Crawler CITÁVEL (amostra de HTML)', collected_at: seo[0].date.toISOString(), notes: `${seo.length} páginas amostradas; não equivale a cobertura de indexação.` });

  // ---- AI presence (LAB and GOLDEN never mixed) ----
  const runs = await db.aiRun.findMany({ where: { clientId, status: { not: 'ERROR' } }, select: { runType: true, platform: true, model: true, brandMentioned: true, brandRecommended: true, createdAt: true, data: true } });
  const ai: any = {};
  for (const type of ['GOLDEN', 'LAB']) {
    const list = runs.filter(x => x.runType === type);
    if (!list.length) { ai[type] = UNAVAILABLE(type === 'GOLDEN' ? 'NO_GOLDEN_OBSERVATIONS' : 'NO_LAB_RUNS'); continue; }
    const known = (f: (x: typeof list[number]) => boolean | null) => { const k = list.map(f).filter(v => v != null); return k.length ? k.filter(Boolean).length / k.length : null; };
    const dates = list.map(x => x.createdAt.getTime());
    ai[type] = { status: 'AVAILABLE', sample_size: list.length, platforms: [...new Set(list.map(x => x.platform))], models: [...new Set(list.map(x => x.model).filter(Boolean))], from: new Date(Math.min(...dates)).toISOString().slice(0, 10), to: new Date(Math.max(...dates)).toISOString().slice(0, 10),
      mention_coverage: r(known(x => x.brandMentioned)), recommendation_coverage: r(known(x => x.brandRecommended)), citation_rate: r(known(x => { const d = (x.data || {}) as any; return typeof d.owned_domain_cited === 'boolean' ? d.owned_domain_cited : typeof d.owned_site_cited === 'boolean' ? d.owned_site_cited : null; })),
      methodology: type === 'LAB' ? 'Execuções automatizadas por API/modelo local para diagnóstico. Não equivalem às respostas reais das plataformas para usuários.' : 'Respostas reais coletadas e importadas pelo operador nas plataformas indicadas.' };
    provenance.push({ dataset: `Presença em IA · ${type}`, source: ai[type].platforms.join(', '), collected_at: ai[type].to, notes: `${list.length} respostas analisadas (${ai[type].from} a ${ai[type].to}).` });
  }
  const competitors = await db.competitor.findMany({ where: { clientId }, orderBy: { mentions: 'desc' }, take: 10 });
  const compBlock = competitors.length ? { status: 'AVAILABLE', universe: 'Perguntas monitoradas pelo Engine (amostra LAB/GOLDEN)', rows: competitors.map(c => ({ name: c.name, domain: c.domain, mentions: c.mentions, recommendations: c.recommendations, share_of_voice: r(c.shareOfVoice) })) } : UNAVAILABLE('NO_CONFIRMED_COMPETITORS');
  const sources = await db.source.findMany({ where: { clientId }, orderBy: { citationCount: 'desc' }, take: 10 });

  // ---- Implementations & next actions (from the Action Engine mirror) ----
  const actions = await db.action.findMany({ where: { clientId }, orderBy: { priorityScore: 'desc' } });
  const implemented = actions.filter(a => ['PUBLISHED', 'MONITORING', 'MEASURED', 'DONE'].includes(a.status));
  const next = actions.filter(a => ['APPROVED', 'WAITING_APPROVAL', 'PROPOSED', 'READY_TO_PUBLISH', 'NEEDS_INFORMATION'].includes(a.status)).slice(0, 8);

  const content = {
    schema: 'citavel-report-snapshot/v1', generated_at: now.toISOString(), report_type: opts.reportType, language: opts.language, sections: opts.sections,
    client: { name: client.name, brand: client.brandName, domain: client.domain },
    period: { start: period.start, end: period.end, days: period.days, previous: period.previous },
    gsc_metrics: gscBlock, seo_findings: seoBlock, ai_visibility: ai, competitors: compBlock,
    sources: sources.length ? { status: 'AVAILABLE', rows: sources.map(s => ({ domain: s.domain, citations: s.citationCount, client_present: s.clientPresent, run_type: s.runType })) } : UNAVAILABLE('NO_SOURCES_OBSERVED'),
    implementations: implemented.length ? { status: 'AVAILABLE', rows: implemented.map(a => ({ title: a.title, status: a.status, completed_at: a.completedAt?.toISOString() || null })) } : UNAVAILABLE('NO_IMPLEMENTATIONS_RECORDED'),
    next_actions: next.length ? { status: 'AVAILABLE', rows: next.map(a => ({ title: a.title, priority: a.priority, status: a.status, type: a.actionType || a.type })) } : UNAVAILABLE('NO_PENDING_ACTIONS'),
    data_provenance: provenance,
  } as any;
  content.narrative = narrative(content);
  return content;
}

export const hashContent = (content: unknown) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

export async function createSnapshot(clientId: string, actorId: string, opts: Parameters<typeof buildSnapshotContent>[1]) {
  const content = await buildSnapshotContent(clientId, opts);
  return db.reportSnapshot.create({ data: { clientId, reportType: opts.reportType, language: opts.language, periodStart: content.period.start, periodEnd: content.period.end, sections: opts.sections, content, contentHash: hashContent(content), createdById: actorId } });
}
