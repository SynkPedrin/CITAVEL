const PRIVATE_KEYS = new Set(['repo_path']);

export function stripPrivatePaths<T>(value: T): T {
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => stripPrivatePaths(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) continue;
    out[key] = stripPrivatePaths(entry);
  }
  return out as T;
}
