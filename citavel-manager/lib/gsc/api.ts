// Thin client for the official Search Console API (webmasters v3). Fetch and sleep are injectable for tests.
export const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';
export const ROW_LIMIT = 25_000; // API maximum per request
export type SearchType = 'web' | 'image' | 'video' | 'news';
export type ApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type SiteEntry = { siteUrl: string; permissionLevel: string };

export class GscApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}
export type Deps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; onRequest?: () => void };

export function propertyType(siteUrl: string) { return siteUrl.startsWith('sc-domain:') ? 'DOMAIN' : 'URL_PREFIX'; }
/** siteUnverifiedUser has no data access in Search Console. */
export function hasDataAccess(permissionLevel: string) { return ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(permissionLevel); }

export class GscApi {
  private f: typeof fetch; private sleep: (ms: number) => Promise<void>; private max: number;
  constructor(private token: () => Promise<string>, private deps: Deps = {}) {
    this.f = deps.fetch || fetch; this.sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms))); this.max = deps.maxAttempts || 5;
  }
  private async request(url: string, body?: unknown): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      this.deps.onRequest?.();
      let res: Response;
      try {
        res = await this.f(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(60_000), cache: 'no-store' } as RequestInit);
      } catch (error) {
        if (error instanceof GscApiError) throw error; // token refresh failures are final
        if (attempt >= this.max) throw new GscApiError(0, 'NETWORK', 'Falha de rede ao consultar o Search Console.', true);
        await this.sleep(backoff(attempt)); continue;
      }
      if (res.ok) return res.json();
      let reason = '', message = '';
      try { const j: any = await res.json(); reason = j?.error?.errors?.[0]?.reason || j?.error?.status || ''; message = j?.error?.message || ''; } catch { /* non-JSON */ }
      const quota = res.status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/i.test(reason);
      const retryable = quota || res.status >= 500;
      if (retryable && attempt < this.max) { await this.sleep(retryAfter(res) ?? backoff(attempt)); continue; }
      if (res.status === 401) throw new GscApiError(401, 'AUTH_EXPIRED', 'A autorização Google expirou ou foi revogada.');
      if (quota) throw new GscApiError(res.status, 'QUOTA_EXCEEDED', 'Cota do Search Console excedida; nova tentativa no próximo ciclo.', true);
      if (res.status === 403) throw new GscApiError(403, 'PERMISSION_DENIED', 'A conta conectada não tem acesso a esta propriedade.');
      throw new GscApiError(res.status, `HTTP_${res.status}`, (message || `Search Console retornou HTTP ${res.status}.`).slice(0, 300), retryable);
    }
  }
  async listSites(): Promise<SiteEntry[]> { return ((await this.request(`${GSC_BASE}/sites`)).siteEntry || []) as SiteEntry[]; }
  async listSitemaps(siteUrl: string): Promise<any[]> { return (await this.request(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`)).sitemap || []; }
  /** Runs a Search Analytics query and follows startRow pagination until a short page is returned. */
  async query(siteUrl: string, q: { startDate: string; endDate: string; dimensions: string[]; type: SearchType; maxRows?: number }): Promise<{ rows: ApiRow[]; truncated: boolean; aggregationType?: string }> {
    const rows: ApiRow[] = []; let aggregationType: string | undefined; const cap = q.maxRows ?? 500_000;
    for (let startRow = 0; ; startRow += ROW_LIMIT) {
      const data = await this.request(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { startDate: q.startDate, endDate: q.endDate, dimensions: q.dimensions, type: q.type, dataState: 'final', rowLimit: ROW_LIMIT, startRow });
      aggregationType = data.responseAggregationType || aggregationType;
      const page: ApiRow[] = data.rows || [];
      rows.push(...page);
      if (page.length < ROW_LIMIT) return { rows, truncated: false, aggregationType };
      if (rows.length >= cap) return { rows, truncated: true, aggregationType };
    }
  }
}
const backoff = (attempt: number) => Math.min(60_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
function retryAfter(res: Response) { const v = Number(res.headers.get('retry-after')); return Number.isFinite(v) && v > 0 ? Math.min(v * 1000, 120_000) : null; }
