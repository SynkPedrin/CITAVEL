import { HttpError } from './security';
// Small in-process fixed-window limiter for expensive or abuse-prone endpoints (single-instance Manager).
const buckets = new Map<string, { start: number; count: number }>();
export function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now(); const b = buckets.get(key);
  if (!b || now - b.start > windowMs) { buckets.set(key, { start: now, count: 1 }); if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k); return; }
  if (++b.count > limit) throw new HttpError(429, 'Muitas solicitações em sequência. Aguarde um minuto e tente novamente.', 'RATE_LIMITED');
}
