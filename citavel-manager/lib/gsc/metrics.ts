// Pure Search Console aggregation helpers. No CTR or average-position is ever summed:
// CTR = clicks / impressions, position = impression-weighted mean of the API's per-row average position.
export type MetricRow = { clicks: number; impressions: number; position: number };
export type Aggregate = { clicks: number; impressions: number; ctr: number | null; position: number | null };

export function aggregate(rows: MetricRow[]): Aggregate {
  let clicks = 0, impressions = 0, weighted = 0;
  for (const r of rows) {
    clicks += r.clicks; impressions += r.impressions;
    // Position only exists for rows with impressions; weight by impressions so busy days count more.
    if (r.impressions > 0 && Number.isFinite(r.position)) weighted += r.position * r.impressions;
  }
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position: impressions > 0 ? weighted / impressions : null };
}

/** Groups detail rows by key and aggregates each group (e.g. per-query totals across days of a period). */
export function aggregateBy<T extends MetricRow & { key: string }>(rows: T[]): (Aggregate & { key: string })[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) { const g = groups.get(r.key); if (g) g.push(r); else groups.set(r.key, [r]); }
  return [...groups].map(([key, list]) => ({ key, ...aggregate(list) }));
}

export type Delta = { current: number | null; previous: number | null; abs: number | null; pct: number | null };
export function delta(current: number | null, previous: number | null): Delta {
  if (current == null || previous == null) return { current, previous, abs: null, pct: null };
  return { current, previous, abs: current - previous, pct: previous !== 0 ? (current - previous) / previous : null };
}

// ---- Dates (UTC calendar days as YYYY-MM-DD; Search Console reports in Pacific time days, kept as returned) ----
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(day: string, n: number) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
export function daysBetween(start: string, end: string) { return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1; }
export function subtractMonths(day: string, months: number) { const d = new Date(day + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - months); return iso(d); }
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

export const PERIODS = { '7d': 7, '28d': 28, '3m': 91, '6m': 182, '12m': 365 } as const;
export type PeriodKey = keyof typeof PERIODS | 'custom';
export type Period = { key: PeriodKey; start: string; end: string; days: number; previous: { start: string; end: string } };

/**
 * Resolves a period ending on the latest day with data (as the Search Console UI does), never in the future.
 * The comparison period is the same number of days immediately before.
 */
export function resolvePeriod(key: string | undefined, latest: string, custom?: { from?: string; to?: string }): Period {
  let start: string, end: string, k: PeriodKey;
  if (key === 'custom' && isDay(custom?.from) && isDay(custom?.to) && custom!.from! <= custom!.to!) {
    k = 'custom'; start = custom!.from!; end = custom!.to! > latest ? latest : custom!.to!;
    if (start > end) start = end;
  } else {
    k = (key && key in PERIODS ? key : '28d') as PeriodKey;
    end = latest; start = addDays(latest, -(PERIODS[k as keyof typeof PERIODS] - 1));
  }
  const days = daysBetween(start, end);
  return { key: k, start, end, days, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

/** Splits [start,end] into consecutive windows of at most `size` days. */
export function chunkRange(start: string, end: string, size: number) {
  const out: { start: string; end: string }[] = [];
  for (let s = start; s <= end; s = addDays(s, size)) { const e = addDays(s, size - 1); out.push({ start: s, end: e > end ? end : e }); }
  return out;
}
