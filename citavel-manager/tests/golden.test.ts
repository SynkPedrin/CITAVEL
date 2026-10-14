import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldenChecklist, importGoldenTest } from '../lib/golden';
import { goldenImportSchema } from '../lib/validation';
import { HttpError, type Actor } from '../lib/security';

const operator: Actor = { id: 'u1', name: 'Ana', email: 'ana@example.test', role: 'ANALYST', organizationId: 'org-a', clientIds: [], forcePasswordChange: false };
const client = { id: 'c1', organizationId: 'org-a', engineClientId: 'cosentino' };
const validInput = { platform: 'ChatGPT', promptExternalId: 'pr_1', response: 'Resposta real observada na plataforma, com texto suficiente.', timestamp: '2026-10-06T14:30' };

function dbFor(found: any = client, events: any[] = []) {
  return { client: { findUnique: async () => found }, systemEvent: { create: async (args: any) => { events.push(args); return {}; } } };
}

test('golden import schema rejects invalid platform and short response', () => {
  assert.throws(() => goldenImportSchema.parse({ ...validInput, platform: 'Bing' }));
  assert.throws(() => goldenImportSchema.parse({ ...validInput, response: 'curta' }));
  assert.throws(() => goldenImportSchema.parse({ ...validInput, timestamp: 'não é data' }));
  assert.equal(goldenImportSchema.parse(validInput).platform, 'ChatGPT');
});

test('golden import without a session is rejected as unauthenticated', async () => {
  await assert.rejects(
    () => importGoldenTest({ actor: null, clientId: 'c1', db: dbFor(), enginePost: async () => ({}), input: validInput }),
    (error: any) => error.status === 401 && error.code === 'AUTH_REQUIRED',
  );
});

test('golden import for a client of another organization is forbidden', async () => {
  await assert.rejects(
    () => importGoldenTest({ actor: operator, clientId: 'c1', db: dbFor({ ...client, organizationId: 'org-b' }), enginePost: async () => ({}), input: validInput }),
    (error: any) => error.status === 403 && error.code === 'TENANT_FORBIDDEN',
  );
});

test('engine errors propagate with the real code and no success event', async () => {
  const events: any[] = [];
  const enginePost = async () => { throw new HttpError(502, 'Engine respondeu HTTP 400: PROMPT_NOT_FOUND.', 'PROMPT_NOT_FOUND'); };
  await assert.rejects(
    () => importGoldenTest({ actor: operator, clientId: 'c1', db: dbFor(client, events), enginePost, input: validInput }),
    (error: any) => error.status === 502 && error.code === 'PROMPT_NOT_FOUND',
  );
  assert.equal(events.length, 0);
});

test('successful import sends the record, audits and returns engine counts', async () => {
  const events: any[] = [];
  const bodies: any[] = [];
  const enginePost = async (_path: string, body: any) => { bodies.push(body); return { imported: 1, total: 12 }; };
  const result = await importGoldenTest({ actor: operator, clientId: 'c1', db: dbFor(client, events), enginePost, input: validInput });
  assert.deepEqual(result, { imported: 1, total: 12 });
  const [record] = bodies[0];
  assert.equal(record.platform, 'ChatGPT');
  assert.equal(record.prompt_id, 'pr_1');
  assert.equal(record.timestamp, new Date('2026-10-06T14:30').toISOString());
  assert.equal(events[0].data.message, 'Teste GOLDEN importado');
  assert.equal(events[0].data.source, 'MANAGER');
  assert.equal(events[0].data.metadata.imported, 1);
});

test('checklist marks a prompt as collected only with a GOLDEN run', () => {
  const prompts = [
    { id: 'p1', externalId: 'pr_1', prompt: 'money um', cluster: 'A', commercialScore: 4.5, priority: 'P4', active: true },
    { id: 'p2', externalId: 'pr_2', prompt: 'money dois', cluster: 'A', commercialScore: 5, priority: 'P5', active: true },
    { id: 'p3', externalId: 'pr_3', prompt: 'inativo', cluster: 'B', commercialScore: 5, priority: 'P4', active: false },
    { id: 'p4', externalId: 'pr_4', prompt: 'comum', cluster: 'B', commercialScore: 5, priority: 'P2', active: true },
  ];
  const runs = [
    { promptId: 'p1', platform: 'ChatGPT', runType: 'GOLDEN' },
    { promptId: 'p2', platform: 'Gemini', runType: 'LAB' },
    { promptId: 'p1', platform: 'Bing', runType: 'GOLDEN' },
  ];
  const checklist = buildGoldenChecklist(prompts, runs);
  assert.equal(checklist.length, 2);
  assert.equal(checklist[0].promptId, 'p2');
  assert.equal(checklist[0].collected, false);
  assert.deepEqual(checklist[1].collectedPlatforms, ['ChatGPT']);
  assert.equal(checklist[1].collected, true);
});
