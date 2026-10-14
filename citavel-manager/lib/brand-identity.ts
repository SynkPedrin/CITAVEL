const BRAND_IDENTITY_KEYS = [
  'status', 'brand_name', 'official_domain', 'alternate_names', 'tagline', 'description',
  'logos', 'favicon', 'palette', 'fonts', 'social_profiles', 'contact',
  'products_services', 'claims', 'cta', 'collected_at', 'sources',
] as const;

export function sanitizeBrandIdentity(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of BRAND_IDENTITY_KEYS) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return Object.keys(out).length ? out : null;
}
