// Indicators derived from an approved measurement. A rate exists only when numerator AND denominator were
// reported; it always carries both, so every number shown is traceable. Nothing is averaged across platforms:
// the overall rate is Σ numerators / Σ denominators over the platforms that reported both.
export type PlatformRow = { provider: string; label?: string; model?: string | null; collectionMethod?: string | null; promptCount: number | null; observationCount: number | null; mentionCount: number | null; recommendationCount: number | null; citationCount: number | null };
export type Rate = { value: number; numerator: number; denominator: number; platforms: number } | null;
export const RATE_FIELDS = { mention: 'mentionCount', recommendation: 'recommendationCount', citation: 'citationCount' } as const;

export function platformRate(p: PlatformRow, f: 'mentionCount' | 'recommendationCount' | 'citationCount'): Rate {
  const n = p[f], d = p.observationCount;
  return n != null && d != null && d > 0 && n <= d ? { value: n / d, numerator: n, denominator: d, platforms: 1 } : null;
}
export function overallRate(rows: PlatformRow[], f: 'mentionCount' | 'recommendationCount' | 'citationCount'): Rate {
  const usable = rows.map(r => platformRate(r, f)).filter(Boolean) as NonNullable<Rate>[];
  if (!usable.length) return null;
  const numerator = usable.reduce((s, r) => s + r.numerator, 0), denominator = usable.reduce((s, r) => s + r.denominator, 0);
  return { value: numerator / denominator, numerator, denominator, platforms: usable.length };
}
export function indicators(rows: PlatformRow[]) {
  return { mention: overallRate(rows, 'mentionCount'), recommendation: overallRate(rows, 'recommendationCount'), citation: overallRate(rows, 'citationCount'), observations: rows.some(r => r.observationCount != null) ? rows.reduce((s, r) => s + (r.observationCount || 0), 0) : null };
}

/** Quantitative comparison is only valid between methodologically compatible measurements. */
export function compatibility(a: { classification: string; methodology: string; methodologyVersion: string | null; platforms: PlatformRow[] }, b: typeof a) {
  const reasons: string[] = [];
  if (a.classification !== b.classification) reasons.push(`classificação diferente (${a.classification} × ${b.classification})`);
  if (a.methodology.trim().toLowerCase() !== b.methodology.trim().toLowerCase()) reasons.push('metodologia diferente');
  if ((a.methodologyVersion || '') !== (b.methodologyVersion || '')) reasons.push('versão da metodologia diferente');
  const pa = a.platforms.map(p => p.provider).sort().join(','), pb = b.platforms.map(p => p.provider).sort().join(',');
  if (pa !== pb) reasons.push('conjunto de plataformas diferente');
  for (const p of a.platforms) {
    const q = b.platforms.find(x => x.provider === p.provider); if (!q) continue;
    if ((p.model || '') !== (q.model || '')) reasons.push(`modelo diferente em ${p.label || p.provider}`);
    if (p.promptCount != null && q.promptCount != null && p.promptCount !== q.promptCount) reasons.push(`quantidade de prompts diferente em ${p.label || p.provider}`);
    if (p.observationCount !== q.observationCount) reasons.push(`universo de observações diferente em ${p.label || p.provider}`);
  }
  return { compatible: reasons.length === 0, reasons: [...new Set(reasons)] };
}
