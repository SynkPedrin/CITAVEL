// DB-backed tests against the local Postgres, inside a throwaway organization that is deleted afterwards.
// Google endpoints are mocked here ONLY to test our own logic; nothing in this file runs in the product.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../lib/db';
import { saveConnection, accessToken, discoverProperties, bindProperty, unbindProperty, disconnect, clearTokenCache, createDraftClient } from '../lib/gsc/connection';
import { enqueueSync, runJob, enqueueDailyForAll, runPendingJobs } from '../lib/gsc/sync';
import { loadSearchData } from '../lib/gsc/insights';
import { createSnapshot } from '../lib/report/snapshot';
import { generateReport, pdfPathFor, snapshotFor } from '../lib/report/service';
import { decryptToken } from '../lib/gsc/oauth';
import type { Actor } from '../lib/security';

const tag = 'gsctest' + Date.now().toString(36);
let orgA: string, orgB: string, adminA: Actor, adminB: Actor, c1: string, c2: string, cB: string;
const SITE1 = 'https://dcs-test.example/', SITE2 = 'sc-domain:other-test.example', SITE_B = 'https://tenant-b.example/';
const TODAY = '2026-10-14';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

// Fake Google: history starts 2026-08-01 (less than 16 months), one query contains a phone number.
type Opts = { failQuery?: boolean; revoke?: boolean; quotaOnce?: boolean; bump?: number };
let G: Opts = {}; const calls: string[] = [];
function days(start: string, end: string) { const out: string[] = []; for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; }
const fakeFetch = (async (url: string, init: any = {}) => {
  calls.push(url);
  if (url.includes('oauth2.googleapis.com/token')) return G.revoke ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'fake-access', expires_in: 3600 });
  if (url.includes('oauth2.googleapis.com/revoke')) return json({});
  if (url.endsWith('/webmasters/v3/sites')) return json({ siteEntry: [{ siteUrl: SITE1, permissionLevel: 'siteOwner' }, { siteUrl: SITE2, permissionLevel: 'siteFullUser' }, { siteUrl: 'https://unverified.example/', permissionLevel: 'siteUnverifiedUser' }] });
  if (url.includes('/sitemaps')) return json({ sitemap: [{ path: SITE1 + 'sitemap.xml', lastDownloaded: '2026-10-10T00:00:00Z', warnings: '0', errors: '0', contents: [{ type: 'web', submitted: '42' }] }] });
  if (url.includes('/searchAnalytics/query')) {
    if (G.quotaOnce) { G.quotaOnce = false; return json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 429); }
    const b = JSON.parse(init.body); const dims: string[] = b.dimensions;
    if (G.failQuery && dims[1] === 'query') return json({ error: { message: 'backend error' } }, 400);
    if (b.startRow > 0) return json({ rows: [] });
    const site = decodeURIComponent(url.split('/sites/')[1].split('/')[0]);
    const scale = site === SITE1 ? 1 : 3; const bump = G.bump || 0;
    const ds = days(b.startDate > '2026-08-01' ? b.startDate : '2026-08-01', b.endDate > '2026-10-12' ? '2026-10-12' : b.endDate);
    if (b.type !== 'web') return json({ rows: b.type === 'image' ? ds.map(d => ({ keys: [d], clicks: 0, impressions: 2, ctr: 0, position: 9 })) : [] });
    const rows: any[] = [];
    for (const d of ds) {
      if (dims.length === 1) rows.push({ keys: [d], clicks: 10 * scale + bump, impressions: 200 * scale, ctr: (10 * scale + bump) / (200 * scale), position: 6 });
      else if (dims[1] === 'query') rows.push({ keys: [d, 'dcs exames'], clicks: 4, impressions: 40, ctr: 0.1, position: 1.5 }, { keys: [d, 'ressonancia magnetica preço'], clicks: 2, impressions: 80, ctr: 0.025, position: 9 }, { keys: [d, 'ligar 11 98765-4321'], clicks: 1, impressions: 5, ctr: 0.2, position: 3 });
      else if (dims[1] === 'page') rows.push({ keys: [d, SITE1], clicks: 6, impressions: 100, ctr: 0.06, position: 4 });
      else if (dims[1] === 'device') rows.push({ keys: [d, 'MOBILE'], clicks: 7, impressions: 150, ctr: 0.047, position: 6 });
      else rows.push({ keys: [d, 'bra'], clicks: 10, impressions: 200, ctr: 0.05, position: 6 });
    }
    return json({ rows, responseAggregationType: 'byProperty' });
  }
  return json({ error: 'unexpected ' + url }, 500);
}) as any;
// Tests MUST scope global operations to the throwaway organization (orgA) — never touch real clients.
const deps = { fetch: fakeFetch, sleep: async () => {} };

before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.REPORT_STORAGE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'citavel-reports-'));
  const a = await db.organization.create({ data: { name: 'Test A', slug: tag + '-a' } }); orgA = a.id;
  const b = await db.organization.create({ data: { name: 'Test B', slug: tag + '-b' } }); orgB = b.id;
  const ua = await db.user.create({ data: { name: 'Admin A', email: tag + 'a@test.invalid', passwordHash: 'x', memberships: { create: { organizationId: orgA, role: 'ADMIN' } } } });
  const ub = await db.user.create({ data: { name: 'Admin B', email: tag + 'b@test.invalid', passwordHash: 'x', memberships: { create: { organizationId: orgB, role: 'ADMIN' } } } });
  adminA = { id: ua.id, name: 'A', email: ua.email, role: 'ADMIN', organizationId: orgA, clientIds: [], forcePasswordChange: false };
  adminB = { ...adminA, id: ub.id, email: ub.email, organizationId: orgB };
  const mk = async (org: string, k: string, name: string, domain: string) => (await db.client.create({ data: { organizationId: org, clientKey: `${tag}-${k}`, engineClientId: `${tag}-${k}`, name, brandName: name, domain } })).id;
  c1 = await mk(orgA, 'dcs', 'DCS Diagnósticos por Imagem', 'https://dcs.example/'); c2 = await mk(orgA, 'other', 'Outra Empresa', 'https://other-test.example/'); cB = await mk(orgB, 'b', 'Tenant B', SITE_B);
});
after(async () => {
  await db.systemEvent.deleteMany({ where: { OR: [{ client: { organizationId: { in: [orgA, orgB] } } }, { actorId: { in: [adminA.id, adminB.id] } }, { metadata: { path: ['organization_id'], equals: orgA } }, { metadata: { path: ['organization_id'], equals: orgB } }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await fs.rm(process.env.REPORT_STORAGE_DIR!, { recursive: true, force: true });
  await db.$disconnect();
});

test('connection: refresh token stored encrypted, access token refreshed server-side, properties discovered', async () => {
  await saveConnection(orgA, adminA.id, { refreshToken: '1//secret-refresh', scopes: ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly'], email: 'ops@agency.test', subject: 'sub-1' }, deps);
  const row = await db.googleConnection.findUniqueOrThrow({ where: { organizationId: orgA } });
  assert.ok(row.refreshTokenEnc && !row.refreshTokenEnc.includes('secret-refresh')); assert.equal(decryptToken(row.refreshTokenEnc!), '1//secret-refresh');
  assert.equal(await accessToken(orgA, deps), 'fake-access');
  assert.equal(await discoverProperties(orgA, deps), 3);
  const props = await db.searchConsoleProperty.findMany({ where: { organizationId: orgA }, orderBy: { siteUrl: 'asc' } });
  assert.deepEqual(props.map(p => [p.siteUrl, p.propertyType, p.accessible]), [['https://dcs-test.example/', 'URL_PREFIX', true], ['https://unverified.example/', 'URL_PREFIX', false], ['sc-domain:other-test.example', 'DOMAIN', true]]);
  assert.equal(await db.clientPropertyBinding.count({ where: { property: { organizationId: orgA } } }), 0); // nothing auto-imported
});

test('binding: explicit per tenant; cross-organization, double binding and unverified properties are refused', async () => {
  const p1 = await db.searchConsoleProperty.findFirstOrThrow({ where: { organizationId: orgA, siteUrl: SITE1 } });
  const p2 = await db.searchConsoleProperty.findFirstOrThrow({ where: { organizationId: orgA, siteUrl: SITE2 } });
  const pu = await db.searchConsoleProperty.findFirstOrThrow({ where: { organizationId: orgA, accessible: false } });
  await assert.rejects(bindProperty(adminB, p1.id, cB), (e: any) => e.code === 'PROPERTY_NOT_FOUND'); // other org cannot even see it
  await assert.rejects(bindProperty(adminA, p1.id, cB), (e: any) => e.code === 'TENANT_FORBIDDEN'); // client of another org
  await assert.rejects(bindProperty(adminA, pu.id, c1), (e: any) => e.code === 'PROPERTY_NOT_ACCESSIBLE');
  const b1 = await bindProperty(adminA, p1.id, c1); assert.equal(b1.isPrimary, true);
  await assert.rejects(bindProperty(adminA, p1.id, c2), (e: any) => e.code === 'PROPERTY_ALREADY_BOUND');
  assert.equal((await bindProperty(adminA, p1.id, c1)).id, b1.id); // idempotent
  await bindProperty(adminA, p2.id, c2);
});

test('initial backfill imports available history only, with pagination-safe idempotent writes and redaction', async () => {
  const b1 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c1 } });
  const q = await enqueueSync(b1.id, 'GSC_INITIAL_SYNC', 'TEST', adminA.id, { today: TODAY });
  assert.equal(q.created, true); assert.equal(q.job.requestedStartDate, '2025-06-14');
  const again = await enqueueSync(b1.id, 'GSC_MANUAL_SYNC', 'TEST', adminA.id, { today: TODAY }); assert.equal(again.created, false); // serialized per binding
  assert.equal(await runJob(q.job.id, deps), 'SUCCESS');
  const job = await db.gscSyncJob.findUniqueOrThrow({ where: { id: q.job.id } });
  assert.equal(job.availableStartDate, '2026-08-01'); assert.equal(job.availableEndDate, '2026-10-12'); // not assumed 16 months
  const n = await db.gscDailyMetric.count({ where: { clientId: c1, searchType: 'web' } }); assert.equal(n, 73);
  assert.equal(await db.gscDimensionMetric.count({ where: { clientId: c1, key: { contains: '98765' } } }), 0);
  assert.ok(await db.gscDimensionMetric.count({ where: { clientId: c1, key: 'ligar [telefone]' } }) > 0);
  // Re-running the same window must not duplicate rows.
  const q2 = await enqueueSync(b1.id, 'GSC_MANUAL_SYNC', 'TEST', adminA.id, { today: TODAY }); await runJob(q2.job.id, deps);
  assert.equal(await db.gscDailyMetric.count({ where: { clientId: c1, searchType: 'web' } }), 73);
  assert.equal(await db.gscDimensionMetric.count({ where: { clientId: c1, dimension: 'QUERY' } }), 73 * 3);
  const binding = await db.clientPropertyBinding.findUniqueOrThrow({ where: { id: b1.id } }); assert.equal(binding.availableStartDate, '2026-08-01');
});

test('daily sync: idempotent per day, retries quota errors, and overwrites revised recent days', async () => {
  const b1 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c1 } });
  G = { quotaOnce: true, bump: 5 };
  const first = await enqueueDailyForAll({ ...deps, organizationId: orgA, today: TODAY });
  const mine = first.find(x => x.bindingId === b1.id)!; assert.equal(mine.created, true);
  assert.equal(await runJob(mine.jobId, deps), 'SUCCESS');
  const second = await enqueueDailyForAll({ ...deps, organizationId: orgA, today: TODAY }); assert.equal(second.find(x => x.bindingId === b1.id)!.created, false); // same day → no new job
  const revised = await db.gscDailyMetric.findFirstOrThrow({ where: { clientId: c1, siteUrl: SITE1, searchType: 'web', date: '2026-10-12' } });
  const old = await db.gscDailyMetric.findFirstOrThrow({ where: { clientId: c1, siteUrl: SITE1, searchType: 'web', date: '2026-09-01' } });
  assert.equal(revised.clicks, 15); assert.equal(old.clicks, 10); // only the revision window changed
  G = {};
});

test('partial failure keeps totals and reports PARTIAL with error detail', async () => {
  const b2 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c2 } });
  G = { failQuery: true };
  const q = await enqueueSync(b2.id, 'GSC_INITIAL_SYNC', 'TEST', adminA.id, { today: TODAY });
  assert.equal(await runJob(q.job.id, deps), 'PARTIAL');
  const job = await db.gscSyncJob.findUniqueOrThrow({ where: { id: q.job.id } }); assert.match(job.errorDetail || '', /detail:QUERY/);
  assert.ok(await db.gscDailyMetric.count({ where: { clientId: c2 } }) > 0);
  G = {};
});

test('automatic runner: stuck QUEUED jobs are executed, a job never runs twice, never-imported bindings get the full backfill', async () => {
  const b1 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c1 } });
  // Simulates a job left QUEUED by a server restart (e.g. queued by n8n right before a deploy).
  const stuck = await db.gscSyncJob.create({ data: { clientId: c1, bindingId: b1.id, type: 'GSC_DAILY_SYNC', status: 'QUEUED', idempotencyKey: `${b1.id}:STUCK:${Date.now()}`, trigger: 'N8N', requestedStartDate: '2026-10-04', requestedEndDate: '2026-10-13', createdAt: new Date(Date.now() - 3_600_000) } });
  const [a, b] = await Promise.all([runJob(stuck.id, deps), runJob(stuck.id, deps)]);
  assert.deepEqual([a, b].sort(), ['ALREADY_CLAIMED', 'SUCCESS']);
  const stuck2 = await db.gscSyncJob.create({ data: { clientId: c1, bindingId: b1.id, type: 'GSC_MANUAL_SYNC', status: 'QUEUED', idempotencyKey: `${b1.id}:STUCK2:${Date.now()}`, trigger: 'N8N', requestedStartDate: '2026-10-04', requestedEndDate: '2026-10-13' } });
  const run = await runPendingJobs({ ...deps, organizationId: orgA });
  assert.ok(run.ran.some(r => r.jobId === stuck2.id && r.status === 'SUCCESS'));
  assert.equal(await db.gscSyncJob.count({ where: { clientId: { in: [c1, c2] }, status: 'QUEUED' } }), 0);
  // A binding without a completed initial import is scheduled for the full backfill, not the 10-day window.
  const p3 = await db.searchConsoleProperty.create({ data: { organizationId: orgA, connectionId: (await db.googleConnection.findUniqueOrThrow({ where: { organizationId: orgA } })).id, siteUrl: 'https://never-imported.example/', propertyType: 'URL_PREFIX', permissionLevel: 'siteOwner' } });
  const c3 = (await db.client.create({ data: { organizationId: orgA, clientKey: tag + '-c3', engineClientId: tag + '-c3', name: 'C3', brandName: 'C3', domain: 'https://never-imported.example/' } })).id;
  const b3 = await bindProperty(adminA, p3.id, c3);
  const q = await enqueueDailyForAll({ ...deps, organizationId: orgA, today: TODAY, trigger: 'SCHEDULER' });
  assert.equal(q.find(x => x.bindingId === b3.id)!.type, 'GSC_INITIAL_SYNC');
  assert.equal(q.find(x => x.bindingId === b1.id)!.type, 'GSC_DAILY_SYNC');
  await db.client.delete({ where: { id: c3 } }); await db.searchConsoleProperty.delete({ where: { id: p3.id } });
});

test('tenant isolation: each client only reads its own property data', async () => {
  const d1 = await loadSearchData(c1, { period: '28d' }); const d2 = await loadSearchData(c2, { period: '28d' });
  assert.equal(d1.state, 'READY'); assert.equal(d2.state, 'READY');
  if (d1.state !== 'READY' || d2.state !== 'READY') return;
  assert.equal(d1.binding.property.siteUrl, SITE1); assert.equal(d2.binding.property.siteUrl, SITE2);
  assert.notEqual(d1.totals.clicks, d2.totals.clicks); // SITE2 fake data is 3x
  // c1 cannot address c2's property even by passing its id.
  const p2 = await db.searchConsoleProperty.findFirstOrThrow({ where: { siteUrl: SITE2, organizationId: orgA } });
  const forced = await loadSearchData(c1, { propertyId: p2.id }); assert.equal(forced.state === 'READY' && forced.binding.property.siteUrl, SITE1);
  assert.equal((await loadSearchData(cB)).state, 'NOT_BOUND');
  // Weighted metrics + classification
  assert.equal(d1.period.end, '2026-10-12'); assert.ok(d1.totals.ctr! > 0 && d1.totals.ctr! < 1);
  assert.ok(d1.branded.clicks > 0); assert.ok(d1.hiddenQueryShare.clicks! > 0); // query table < totals (anonymized share shown)
});

test('report snapshot is immutable source; PDF goes to private storage; other tenants and clients are denied', async () => {
  const snap = await createSnapshot(c1, adminA.id, { reportType: 'COMPLETO', language: 'pt-BR', sections: ['summary', 'google', 'methodology'], period: '28d' });
  const content = snap.content as any;
  assert.equal(content.gsc_metrics.status, 'AVAILABLE'); assert.equal(content.ai_visibility.GOLDEN.status, 'UNAVAILABLE');
  assert.equal(content.gsc_metrics.indexing.indexed_pages, 'UNAVAILABLE_FROM_API');
  assert.ok(content.narrative.some((s: string) => s.includes(content.gsc_metrics.totals.clicks.toLocaleString('pt-BR'))));
  const r = await generateReport(c1, adminA, { reportType: 'EXECUTIVO', language: 'pt-BR', sections: ['summary', 'google'], period: '28d' }, async () => Buffer.from('%PDF-1.7 test'));
  assert.equal(r.pdfStatus, 'READY');
  const st = await fs.stat(pdfPathFor(c1, r.snapshotId)); assert.equal(st.mode & 0o777, 0o600);
  assert.ok(pdfPathFor(c1, r.snapshotId).startsWith(process.env.REPORT_STORAGE_DIR!));
  const viewer: Actor = { ...adminA, id: 'v', role: 'CLIENT_VIEWER', clientIds: [c2] };
  await assert.rejects(snapshotFor(viewer, c1, r.snapshotId), (e: any) => e.code === 'TENANT_FORBIDDEN');
  await assert.rejects(snapshotFor(adminB, c1, r.snapshotId), (e: any) => e.code === 'TENANT_FORBIDDEN');
  await assert.rejects(snapshotFor(adminA, c2, r.snapshotId), (e: any) => e.code === 'NOT_FOUND'); // wrong client in URL
  assert.ok(await snapshotFor({ ...viewer, clientIds: [c1] }, c1, r.snapshotId));
});

test('revoked authorization → AUTH_EXPIRED, sync stops, data kept; disconnect clears token', async () => {
  clearTokenCache(); G = { revoke: true };
  const b1 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c1 } });
  const q = await enqueueSync(b1.id, 'GSC_MANUAL_SYNC', 'TEST', adminA.id, { today: TODAY });
  assert.equal(await runJob(q.job.id, deps), 'FAILED');
  assert.equal((await db.gscSyncJob.findUniqueOrThrow({ where: { id: q.job.id } })).errorCode, 'AUTH_EXPIRED');
  assert.equal((await db.googleConnection.findUniqueOrThrow({ where: { organizationId: orgA } })).status, 'AUTH_EXPIRED');
  assert.ok(await db.gscDailyMetric.count({ where: { clientId: c1 } }) > 0);
  assert.equal((await enqueueDailyForAll({ ...deps, organizationId: orgA, today: '2026-10-15' })).filter(x => x.bindingId === b1.id).length, 0); // not scheduled while expired
  G = {};
  const r = await disconnect(orgA, adminA.id, deps); assert.equal(r.revoked, true);
  assert.equal((await db.googleConnection.findUniqueOrThrow({ where: { organizationId: orgA } })).refreshTokenEnc, null);
});

test('unbind with purge removes only that client/property data; draft clients are not active', async () => {
  const b2 = await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c2 } });
  await unbindProperty(adminA, b2.id, true);
  assert.equal(await db.gscDailyMetric.count({ where: { clientId: c2 } }), 0); assert.ok(await db.gscDailyMetric.count({ where: { clientId: c1 } }) > 0);
  await assert.rejects(unbindProperty(adminB, (await db.clientPropertyBinding.findFirstOrThrow({ where: { clientId: c1 } })).id, false), (e: any) => e.code === 'BINDING_NOT_FOUND');
  const draft = await createDraftClient(adminA, { name: 'Clínica Nova', domain: 'https://nova.example' });
  assert.equal(draft.status, 'DRAFT'); assert.equal(draft.organizationId, orgA);
});
