// Opportunity detection from real Search Console rows. Heuristics are relative to the client's own data
// (no external CTR benchmarks) and every item carries the numbers that triggered it plus a caveat.
// A low CTR alone is never a problem: position, intent and volume are all required.
import { createHash } from 'node:crypto';
import type { Aggregate } from './metrics';
import type { Classification } from './classify';

export type Row = Aggregate & { key: string };
export type QueryRow = Row & { classification: Classification };
export type Opportunity = {
  id: string; kind: 'LOW_CTR_FOR_POSITION' | 'STRIKING_DISTANCE' | 'PAGE_CLICK_DROP' | 'GROWING_COMMERCIAL_QUERY';
  subject: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; confidence: number;
  title: string; description: string; evidence: Record<string, number | string | null>; caveat: string;
};
const id = (kind: string, subject: string) => 'gsc-' + createHash('sha256').update(kind + '|' + subject).digest('hex').slice(0, 20);
const pct = (n: number | null) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const bucket = (p: number) => p <= 3 ? '1-3' : p <= 6 ? '4-6' : p <= 10 ? '7-10' : null;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const INTENT: Classification['category'][] = ['SERVICE', 'COMMERCIAL', 'LOCATION'];

export function detectOpportunities(input: { queries: QueryRow[]; previousQueries: QueryRow[]; pages: Row[]; previousPages: Row[]; days: number }): Opportunity[] {
  const out: Opportunity[] = [];
  // Minimum volume scales with the period so a 7-day window is not judged like a 12-month one.
  const minImpr = Math.max(30, Math.round(input.days * 2));

  // 1. CTR well below the client's own median for the same position bucket (page 1 only, non-branded).
  const eligible = input.queries.filter(q => q.impressions >= minImpr && q.position != null && q.ctr != null && bucket(q.position!) && !q.classification.branded);
  const byBucket = new Map<string, number[]>();
  for (const q of eligible) { const b = bucket(q.position!)!; byBucket.set(b, [...(byBucket.get(b) || []), q.ctr!]); }
  for (const q of eligible) {
    const b = bucket(q.position!)!, sample = byBucket.get(b)!;
    if (sample.length < 5) continue;
    const ref = median(sample);
    if (ref > 0 && q.ctr! < ref * 0.5) out.push({
      id: id('LOW_CTR', q.key), kind: 'LOW_CTR_FOR_POSITION', subject: q.key,
      severity: INTENT.includes(q.classification.category) ? 'HIGH' : 'MEDIUM', confidence: Math.min(0.9, 0.4 + sample.length / 50),
      title: `CTR abaixo do padrão do próprio site para "${q.key}"`,
      description: `Posição média ${q.position!.toFixed(1)} com CTR ${pct(q.ctr)}, contra mediana de ${pct(ref)} das consultas do site na faixa ${b} (${sample.length} consultas comparáveis). Revisar título e descrição da página exibida.`,
      evidence: { impressions: q.impressions, clicks: q.clicks, ctr: q.ctr, position: q.position, bucket_median_ctr: ref, bucket_sample: sample.length, category: q.classification.category },
      caveat: 'CTR também varia com recursos da SERP (mapas, anúncios, respostas diretas) que o Search Console não informa.',
    });
  }
  // 2. Commercial/service intent sitting just below the top results.
  for (const q of input.queries) {
    if (q.impressions < minImpr || q.position == null || q.position < 8 || q.position > 20 || !INTENT.includes(q.classification.category)) continue;
    out.push({
      id: id('STRIKING', q.key), kind: 'STRIKING_DISTANCE', subject: q.key, severity: q.position <= 12 ? 'HIGH' : 'MEDIUM', confidence: 0.6,
      title: `"${q.key}" está perto do topo (posição ${q.position.toFixed(1)})`,
      description: `${q.impressions} impressões com intenção ${q.classification.category}. Melhorar a página que responde a esta busca pode aproximá-la das primeiras posições.`,
      evidence: { impressions: q.impressions, clicks: q.clicks, position: q.position, category: q.classification.category },
      caveat: 'Posição média agrega várias páginas e contextos; não garante ganho após otimização.',
    });
  }
  // 3. Pages losing clicks vs the previous equal-length period.
  const currentPages = new Map(input.pages.map(p => [p.key, p]));
  for (const prev of input.previousPages) {
    if (prev.clicks < 20) continue;
    const p = currentPages.get(prev.key) || { key: prev.key, clicks: 0, impressions: 0, ctr: null, position: null };
    const drop = (prev.clicks - p.clicks) / prev.clicks;
    if (drop < 0.3) continue;
    out.push({
      id: id('PAGE_DROP', p.key), kind: 'PAGE_CLICK_DROP', subject: p.key, severity: drop >= 0.5 ? 'HIGH' : 'MEDIUM', confidence: Math.min(0.85, 0.4 + prev.clicks / 200),
      title: `Queda de cliques na página ${p.key}`,
      description: `Cliques caíram de ${prev.clicks} para ${p.clicks} (${pct(-drop)}) em relação ao período anterior de mesma duração.`,
      evidence: { clicks: p.clicks, previous_clicks: prev.clicks, impressions: p.impressions, previous_impressions: prev.impressions, position: p.position, previous_position: prev.position },
      caveat: 'Pode refletir sazonalidade, mudança na demanda ou na SERP; a causa precisa ser investigada antes de agir.',
    });
  }
  // 4. Service/commercial queries growing in impressions.
  const prevQ = new Map(input.previousQueries.map(q => [q.key, q]));
  for (const q of input.queries) {
    const prev = prevQ.get(q.key);
    if (!prev || q.impressions < minImpr || prev.impressions < 10 || !INTENT.includes(q.classification.category)) continue;
    const growth = (q.impressions - prev.impressions) / prev.impressions;
    if (growth < 0.3) continue;
    out.push({
      id: id('GROWING', q.key), kind: 'GROWING_COMMERCIAL_QUERY', subject: q.key, severity: 'MEDIUM', confidence: 0.55,
      title: `Procura crescente por "${q.key}"`,
      description: `Impressões passaram de ${prev.impressions} para ${q.impressions} (+${(growth * 100).toFixed(0)}%). Vale garantir uma página forte para esta intenção.`,
      evidence: { impressions: q.impressions, previous_impressions: prev.impressions, clicks: q.clicks, position: q.position, category: q.classification.category },
      caveat: 'Impressões medem exibições do site nos resultados, não o volume total de pesquisas do mercado.',
    });
  }
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.confidence - a.confidence);
}
