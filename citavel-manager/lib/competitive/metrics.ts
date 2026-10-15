// Pure competitive comparison. Same rules as the client's own indicators: a rate exists only with numerator AND
// denominator; nothing is averaged; zero never stands in for missing data. A competitor is compared on a platform
// only when it was measured over exactly the same number of responses as the client there (same universe).
import { providerLabel } from '../ai-measurement/parse';
import type { PlatformRow } from '../ai-measurement/metrics';

export type CountField = 'mentionCount' | 'recommendationCount' | 'citationCount';
export type Metric = { provider: string; observationCount: number | null; mentionCount: number | null; recommendationCount: number | null; citationCount: number | null };
export type CompetitorInput = { id: string; name: string; domain: string | null; metrics: Metric[] };
export type Rate = { value: number; numerator: number; denominator: number; platforms: number };
export type Cell = { state: 'RATE'; rate: Rate } | { state: 'NO_COUNT'; count: number } | { state: 'NOT_MEASURED' } | { state: 'NOT_COMPARABLE'; reason: string };
export type Row = {
  id: string | null; name: string; isClient: boolean; domain: string | null;
  mention: Rate | null; recommendation: Rate | null; citation: Rate | null; share: Rate | null;
  /** Percentage points vs the client over the platforms both were measured on (competitors only). */
  diff: { mention: number | null; recommendation: number | null; citation: number | null; platforms: string[] } | null;
  measured: boolean; platformsMeasured: string[]; skipped: { provider: string; reason: string }[];
};
export type Opportunity = { id: string; title: string; description: string; competitor: string; platform: string; priority: 'ALTA' | 'MÉDIA'; evidence: string };

const FIELDS: CountField[] = ['mentionCount', 'recommendationCount', 'citationCount'];
const rate = (n: number | null | undefined, d: number | null | undefined, platforms = 1): Rate | null => n != null && d != null && d > 0 && n <= d ? { value: n / d, numerator: n, denominator: d, platforms } : null;
function sum(items: { n: number | null; d: number | null }[]): Rate | null {
  const ok = items.filter(i => i.n != null && i.d != null && i.d > 0 && i.n! <= i.d!); if (!ok.length) return null;
  const n = ok.reduce((s, i) => s + i.n!, 0), d = ok.reduce((s, i) => s + i.d!, 0); return { value: n / d, numerator: n, denominator: d, platforms: ok.length };
}
const pp = (a: Rate | null, b: Rate | null) => a && b ? Math.round((a.value - b.value) * 1000) / 10 : null;

export function comparableOn(client: PlatformRow, m: Metric): { ok: true } | { ok: false; reason: string } {
  if (client.observationCount == null) return { ok: false, reason: 'o cliente não informou o total de observações nesta plataforma' };
  if (m.observationCount == null) return { ok: false, reason: 'o concorrente não informou o total de observações' };
  if (m.observationCount !== client.observationCount) return { ok: false, reason: `universo diferente (${m.observationCount} × ${client.observationCount} respostas)` };
  return { ok: true };
}

export function buildComparison(input: { clientName: string; clientDomain: string | null; platforms: PlatformRow[]; competitors: CompetitorInput[]; provider?: string | null }) {
  const platforms = input.platforms.filter(p => !input.provider || p.provider === input.provider);
  const clientCounts = (p: PlatformRow, f: CountField) => ({ n: p[f], d: p.observationCount });
  const client: Row = { id: null, name: input.clientName, isClient: true, domain: input.clientDomain, mention: null, recommendation: null, citation: null, share: null, diff: null, measured: platforms.some(p => p.observationCount != null), platformsMeasured: platforms.filter(p => p.observationCount != null).map(p => p.provider), skipped: [] };
  client.mention = sum(platforms.map(p => clientCounts(p, 'mentionCount'))); client.recommendation = sum(platforms.map(p => clientCounts(p, 'recommendationCount'))); client.citation = sum(platforms.map(p => clientCounts(p, 'citationCount')));

  const rows: Row[] = []; const perPlatform = new Map<string, Map<string, Cell>>(); // competitorId|CLIENT → provider → count cells
  const comparableMetrics = new Map<string, Metric[]>();
  for (const c of input.competitors) {
    const usable: Metric[] = []; const skipped: Row['skipped'] = [];
    for (const m of c.metrics.filter(x => !input.provider || x.provider === input.provider)) {
      const cp = platforms.find(p => p.provider === m.provider);
      if (!cp) { skipped.push({ provider: m.provider, reason: 'o cliente não foi medido nesta plataforma' }); continue; }
      const v = comparableOn(cp, m); if (v.ok) usable.push(m); else skipped.push({ provider: m.provider, reason: v.reason });
    }
    comparableMetrics.set(c.id, usable);
    const row: Row = { id: c.id, name: c.name, isClient: false, domain: c.domain, mention: null, recommendation: null, citation: null, share: null, diff: null, measured: usable.length > 0, platformsMeasured: usable.map(m => m.provider), skipped };
    for (const [key, f] of [['mention', 'mentionCount'], ['recommendation', 'recommendationCount'], ['citation', 'citationCount']] as const) (row as any)[key] = sum(usable.map(m => ({ n: m[f], d: m.observationCount })));
    // Difference vs the client on exactly the same platforms the competitor was compared on.
    const same = platforms.filter(p => usable.some(m => m.provider === p.provider));
    const cl = (f: CountField) => sum(same.map(p => clientCounts(p, f)));
    row.diff = same.length ? { mention: pp(cl('mentionCount'), row.mention), recommendation: pp(cl('recommendationCount'), row.recommendation), citation: pp(cl('citationCount'), row.citation), platforms: same.map(p => p.provider) } : null;
    rows.push(row);
  }
  // Participation in the sample's recommendations: this company's recommendations ÷ all identified companies' on the same platforms.
  const sharePlatforms = platforms.filter(p => p.recommendationCount != null && p.observationCount != null);
  const recsOf = (id: string | null) => sharePlatforms.reduce((s, p) => s + (id === null ? p.recommendationCount! : (comparableMetrics.get(id)?.find(m => m.provider === p.provider)?.recommendationCount ?? 0)), 0);
  const total = recsOf(null) + rows.reduce((s, r) => s + recsOf(r.id), 0);
  const share = (id: string | null, measured: boolean) => measured && total > 0 ? { value: recsOf(id) / total, numerator: recsOf(id), denominator: total, platforms: sharePlatforms.length } : null;
  client.share = share(null, client.measured); for (const r of rows) r.share = share(r.id, r.measured && sharePlatforms.length > 0);

  // Competitors by recommendation coverage (comparable first); the client row stays first and fixed.
  rows.sort((a, b) => (b.recommendation?.value ?? -1) - (a.recommendation?.value ?? -1) || (b.mention?.value ?? -1) - (a.mention?.value ?? -1) || a.name.localeCompare(b.name, 'pt-BR'));
  const top = rows.find(r => r.recommendation && r.diff?.recommendation != null) || null;

  const matrix = { providers: platforms.map(p => p.provider), rows: [client, ...rows].map(r => ({ id: r.id, name: r.name, isClient: r.isClient, cells: Object.fromEntries(platforms.map(p => {
    const get = (f: CountField): Cell => {
      if (r.isClient) { const rt = rate(p[f], p.observationCount); return rt ? { state: 'RATE', rate: rt } : p[f] != null ? { state: 'NO_COUNT', count: p[f]! } : { state: 'NOT_MEASURED' }; }
      const m = input.competitors.find(c => c.id === r.id)!.metrics.find(x => x.provider === p.provider);
      if (!m) return { state: 'NOT_MEASURED' };
      const v = comparableOn(p, m); if (!v.ok) return { state: 'NOT_COMPARABLE', reason: v.reason };
      const rt = rate(m[f], m.observationCount); return rt ? { state: 'RATE', rate: rt } : m[f] != null ? { state: 'NO_COUNT', count: m[f]! } : { state: 'NOT_MEASURED' };
    };
    return [p.provider, { mention: get('mentionCount'), recommendation: get('recommendationCount'), citation: get('citationCount') }];
  })) })) };

  // Deterministic opportunities from aggregates only (no causes inferred).
  const opportunities: Opportunity[] = [];
  for (const c of rows) for (const m of comparableMetrics.get(c.id!) || []) {
    const p = platforms.find(x => x.provider === m.provider)!; const L = providerLabel(m.provider); const obs = p.observationCount!;
    const cr = rate(m.recommendationCount, obs), pr = rate(p.recommendationCount, obs);
    if (cr && pr && cr.value > pr.value) { const gap = (cr.value - pr.value) * 100; opportunities.push({ id: `rec-${c.id}-${m.provider}`, title: `${c.name} é mais recomendada em ${L}`, description: `${c.name} foi recomendada em ${m.recommendationCount} de ${obs} respostas em ${L}; ${input.clientName}, em ${p.recommendationCount} de ${obs}.`, competitor: c.name, platform: L, priority: gap >= 15 ? 'ALTA' : 'MÉDIA', evidence: `${L}: ${c.name} ${m.recommendationCount}/${obs} × ${input.clientName} ${p.recommendationCount}/${obs} recomendações (mesmas ${obs} respostas).` }); }
    const cm = rate(m.mentionCount, obs), pm = rate(p.mentionCount, obs);
    if (cm && pm && cm.value > pm.value && !(cr && pr && cr.value > pr.value)) opportunities.push({ id: `men-${c.id}-${m.provider}`, title: `${c.name} aparece mais que ${input.clientName} em ${L}`, description: `${c.name} foi mencionada em ${m.mentionCount} de ${obs} respostas em ${L}; ${input.clientName}, em ${p.mentionCount} de ${obs}.`, competitor: c.name, platform: L, priority: 'MÉDIA', evidence: `${L}: ${c.name} ${m.mentionCount}/${obs} × ${input.clientName} ${p.mentionCount}/${obs} menções.` });
    if ((m.citationCount ?? 0) > 0 && p.citationCount === 0) opportunities.push({ id: `cit-${c.id}-${m.provider}`, title: `O site de ${c.name} é citado em ${L}; o de ${input.clientName} não`, description: `O domínio de ${c.name} foi citado em ${m.citationCount} de ${obs} respostas em ${L}; o de ${input.clientName}, em nenhuma.`, competitor: c.name, platform: L, priority: 'MÉDIA', evidence: `${L}: citações ${c.name} ${m.citationCount}/${obs} × ${input.clientName} 0/${obs}.` });
    if (cr && cr.numerator > 0 && p.mentionCount != null && p.mentionCount > 0 && p.recommendationCount === 0) opportunities.push({ id: `mrec-${c.id}-${m.provider}`, title: `${input.clientName} é mencionada, mas não recomendada, em ${L}`, description: `${input.clientName} aparece em ${p.mentionCount} de ${obs} respostas em ${L}, sem recomendação, enquanto ${c.name} é recomendada em ${m.recommendationCount}.`, competitor: c.name, platform: L, priority: 'ALTA', evidence: `${L}: ${input.clientName} menções ${p.mentionCount}/${obs}, recomendações 0/${obs}; ${c.name} recomendações ${m.recommendationCount}/${obs}.` });
  }
  const unsound = rows.flatMap(r => r.skipped.map(s => ({ competitor: r.name, platform: providerLabel(s.provider), reason: s.reason })));
  return { client, competitors: rows, top, matrix, opportunities, notComparable: unsound, hasComparableData: rows.some(r => r.measured), provider: input.provider ?? null };
}
export type Comparison = ReturnType<typeof buildComparison>;
