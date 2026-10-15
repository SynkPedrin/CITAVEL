// Manager 2.0 DB-backed tests (real Postgres, throwaway organizations deleted afterwards). No network, no AI credits.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../lib/db';
import { clientHeader, listClients, saveClientProfile, clientScope } from '../lib/clients';
import { createMeasurement, updateMeasurement, listMeasurements, setArchived } from '../lib/ai-measurement/service';
import { buildSnapshotV2 } from '../lib/report/snapshot-v2';
import { generateReportV2, snapshotFor } from '../lib/report/service';
import type { Actor } from '../lib/security';

const tag = 'm2test' + Date.now().toString(36);
let orgA: string, orgB: string, admin: Actor, adminB: Actor, c1: string, c2: string, cB: string;
const viewerOf = (ids: string[]): Actor => ({ ...admin, id: 'viewer-' + ids.join(), role: 'CLIENT_VIEWER', clientIds: ids });
const RAW = `CLIENTE: Teste\nORIGEM: Agentes\nMETODOLOGIA: 10 prompts\nVERSÃO: 1\nDATA DA EXECUÇÃO: 11/10/2026\nPLATAFORMAS:\nOPENAI:\nMODELO: m\nMÉTODO DE COLETA: interface de consumo\nPROMPTS: 10\nOBSERVAÇÕES: 10\nMENÇÕES: 4 de 10\nRECOMENDAÇÕES: 2\nCITAÇÕES: 1\nEVIDÊNCIAS:\n- ChatGPT: resposta registrada`;
const input = (over: any = {}) => ({ title: 'Medição teste', source: 'Agentes', methodology: '10 prompts', methodologyVersion: '1', classification: 'QUALITATIVE', periodStart: null, periodEnd: null, executedAt: '2026-10-11', rawText: RAW,
  platforms: [{ provider: 'OPENAI', model: 'm', collectionMethod: 'interface de consumo', promptCount: 10, observationCount: 10, mentionCount: 4, recommendationCount: 2, citationCount: 1 }], competitors: [{ name: 'Concorrente X', platform: 'OPENAI' }], sources: [], findings: [{ type: 'EVIDENCE', text: 'ChatGPT: resposta registrada' }], ...over });

before(async () => {
  process.env.REPORT_STORAGE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'citavel-m2-'));
  orgA = (await db.organization.create({ data: { name: 'M2 A', slug: tag + '-a' } })).id; orgB = (await db.organization.create({ data: { name: 'M2 B', slug: tag + '-b' } })).id;
  const ua = await db.user.create({ data: { name: 'Admin', email: tag + 'a@test.invalid', passwordHash: 'x', memberships: { create: { organizationId: orgA, role: 'ADMIN' } } } });
  admin = { id: ua.id, name: 'Admin', email: ua.email, role: 'ADMIN', organizationId: orgA, clientIds: [], forcePasswordChange: false };
  adminB = { ...admin, id: 'b-admin', organizationId: orgB };
  c1 = (await saveClientProfile(admin, { name: tag + ' Um', domain: 'um.invalid', industry: 'Saúde', locations: ['Campinas'], services: ['Ressonância'], brandTerms: [], status: 'ACTIVE' })).id;
  c2 = (await saveClientProfile(admin, { name: tag + ' Dois', domain: 'dois.invalid', industry: '', locations: [], services: [], brandTerms: [], status: 'ACTIVE' })).id;
  cB = (await db.client.create({ data: { organizationId: orgB, clientKey: tag + '-b', engineClientId: tag + '-b', name: 'B', brandName: 'B', domain: 'https://b.invalid/' } })).id;
});
after(async () => {
  await db.systemEvent.deleteMany({ where: { OR: [{ client: { organizationId: { in: [orgA, orgB] } } }, { actorId: admin.id }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }); await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await fs.rm(process.env.REPORT_STORAGE_DIR!, { recursive: true, force: true }); await db.$disconnect();
});

test('REGRESSION: a client viewer cannot open another client by putting its id in the URL', async () => {
  const v = viewerOf([c1]);
  assert.ok(await clientHeader(v, c1));
  assert.equal(await clientHeader(v, c2), null); // same org, not assigned → must be hidden (was leaking before the fix)
  assert.equal(await clientHeader(v, cB), null);
  assert.equal(await clientHeader(adminB, c1), null); // other org admin
  assert.deepEqual((await listClients(v)).map(c => c.id), [c1]);
  assert.ok((await listClients(admin)).length >= 2);
  // The scope is combined with AND, never overwritten by an id filter.
  const n = await db.client.count({ where: { AND: [clientScope(v), { id: c2 }] } }); assert.equal(n, 0);
});

test('client profile: duplicates refused, confirmed terms stored for classifier and briefing', async () => {
  await assert.rejects(saveClientProfile(admin, { name: tag + ' Um', domain: 'outro.invalid', industry: '', locations: [], services: [], brandTerms: [], status: 'ACTIVE' }), (e: any) => e.code === 'DUPLICATE_CLIENT');
  const c = await db.client.findUniqueOrThrow({ where: { id: c1 } });
  assert.equal(c.domain, 'https://um.invalid/'); assert.deepEqual((c.metadata as any).gsc.terms.services, ['Ressonância']);
  await assert.rejects(saveClientProfile(adminB, { name: 'x', domain: 'x.invalid', industry: '', locations: [], services: [], brandTerms: [], status: 'ACTIVE' }, c1), (e: any) => e.code === 'NOT_FOUND');
});

test('measurement: GOLDEN requires evidence + consumer collection; impossible counts refused', async () => {
  await assert.rejects(createMeasurement(c1, admin, input({ classification: 'GOLDEN', findings: [] })), (e: any) => e.code === 'GOLDEN_REQUIRES_EVIDENCE');
  await assert.rejects(createMeasurement(c1, admin, input({ classification: 'GOLDEN', platforms: [{ ...input().platforms[0], collectionMethod: 'API' }] })), (e: any) => e.code === 'GOLDEN_REQUIRES_EVIDENCE');
  await assert.rejects(createMeasurement(c1, admin, input({ platforms: [{ ...input().platforms[0], mentionCount: 11 }] })), (e: any) => e.code === 'IMPOSSIBLE_VALUE');
  await assert.rejects(createMeasurement(c1, admin, input({ rawText: RAW + '\nPaciente João, laudo 123' })), (e: any) => e.code === 'SENSITIVE_DATA');
});

let mid: string;
test('measurement: confirm → persisted with provenance; edit → new version, previous preserved', async () => {
  const m = await createMeasurement(c1, admin, input({ classification: 'GOLDEN', platforms: [{ ...input().platforms[0], citationCount: 2 }] }));
  mid = m.id;
  const sd = m.structuredData as any;
  assert.equal(sd.platforms[0].mentionCount.origin, 'EXTRACTED'); assert.equal(sd.platforms[0].mentionCount.evidence.text, 'MENÇÕES: 4 de 10');
  assert.equal(sd.platforms[0].citationCount.origin, 'EDITED'); assert.ok(sd.edits.includes('OPENAI.citationCount'));
  const [listed] = await listMeasurements(c1); assert.equal(listed.indicators.mention!.value, 0.4);
  const v2 = await updateMeasurement(c1, mid, admin, input({ classification: 'GOLDEN', platforms: [{ ...input().platforms[0], mentionCount: 6 }], note: 'correção' }));
  assert.equal(v2.version, 2);
  const rev = await db.aiMeasurementRevision.findMany({ where: { measurementId: mid } });
  assert.equal(rev.length, 1); assert.equal(rev[0].version, 1); assert.equal((rev[0].previousData as any).platforms[0].mentionCount, 4);
  assert.equal((await db.aiMeasurementPlatform.findFirstOrThrow({ where: { measurementId: mid } })).mentionCount, 6);
  await assert.rejects(updateMeasurement(c2, mid, admin, input()), (e: any) => e.code === 'NOT_FOUND'); // cannot edit through another client
});

test('report snapshot v2 freezes the measurement version; later edits do not change it', async () => {
  const before = await buildSnapshotV2(c1, { kind: 'IA', format: 'COMPLETO', measurementId: mid }, admin.id);
  assert.equal(before.ai_visibility.measurement_version, 2); assert.equal(before.ai_visibility.indicators.mention.numerator, 6);
  assert.deepEqual(before.ai_measurement_versions, { [mid]: 2 });
  const r = await generateReportV2(c1, admin, { kind: 'IA', format: 'EXECUTIVO', measurementId: mid }, async () => Buffer.from('%PDF-1.7 test'));
  assert.equal(r.pdfStatus, 'READY');
  await updateMeasurement(c1, mid, admin, input({ classification: 'GOLDEN', platforms: [{ ...input().platforms[0], mentionCount: 1 }] }));
  const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: r.snapshotId } });
  assert.equal((stored.content as any).ai_visibility.indicators.mention.numerator, 6); // still the version used at generation
  assert.equal((stored.content as any).template_version, 'citavel-report-v2.1');
  await assert.rejects(snapshotFor(viewerOf([c2]), c1, r.snapshotId), (e: any) => e.code === 'TENANT_FORBIDDEN');
});

test('reports: IA report requires an approved measurement; Google report marks missing data as unavailable; render output must be a PDF', async () => {
  await assert.rejects(buildSnapshotV2(c2, { kind: 'IA', format: 'EXECUTIVO' }, admin.id), (e: any) => e.code === 'NO_MEASUREMENT');
  const g = await buildSnapshotV2(c2, { kind: 'GOOGLE', format: 'COMPLETO', period: '28d' }, admin.id);
  assert.equal(g.gsc_metrics.status, 'UNAVAILABLE'); assert.equal(g.ai_visibility, null); assert.match(g.narrative.google[0], /ainda não estão disponíveis/);
  const bad = await generateReportV2(c2, admin, { kind: 'GOOGLE', format: 'EXECUTIVO', period: '28d' }, async () => Buffer.from('<html>'));
  assert.equal(bad.pdfStatus, 'FAILED');
  await setArchived(c1, mid, admin, true);
  assert.equal((await listMeasurements(c1)).length, 0); assert.equal((await listMeasurements(c1, { includeArchived: true })).length, 1);
});
