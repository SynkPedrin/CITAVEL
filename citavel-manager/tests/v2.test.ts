import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getReportPdf, resolveClientPdfPath } from '../lib/report-pdf';
import { decideIdentity } from '../lib/identity';
import { slugifyClientKey, startCleanroom } from '../lib/cleanroom';
import { sanitizeBrandIdentity } from '../lib/brand-identity';
import { HttpError, type Actor } from '../lib/security';

const operator: Actor = { id: 'u1', name: 'Ana', email: 'ana@example.test', role: 'ANALYST', organizationId: 'org-a', clientIds: [], forcePasswordChange: false };
const admin: Actor = { ...operator, role: 'ADMIN' };
const client = { id: 'c1', organizationId: 'org-a', engineClientId: 'cosentino', clientKey: 'cosentino' };

function reportFor(filePath: string | null) {
  return { id: 'r1', clientId: 'c1', externalId: 'snap-1', filePath, periodStart: new Date('2026-10-01T00:00:00Z'), client };
}
const pdfDb = (report: any) => ({ report: { findUnique: async () => report } });

test('pdf route guards: unauthenticated, cross-tenant and missing report', async () => {
  await assert.rejects(() => getReportPdf({ actor: null, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('reports/private/a.pdf')), engineRoot: '/tmp' }), (e: any) => e.status === 401);
  await assert.rejects(() => getReportPdf({ actor: { ...admin, organizationId: 'org-b' }, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('reports/private/a.pdf')), engineRoot: '/tmp' }), (e: any) => e.status === 403 && e.code === 'TENANT_FORBIDDEN');
  await assert.rejects(() => getReportPdf({ actor: admin, clientId: 'c1', reportId: 'r1', db: pdfDb(null), engineRoot: '/tmp' }), (e: any) => e.status === 404 && e.code === 'NOT_FOUND');
});

test('pdf route is honest when the pdf is absent or not a pdf', async () => {
  await assert.rejects(() => getReportPdf({ actor: admin, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor(null)), engineRoot: '/tmp' }), (e: any) => e.status === 404 && e.code === 'PDF_UNAVAILABLE');
  await assert.rejects(() => getReportPdf({ actor: admin, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('clients/cosentino/reports/2026-W40.html')), engineRoot: '/tmp' }), (e: any) => e.code === 'PDF_UNAVAILABLE');
  await assert.rejects(() => getReportPdf({ actor: admin, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('reports/private/missing.pdf')), engineRoot: os.tmpdir() }), (e: any) => e.code === 'PDF_UNAVAILABLE');
});

test('pdf path resolution rejects traversal and absolute paths', async () => {
  assert.equal(resolveClientPdfPath('/engine', 'cosentino', 'reports/private/a.pdf'), path.resolve('/engine', 'clients/cosentino/reports/private/a.pdf'));
  assert.equal(resolveClientPdfPath('/engine', 'cosentino', '../../etc/passwd.pdf'), null);
  assert.equal(resolveClientPdfPath('/engine', 'cosentino', '/etc/passwd.pdf'), null);
  assert.equal(resolveClientPdfPath('/engine', 'cosentino', '..'), null);
  await assert.rejects(() => getReportPdf({ actor: admin, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('../outside.pdf')), engineRoot: os.tmpdir() }), (e: any) => e.code === 'PDF_UNAVAILABLE');
});

test('pdf route streams a real file from inside the client directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'citavel-pdf-'));
  try {
    const file = path.join(root, 'clients', 'cosentino', 'reports', 'private', 'orvyn-d0.pdf');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '%PDF-1.4 fixture');
    const viewer: Actor = { ...operator, role: 'CLIENT_VIEWER', clientIds: ['c1'] };
    const result = await getReportPdf({ actor: viewer, clientId: 'c1', reportId: 'r1', db: pdfDb(reportFor('reports/private/orvyn-d0.pdf')), engineRoot: root });
    assert.equal(result.data.toString('utf8').startsWith('%PDF'), true);
    assert.equal(result.filename, 'citavel-cosentino-2026-10-01.pdf');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('identity confirm guards and engine payload', async () => {
  const identityDb = (events: any[]) => ({ client: { findUnique: async () => client }, systemEvent: { create: async (args: any) => { events.push(args); return {}; } } });
  await assert.rejects(() => decideIdentity({ actor: null, clientId: 'c1', db: identityDb([]), enginePost: async () => ({}), decision: 'confirm' }), (e: any) => e.status === 401);
  const events: any[] = [];
  const calls: any[] = [];
  const enginePost = async (path: string, body: any) => { calls.push([path, body]); return { brand_identity: { status: 'VERIFIED_BRAND_IDENTITY' } }; };
  const result = await decideIdentity({ actor: operator, clientId: 'c1', db: identityDb(events), enginePost, decision: 'confirm', corrections: { tagline: 'Nova tagline' } });
  assert.equal(result.status, 'VERIFIED_BRAND_IDENTITY');
  assert.equal(calls[0][0], '/v1/discover/cosentino/confirm');
  assert.deepEqual(calls[0][1], { actor: operator.email, decision: 'confirm', corrections: { tagline: 'Nova tagline' } });
  assert.equal(events[0].data.message, 'Identidade da marca confirmada');
  const rejected = await decideIdentity({ actor: operator, clientId: 'c1', db: identityDb(events), enginePost, decision: 'reject' });
  assert.equal(events.some(e => e.data.message === 'Identidade da marca rejeitada'), true);
  assert.equal('corrections' in calls[1][1], false);
  assert.ok(rejected);
});

test('cleanroom maps DOMAIN_REQUIRED to 422 and keeps the engine note', async () => {
  const cleanroomDb = { client: { findUnique: async () => null } };
  const enginePost = async () => ({ status: 'DOMAIN_REQUIRED', note: 'Informe o domínio oficial do site.' });
  await assert.rejects(
    () => startCleanroom({ actor: admin, db: cleanroomDb, enginePost, input: { brandName: 'Acme' }, provision: async () => ({ id: 'x' }) }),
    (e: any) => e.status === 422 && e.code === 'DOMAIN_REQUIRED' && /domínio oficial/.test(e.message),
  );
});

test('cleanroom success calls the engine with the derived client and provisions with the same id', async () => {
  const cleanroomDb = { client: { findUnique: async (args: any) => args.where.clientKey === 'acme-inc' ? { id: 'existing' } : null } };
  const calls: any[] = [];
  const enginePost = async (path: string, body: any) => { calls.push([path, body]); return { status: 'OK' }; };
  const provisions: any[] = [];
  const result = await startCleanroom({ actor: admin, db: cleanroomDb, enginePost, input: { brandName: 'Acme Inc!', officialDomain: 'https://acme.com' }, provision: async input => { provisions.push(input); return { id: 'new-client' }; } });
  assert.equal(calls[0][0], '/v1/cleanroom');
  assert.deepEqual(calls[0][1], { client_id: 'acme-inc-cleanroom-v1', brand_name: 'Acme Inc!', official_domain: 'https://acme.com' });
  assert.equal(provisions[0].clientKey, 'acme-inc-cleanroom-v1');
  assert.equal(result.clientKey, 'acme-inc-cleanroom-v1');
  await assert.rejects(() => startCleanroom({ actor: operator, db: cleanroomDb, enginePost, input: { brandName: 'Acme' }, provision: async () => ({ id: 'x' }) }), (e: any) => e.status === 403);
});

test('client key slug is safe and deterministic', () => {
  assert.equal(slugifyClientKey('Acme Inc!'), 'acme-inc');
  assert.equal(slugifyClientKey('3M Company'), 'c-3m-company');
  assert.equal(slugifyClientKey('Açúcar & Cia'), 'acucar-cia');
  assert.equal(slugifyClientKey('!!!'), '');
});

test('brand identity sanitization keeps only contract keys', () => {
  const input = { status: 'AUTO_DISCOVERED', logos: [], internal_debug: { db_path: '/secret' }, collected_at: '2026-10-06T00:00:00Z', random: 1 };
  const out = sanitizeBrandIdentity(input) as any;
  assert.equal(out.status, 'AUTO_DISCOVERED');
  assert.equal('internal_debug' in out, false);
  assert.equal('random' in out, false);
  assert.equal(sanitizeBrandIdentity(null), null);
  assert.equal(sanitizeBrandIdentity('string'), null);
  assert.equal(sanitizeBrandIdentity({ unrelated: true }), null);
});
