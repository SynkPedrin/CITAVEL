// GSC Sync Service: initial backfill (up to 16 months, as far as the API returns), daily incremental sync with a
// revision window, idempotent writes (replace-by-window), request-level retry/backoff and a persisted job log.
import { db as prisma } from '../db';
import { HttpError } from '../security';
import { GscApiError, type ApiRow, type SearchType } from './api';
import { apiFor, type HubDeps } from './connection';
import { addDays, chunkRange, iso, subtractMonths } from './metrics';
import { redactQuery } from './redact';

export type JobType = 'GSC_INITIAL_SYNC' | 'GSC_DAILY_SYNC' | 'GSC_MANUAL_SYNC';
export const TOTAL_TYPES: SearchType[] = ['web', 'image', 'video', 'news'];
// Detail breakdowns are imported for web search only (the dominant type) to stay well inside quota.
export const DETAIL_DIMENSIONS = [
  { dimension: 'QUERY', api: 'query', chunk: 14 },
  { dimension: 'PAGE', api: 'page', chunk: 14 },
  { dimension: 'DEVICE', api: 'device', chunk: 92 },
  { dimension: 'COUNTRY', api: 'country', chunk: 92 },
] as const;
export const REVISION_DAYS = 10; // recent days are re-fetched every run because Google revises them
const STALE_MS = 2 * 3600_000;

export function jobWindow(type: JobType, today = iso(new Date())) {
  const end = addDays(today, -1);
  // 16 months is the Search Console retention limit; the API simply returns nothing before what exists.
  const start = type === 'GSC_DAILY_SYNC' ? addDays(end, -(REVISION_DAYS - 1)) : addDays(subtractMonths(end, 16), 1);
  return { start, end };
}

export async function enqueueSync(bindingId: string, type: JobType, trigger: string, actorId: string | null, d: HubDeps & { today?: string } = {}) {
  const db = d.db || prisma;
  const binding = await db.clientPropertyBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.status !== 'ACTIVE') throw new HttpError(404, 'Vínculo ativo não encontrado.', 'BINDING_NOT_FOUND');
  const { start, end } = jobWindow(type, d.today);
  // Scheduled runs are idempotent per day; manual/initial runs are unique per request but still serialized per binding.
  const idempotencyKey = type === 'GSC_DAILY_SYNC' ? `${bindingId}:DAILY:${end}` : `${bindingId}:${type}:${Date.now()}`;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'gsc-job-' + bindingId}))`;
    await tx.gscSyncJob.updateMany({ where: { bindingId, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'FAILED', errorCode: 'STALE', errorDetail: 'Execução interrompida (sem conclusão em 2h).', finishedAt: new Date() } });
    const active = await tx.gscSyncJob.findFirst({ where: { bindingId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (active) return { job: active, created: false };
    const same = await tx.gscSyncJob.findUnique({ where: { idempotencyKey } });
    if (same && ['SUCCESS', 'PARTIAL'].includes(same.status)) return { job: same, created: false };
    if (same) return { job: await tx.gscSyncJob.update({ where: { id: same.id }, data: { status: 'QUEUED', errorCode: null, errorDetail: null } }), created: true };
    const job = await tx.gscSyncJob.create({ data: { clientId: binding.clientId, bindingId, type, trigger, idempotencyKey, requestedStartDate: start, requestedEndDate: end, actorId } });
    return { job, created: true };
  });
}

type Merged = { date: string; key: string; clicks: number; impressions: number; position: number };
/** Collapses rows whose keys became identical after redaction, keeping impression-weighted position. */
export function mergeRows(rows: ApiRow[], keyIndex: number | null, redact: boolean): { rows: Merged[]; redacted: number } {
  const m = new Map<string, Merged & { w: number }>(); let redacted = 0;
  for (const r of rows) {
    const date = r.keys![0];
    let key = keyIndex == null ? '' : String(r.keys![keyIndex] ?? '');
    if (redact) { const x = redactQuery(key); if (x.redacted) redacted++; key = x.value; }
    const id = date + '\u0000' + key, old = m.get(id);
    if (old) { old.clicks += r.clicks; old.impressions += r.impressions; old.w += r.position * r.impressions; }
    else m.set(id, { date, key, clicks: r.clicks, impressions: r.impressions, position: r.position, w: r.position * r.impressions });
  }
  return { rows: [...m.values()].map(({ w, ...r }) => ({ ...r, position: r.impressions > 0 ? w / r.impressions : r.position })), redacted };
}

export async function runJob(jobId: string, d: HubDeps = {}) {
  const db = d.db || prisma;
  const job = await db.gscSyncJob.findUnique({ where: { id: jobId }, include: { binding: { include: { property: true, client: { select: { id: true, organizationId: true } } } } } });
  if (!job || job.status !== 'QUEUED') return job?.status || 'MISSING';
  // Atomic claim: only one runner (scheduler, manual button, n8n trigger) can move a job out of QUEUED.
  const claimed = await db.gscSyncJob.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count === 0) return 'ALREADY_CLAIMED';
  const { binding } = job; const site = binding.property.siteUrl, clientId = binding.clientId;
  // Tenant guard: the binding's client and the property must share the organization whose token is used.
  if (binding.client.organizationId !== binding.property.organizationId) {
    await db.gscSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'TENANT_MISMATCH', finishedAt: new Date() } });
    return 'FAILED';
  }
  let requests = 0, rowsImported = 0; const issues: { step: string; code: string; detail: string }[] = []; const details: any = { steps: [] };
  const api = apiFor(binding.property.organizationId, { ...d, onRequest: () => { requests++; } });
  const start = job.requestedStartDate, end = job.requestedEndDate;
  let availableStart: string | null = null, availableEnd: string | null = null;
  try {
    // 1) Authoritative daily totals per search type (dimension [date] = property totals incl. anonymized queries).
    for (const type of TOTAL_TYPES) {
      try {
        const res = await api.query(site, { startDate: start, endDate: end, dimensions: ['date'], type });
        const rows = res.rows.map(r => ({ clientId, siteUrl: site, searchType: type, date: r.keys![0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
        await db.$transaction([
          db.gscDailyMetric.deleteMany({ where: { clientId, siteUrl: site, searchType: type, date: { gte: start, lte: end } } }),
          db.gscDailyMetric.createMany({ data: rows }),
        ]);
        rowsImported += rows.length;
        if (type === 'web' && rows.length) { const dates = rows.map(r => r.date).sort(); availableStart = dates[0]; availableEnd = dates.at(-1)!; }
        details.steps.push({ step: `totals:${type}`, rows: rows.length });
      } catch (e) { if (type === 'web' || isFatal(e)) throw e; issues.push(issue(`totals:${type}`, e)); }
    }
    // 2) Detail breakdowns, chunked by window; each window is replaced atomically only after it was fully fetched.
    if (availableStart) {
      for (const dim of DETAIL_DIMENSIONS) {
        let n = 0, redacted = 0, truncated = false;
        try {
          for (const w of chunkRange(availableStart > start ? availableStart : start, end, dim.chunk)) {
            const res = await api.query(site, { startDate: w.start, endDate: w.end, dimensions: ['date', dim.api], type: 'web' });
            const merged = mergeRows(res.rows, 1, dim.dimension === 'QUERY' || dim.dimension === 'PAGE');
            redacted += merged.redacted; truncated ||= res.truncated;
            const data = merged.rows.map(r => ({ clientId, siteUrl: site, searchType: 'web', dimension: dim.dimension, date: r.date, key: r.key, clicks: r.clicks, impressions: r.impressions, ctr: r.impressions > 0 ? r.clicks / r.impressions : 0, position: r.position }));
            await db.$transaction([
              db.gscDimensionMetric.deleteMany({ where: { clientId, siteUrl: site, searchType: 'web', dimension: dim.dimension, date: { gte: w.start, lte: w.end } } }),
              db.gscDimensionMetric.createMany({ data }),
            ]);
            n += data.length;
          }
          rowsImported += n; details.steps.push({ step: `detail:${dim.dimension}`, rows: n, redacted, truncated });
        } catch (e) { if (isFatal(e)) throw e; issues.push(issue(`detail:${dim.dimension}`, e)); }
      }
      // 3) Sitemap inventory (submitted counts only; see indexing notes — this is not an index count).
      try { details.sitemaps = (await api.listSitemaps(site)).map(s => ({ path: s.path, lastSubmitted: s.lastSubmitted || null, lastDownloaded: s.lastDownloaded || null, isPending: !!s.isPending, isSitemapsIndex: !!s.isSitemapsIndex, warnings: Number(s.warnings) || 0, errors: Number(s.errors) || 0, contents: (s.contents || []).map((c: any) => ({ type: c.type, submitted: c.submitted == null ? null : Number(c.submitted) })) })); }
      catch (e) { if (isFatal(e)) throw e; issues.push(issue('sitemaps', e)); }
    } else details.note = 'NO_DATA_IN_RANGE';
    const status = issues.length ? 'PARTIAL' : 'SUCCESS', now = new Date();
    await db.gscSyncJob.update({ where: { id: job.id }, data: { status, finishedAt: now, lastSyncedAt: now, rowsImported, apiRequests: requests, availableStartDate: availableStart, availableEndDate: availableEnd, details: { ...details, issues }, errorCode: issues[0]?.code || null, errorDetail: issues.map(i => `${i.step}: ${i.detail}`).join(' | ').slice(0, 900) || null } });
    // Initial sync defines the known history start; daily sync only advances the end.
    const bData: any = { lastSuccessfulSyncAt: now };
    if (availableEnd) bData.availableEndDate = binding.availableEndDate && binding.availableEndDate > availableEnd ? binding.availableEndDate : availableEnd;
    if (availableStart && (job.type !== 'GSC_DAILY_SYNC' || !binding.availableStartDate)) bData.availableStartDate = availableStart;
    await db.clientPropertyBinding.update({ where: { id: binding.id }, data: bData });
    await db.systemEvent.create({ data: { clientId, actorId: job.actorId, source: 'GOOGLE_HUB', level: issues.length ? 'WARNING' : 'INFO', message: `${job.type}_${status}`, metadata: { job_id: job.id, site_url: site, rows: rowsImported, requests, available_start: availableStart, available_end: availableEnd } } });
    return status;
  } catch (e) {
    const x = issue('job', e);
    await db.gscSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), rowsImported, apiRequests: requests, errorCode: x.code, errorDetail: x.detail, details: { ...details, issues: [...issues, x] } } });
    if (x.code === 'PERMISSION_DENIED') await db.searchConsoleProperty.update({ where: { id: binding.propertyId }, data: { accessible: false } });
    await db.systemEvent.create({ data: { clientId, actorId: job.actorId, source: 'GOOGLE_HUB', level: 'ERROR', message: `${job.type}_FAILED`, metadata: { job_id: job.id, site_url: site, code: x.code } } });
    return 'FAILED';
  }
}
const isFatal = (e: unknown) => e instanceof GscApiError && ['AUTH_EXPIRED', 'AUTH_REQUIRED', 'PERMISSION_DENIED'].includes(e.code);
const issue = (step: string, e: unknown) => ({ step, code: e instanceof GscApiError ? e.code : 'UNEXPECTED', detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) });

/** Called by the n8n scheduler: queues the daily sync for every active binding of connected organizations. */
export async function enqueueDailyForAll(d: HubDeps & { today?: string; trigger?: string; organizationId?: string } = {}) {
  const db = d.db || prisma;
  const bindings = await db.clientPropertyBinding.findMany({ where: { status: 'ACTIVE', property: { accessible: true, connection: { status: 'CONNECTED' }, ...(d.organizationId ? { organizationId: d.organizationId } : {}) } }, select: { id: true } });
  const out: { bindingId: string; jobId: string; created: boolean; type: JobType }[] = [];
  for (const b of bindings) {
    // A binding whose history was never imported gets the full backfill instead of the 10-day window.
    const done = await db.gscSyncJob.count({ where: { bindingId: b.id, type: 'GSC_INITIAL_SYNC', status: { in: ['SUCCESS', 'PARTIAL'] } } });
    const type: JobType = done ? 'GSC_DAILY_SYNC' : 'GSC_INITIAL_SYNC';
    if (type === 'GSC_INITIAL_SYNC' && await db.gscSyncJob.count({ where: { bindingId: b.id, type, status: { in: ['QUEUED', 'RUNNING'] } } })) continue;
    const r = await enqueueSync(b.id, type, d.trigger || 'N8N', null, d);
    out.push({ bindingId: b.id, jobId: r.job.id, created: r.created, type });
  }
  return out;
}

/** Runs every QUEUED job, oldest first, one at a time (quota-friendly). Also recovers jobs left RUNNING by a crash/restart. */
export async function runPendingJobs(d: HubDeps & { organizationId?: string } = {}) {
  const db = d.db || prisma;
  const scope = d.organizationId ? { client: { organizationId: d.organizationId } } : {};
  const stale = await db.gscSyncJob.updateMany({ where: { ...scope, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'FAILED', errorCode: 'STALE', errorDetail: 'Execução interrompida (reinício do servidor ou travamento). Nova tentativa automática.', finishedAt: new Date() } });
  const results: { jobId: string; status: string }[] = [];
  for (let i = 0; i < 50; i++) {
    const next = await db.gscSyncJob.findFirst({ where: { ...scope, status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!next) break;
    results.push({ jobId: next.id, status: String(await runJob(next.id, d)) });
  }
  return { recoveredStale: stale.count, ran: results };
}
