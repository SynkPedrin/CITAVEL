// Competitive intelligence against real Postgres (throwaway organizations, deleted afterwards). No network, no AI credits.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
process.env.CITAVEL_DISABLE_LOGO_LOOKUP = '1';
import { db } from '../lib/db';
import { saveClientProfile } from '../lib/clients';
import { createMeasurement, updateMeasurement } from '../lib/ai-measurement/service';
import { loadComparison, listCompetitors, addCompetitor, updateCompetitor, deleteCompetitor } from '../lib/competitive/service';
import { uploadLogo, resolveLogo, approve, logoState } from '../lib/brand/service';
import { competitiveBlock, createSnapshotV2 } from '../lib/report/snapshot-v2';
import { renderReportHtmlV2 } from '../lib/report/template-v2';
import { canOperate, type Actor } from '../lib/security';

const tag = 'cmptest' + Date.now().toString(36);
let orgA: string, orgB: string, admin: Actor, adminB: Actor, c1: string, c2: string, cB: string, dir: string;
const png = (w = 120, h = 60, fill = 0) => { const b = Buffer.alloc(40 + fill); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); if (fill) b.fill(fill, 33); return b; };
const RAW = 'CLIENTE: Teste\nORIGEM: Agentes\nMETODOLOGIA: 20 prompts\nVERSÃO: 1\nDATA DA EXECUÇÃO: 11/10/2026\nPLATAFORMAS:\nOPENAI:\nMODELO: m\nMÉTODO DE COLETA: API\nPROMPTS: 20\nOBSERVAÇÕES: 20\nMENÇÕES: 8 de 20\nRECOMENDAÇÕES: 4\nCITAÇÕES: 1\nCONCORRENTES:\n- Alfa';
const plat = (o: any = {}) => ({ provider: 'OPENAI', model: 'm', collectionMethod: 'API', promptCount: 20, observationCount: 20, mentionCount: 8, recommendationCount: 4, citationCount: 1, ...o });
const m = (o: any = {}) => ({ provider: 'OPENAI', observationCount: 20, mentionCount: 10, recommendationCount: 8, citationCount: 3, ...o });
const input = (o: any = {}) => ({ title: 'Medição competitiva', source: 'Agentes', methodology: '20 prompts', methodologyVersion: '1', classification: 'LAB', periodStart: null, periodEnd: null, executedAt: '2026-10-11', rawText: RAW, platforms: [plat()], competitors: [], sources: [], findings: [],
  competitiveAnalysis: [{ name: 'Alfa Diagnósticos', domain: 'alfa.example.invalid', metrics: [m()] }, { name: 'Beta Imagem', domain: null, metrics: [m({ mentionCount: 5, recommendationCount: 2, citationCount: 0 })] }, { name: 'Gama', domain: 'gama.example.invalid', metrics: [m({ observationCount: 15, mentionCount: 5 })] }], ...o });

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'citavel-brand-')); process.env.BRAND_ASSET_DIR = dir; process.env.REPORT_STORAGE_DIR = path.join(dir, 'reports');
  orgA = (await db.organization.create({ data: { name: 'C A', slug: tag + '-a' } })).id; orgB = (await db.organization.create({ data: { name: 'C B', slug: tag + '-b' } })).id;
  const ua = await db.user.create({ data: { name: 'Admin', email: tag + 'a@test.invalid', passwordHash: 'x', memberships: { create: { organizationId: orgA, role: 'ADMIN' } } } });
  admin = { id: ua.id, name: 'Admin', email: ua.email, role: 'ADMIN', organizationId: orgA, clientIds: [], forcePasswordChange: false };
  adminB = { ...admin, id: 'b-admin', organizationId: orgB };
  c1 = (await saveClientProfile(admin, { name: tag + ' Um', domain: 'um.invalid', industry: '', locations: [], services: [], brandTerms: [], status: 'ACTIVE' })).id;
  c2 = (await saveClientProfile(admin, { name: tag + ' Dois', domain: 'dois.invalid', industry: '', locations: [], services: [], brandTerms: [], status: 'ACTIVE' })).id;
  cB = (await db.client.create({ data: { organizationId: orgB, clientKey: tag + '-b', engineClientId: tag + '-b', name: 'B', brandName: 'B', domain: 'https://b.invalid/' } })).id;
});
after(async () => {
  await db.systemEvent.deleteMany({ where: { OR: [{ client: { organizationId: { in: [orgA, orgB] } } }, { actorId: admin.id }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }); await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await fs.rm(dir, { recursive: true, force: true }); await db.$disconnect();
});

let mid: string;
test('import with three competitors: persisted per client, compared only on the same universe', async () => {
  const meas = await createMeasurement(c1, admin, input()); mid = meas.id;
  const comps = await db.clientCompetitor.findMany({ where: { clientId: c1 } }); assert.equal(comps.length, 3);
  assert.ok(comps.every(c => c.organizationId === orgA && c.clientId === c1));
  const v = (await loadComparison(c1))!; assert.equal(v.measurement.id, mid);
  assert.deepEqual(v.comparison.competitors.map(c => c.name), ['Alfa Diagnósticos', 'Beta Imagem', 'Gama']);
  const gama = v.comparison.competitors.find(c => c.name === 'Gama')!; assert.equal(gama.measured, false); assert.match(gama.skipped[0].reason, /universo diferente/);
  const alfa = v.comparison.competitors[0]; assert.equal(alfa.recommendation!.numerator, 8); assert.equal(alfa.diff!.recommendation, -20); // client 20% − Alfa 40%
  assert.equal(v.comparison.top!.name, 'Alfa Diagnósticos');
  assert.equal(v.comparison.client.share!.denominator, 4 + 8 + 2);
});

test('re-import and edit never duplicate competitors; same domain keeps identity; same name + other domain stays separate', async () => {
  await createMeasurement(c1, admin, input({ title: 'Segunda', competitiveAnalysis: [{ name: 'Alfa Diagnóstico Ltda', domain: 'alfa.example.invalid', metrics: [m()] }, { name: 'Beta Imagem', domain: 'beta.example.invalid', metrics: [m()] }, { name: 'Beta Imagem', domain: 'beta2.example.invalid', metrics: [m()] }].slice(0, 2) }));
  const list = await db.clientCompetitor.findMany({ where: { clientId: c1 }, orderBy: { name: 'asc' } });
  assert.equal(list.length, 3); // Alfa (by domain), Beta (domain learned), Gama
  assert.equal(list.find(c => c.name === 'Beta Imagem')!.officialDomain, 'beta.example.invalid');
  const other = await createMeasurement(c1, admin, input({ title: 'Terceira', competitiveAnalysis: [{ name: 'Beta Imagem', domain: 'outra-empresa.example.invalid', metrics: [m()] }] }));
  assert.equal(await db.clientCompetitor.count({ where: { clientId: c1, name: 'Beta Imagem' } }), 2);
  const v2 = await updateMeasurement(c1, mid, admin, input({ competitiveAnalysis: [{ name: 'Alfa Diagnósticos', domain: 'alfa.example.invalid', metrics: [m({ recommendationCount: 10 })] }] }));
  assert.equal(v2.version, 2); assert.equal((await db.aiMeasurementCompetitorMetric.findMany({ where: { measurementId: mid } })).length, 1);
  assert.equal((await loadComparison(c1, { measurementId: mid }))!.comparison.competitors[0].recommendation!.numerator, 10);
  assert.equal((await db.clientCompetitor.findMany({ where: { clientId: c1 } })).filter(c => c.officialDomain === 'alfa.example.invalid').length, 1);
  await db.aiMeasurement.delete({ where: { id: other.id } });
});

test('multi-tenant: another client or organization never sees, edits or approves these competitors/logos', async () => {
  await createMeasurement(c2, admin, input({ title: 'Cliente 2', competitiveAnalysis: [{ name: 'Alfa Diagnósticos', domain: 'alfa.example.invalid', metrics: [m({ recommendationCount: 1 })] }] }));
  const mine = await listCompetitors(c1), theirs = await listCompetitors(c2);
  assert.ok(mine.length >= 3); assert.equal(theirs.length, 1); assert.ok(!theirs.some(t => mine.some(x => x.id === t.id))); // same public domain, separate records
  assert.equal((await loadComparison(c2))!.comparison.competitors[0].recommendation!.numerator, 1); // c1's numbers (8/10) never leak into c2
  assert.equal(await loadComparison(cB), null);
  const alfa1 = mine.find(c => c.domain === 'alfa.example.invalid')!;
  await assert.rejects(updateCompetitor(c2, alfa1.id, admin, { isVisible: false }), (e: any) => e.code === 'NOT_FOUND');
  await assert.rejects(deleteCompetitor(cB, alfa1.id, adminB), (e: any) => e.code === 'NOT_FOUND');
  const a = await uploadLogo(c1, alfa1.id, admin, png().toString('base64'));
  await assert.rejects(approve(c2, a.id, admin), (e: any) => e.code === 'NOT_FOUND');
  await assert.rejects(uploadLogo(c2, alfa1.id, admin, png().toString('base64')), (e: any) => e.code === 'NOT_FOUND'); // competitor belongs to c1
  assert.equal((await logoState(c2)).get(alfa1.id), undefined);
});

test('permissions: only operators manage; client viewers cannot', () => {
  const viewer: Actor = { ...admin, role: 'CLIENT_VIEWER', clientIds: [c1] };
  assert.equal(canOperate(admin), true); assert.equal(canOperate(viewer), false); assert.equal(canOperate({ ...viewer, role: 'CLIENT_ADMIN' }), false);
});

test('manual competitor: no invented data; delete only while it has no measurements', async () => {
  const c = await addCompetitor(c2, admin, { name: 'Manual Clínica', domain: 'https://www.manual.example.invalid/x' });
  assert.equal(c.officialDomain, 'manual.example.invalid'); assert.equal(c.origin, 'MANUAL');
  assert.equal(await db.aiMeasurementCompetitorMetric.count({ where: { competitorId: c.id } }), 0);
  const v = (await loadComparison(c2))!; assert.ok(v.withoutData.some(x => x.name === 'Manual Clínica')); assert.ok(!v.comparison.competitors.some(x => x.name === 'Manual Clínica'));
  await assert.rejects(addCompetitor(c2, admin, { name: 'X', domain: 'not a domain' }), (e: any) => e.code === 'INVALID_DOMAIN' || e.name === 'ZodError');
  await updateCompetitor(c2, c.id, admin, { isVisible: false }); assert.ok(!(await loadComparison(c2))!.withoutData.some(x => x.name === 'Manual Clínica'));
  await deleteCompetitor(c2, c.id, admin); assert.equal(await db.clientCompetitor.count({ where: { id: c.id } }), 0);
  const withData = (await listCompetitors(c2)).find(x => x.hasMeasurements)!;
  await assert.rejects(deleteCompetitor(c2, withData.id, admin), (e: any) => e.code === 'HAS_MEASUREMENTS');
});

test('logos: validated by content, private storage, approval required, replacement keeps history, SSRF blocked', async () => {
  await assert.rejects(uploadLogo(c1, null, admin, Buffer.from('<html>x</html>').toString('base64')), (e: any) => e.code === 'NOT_AN_IMAGE');
  await assert.rejects(uploadLogo(c1, null, admin, Buffer.from('<svg><script>x</script></svg>').toString('base64')), (e: any) => e.code === 'UNSAFE_SVG');
  const first = await uploadLogo(c1, null, admin, png(100, 50, 1).toString('base64'));
  assert.equal(first.verificationStatus, 'APPROVED'); assert.equal(first.isCurrent, true); assert.match(first.storageKey, new RegExp(`^${c1}/[a-f0-9]{64}\\.png$`));
  assert.equal(((await fs.stat(path.join(dir, first.storageKey))).mode & 0o777), 0o600);
  const second = await uploadLogo(c1, null, admin, png(100, 50, 2).toString('base64'));
  const state = (await logoState(c1)).get('CLIENT')!; assert.equal(state.approved!.id, second.id);
  assert.equal((await db.brandAsset.findUniqueOrThrow({ where: { id: first.id } })).isCurrent, false); // history kept
  // automatic search through a resolver that answers with an internal address → refused, nothing stored
  const alfa = (await listCompetitors(c1)).find(c => c.domain === 'alfa.example.invalid')!;
  const r = await resolveLogo(c1, alfa.id, admin, { resolver: async () => ['127.0.0.1'] }); assert.equal(r.status, 'ERROR');
  const nodom = await resolveLogo(c1, (await listCompetitors(c1)).find(c => !c.domain)?.id ?? null, admin, { resolver: async () => ['10.0.0.1'] });
  assert.ok(['ERROR', 'NO_DOMAIN'].includes(nodom.status));
});

test('report snapshot freezes numbers and approved logos; replacing a logo later never changes a generated report', async () => {
  const alfa = (await listCompetitors(c1)).find(c => c.domain === 'alfa.example.invalid')!;
  await uploadLogo(c1, alfa.id, admin, png(90, 90, 3).toString('base64'));
  const snap = await createSnapshotV2(c1, admin.id, { kind: 'IA', format: 'COMPLETO', measurementId: mid });
  const c: any = (snap.content as any).competitive; assert.equal(c.status, 'AVAILABLE');
  const frozen = c.rows.find((r: any) => r.name === 'Alfa Diagnósticos').logo.data_uri; assert.match(frozen, /^data:image\/png;base64,/);
  assert.match(c.rows.find((r: any) => r.is_client).logo.data_uri, /^data:image\/png/);
  assert.ok(c.rows.every((r: any) => r.logo === null || r.logo.data_uri)); // only approved logos are embedded; the rest renders as initials
  const html = renderReportHtmlV2(snap.content as any, { snapshotId: snap.id, hash: snap.contentHash });
  assert.ok(html.indexOf('class="cover"') < html.indexOf('class="cmp-page"') && html.indexOf('class="cmp-page"') < html.indexOf('class="intro"'));
  await uploadLogo(c1, alfa.id, admin, png(90, 90, 4).toString('base64'));
  const stored: any = (await db.reportSnapshot.findUniqueOrThrow({ where: { id: snap.id } })).content;
  assert.equal(stored.competitive.rows.find((r: any) => r.name === 'Alfa Diagnósticos').logo.data_uri, frozen);
  const google = await createSnapshotV2(c1, admin.id, { kind: 'GOOGLE', format: 'EXECUTIVO', period: '28d' }); assert.equal((google.content as any).competitive, null);
});

test('LAB and GOLDEN stay separate; a measurement without competitor counts produces no comparison', async () => {
  const gold = await createMeasurement(c1, admin, input({ title: 'Golden', classification: 'GOLDEN', platforms: [plat({ collectionMethod: 'interface de consumo' })], findings: [{ type: 'EVIDENCE', text: 'print 1' }], competitiveAnalysis: [{ name: 'Alfa Diagnósticos', domain: 'alfa.example.invalid', metrics: [m({ recommendationCount: 1 })] }] }));
  const g = (await loadComparison(c1, { measurementId: gold.id }))!, l = (await loadComparison(c1, { measurementId: mid }))!;
  assert.equal(g.measurement.classification, 'GOLDEN'); assert.equal(l.measurement.classification, 'LAB');
  assert.equal(g.comparison.competitors.length, 1); assert.equal(g.comparison.competitors[0].recommendation!.numerator, 1); assert.equal(l.comparison.competitors[0].recommendation!.numerator, 10); // never pooled
  const bare = await createMeasurement(c2, admin, input({ title: 'Sem concorrentes', competitiveAnalysis: undefined, competitors: [] }));
  const none = await competitiveBlock(c2, bare.id); assert.equal(none.status, 'UNAVAILABLE');
  const noCounts = await createMeasurement(c2, admin, input({ title: 'Só nomes', competitiveAnalysis: undefined, competitors: [{ name: 'Delta' }] }));
  const nv = (await loadComparison(c2, { measurementId: noCounts.id }))!; assert.equal(nv.comparison.hasComparableData, false); assert.ok(nv.withoutData.some(x => x.name === 'Delta'));
});
