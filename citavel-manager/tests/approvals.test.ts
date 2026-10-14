import test from 'node:test';
import assert from 'node:assert/strict';
import { approveAction, rejectAction, guardActionMutation } from '../lib/action-decisions';
import { stripPrivatePaths } from '../lib/redact';
import { HttpError, type Actor } from '../lib/security';

const operator: Actor = { id: 'u1', name: 'Ana', email: 'ana@example.test', role: 'ANALYST', organizationId: 'org-a', clientIds: [], forcePasswordChange: false };
const baseAction = { id: 'a1', clientId: 'c1', externalId: 'act_1', status: 'PROPOSED', client: { id: 'c1', organizationId: 'org-a', engineClientId: 'cosentino' } };

function dbFor(action: any = baseAction, events: any[] = []) {
  return { action: { findUnique: async () => action }, systemEvent: { create: async (args: any) => { events.push(args); return {}; } } };
}

test('approve without a session is rejected as unauthenticated', async () => {
  await assert.rejects(
    () => approveAction({ actor: null, actionId: 'a1', db: dbFor(), enginePost: async () => ({}) }),
    (error: any) => error.status === 401 && error.code === 'AUTH_REQUIRED',
  );
});

test('approve for a client of another organization is forbidden', async () => {
  const outsider: Actor = { ...operator, organizationId: 'org-b' };
  await assert.rejects(
    () => approveAction({ actor: outsider, actionId: 'a1', db: dbFor(), enginePost: async () => ({}) }),
    (error: any) => error.status === 403 && error.code === 'TENANT_FORBIDDEN',
  );
});

test('NEEDS_INFORMATION from the engine stops the flow without false success', async () => {
  const calls: string[] = [];
  const events: any[] = [];
  const enginePost = async (path: string) => {
    calls.push(path);
    if (path.endsWith('/decide')) return { action: { status: 'APPROVED' } };
    if (path.endsWith('/execute')) return { action: { status: 'NEEDS_INFORMATION' }, validation: { evidence_ok: false, missing: ['preço público', 'garantia'] } };
    throw new Error('publish must not be called');
  };
  const result = await approveAction({ actor: operator, actionId: 'a1', db: dbFor(baseAction, events), enginePost });
  assert.equal(result.status, 'NEEDS_INFORMATION');
  assert.deepEqual(result.validation.missing, ['preço público', 'garantia']);
  assert.equal(calls.some(path => path.endsWith('/publish')), false);
  assert.equal(events.some(e => e.data.message === 'Ação aprovada'), true);
});

test('engine failure surfaces the real error with the state where it stopped', async () => {
  const enginePost = async (path: string) => {
    if (path.endsWith('/decide')) return { action: { status: 'APPROVED' } };
    throw new HttpError(502, 'Engine respondeu HTTP 409: INVALID_TRANSITION.', 'INVALID_TRANSITION');
  };
  await assert.rejects(
    () => approveAction({ actor: operator, actionId: 'a1', db: dbFor(), enginePost }),
    (error: any) => error.status === 502 && error.code === 'INVALID_TRANSITION' && /EXECUTE/.test(error.message) && /APPROVED/.test(error.message),
  );
});

test('reject sends the decision and records the audit note', async () => {
  const bodies: any[] = [];
  const events: any[] = [];
  const enginePost = async (_path: string, body: any) => { bodies.push(body); return { action: { status: 'REJECTED' } }; };
  const result = await rejectAction({ actor: operator, actionId: 'a1', note: 'fora do escopo', db: dbFor(baseAction, events), enginePost });
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(bodies[0], { decision: 'REJECT', actor: operator.email, note: 'fora do escopo' });
  assert.equal(events.some(e => e.data.message === 'Ação rejeitada' && e.data.metadata.note === 'fora do escopo'), true);
});

test('reject route guard demands the mutation headers', () => {
  const url = 'http://localhost:3002/api/actions/a1/reject';
  assert.throws(() => guardActionMutation(new Request(url, { method: 'POST' })), /CSRF|segurança/i);
  assert.throws(() => guardActionMutation(new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3002' } })), /CSRF|segurança/i);
  assert.doesNotThrow(() => guardActionMutation(new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3002', 'x-citavel-request': '1', 'sec-fetch-site': 'same-origin' } }), 'http://localhost:3002'));
});

test('stripPrivatePaths removes repo_path recursively and keeps other fields', () => {
  const input = { status: 'PUBLISHED', deployment: { adapter: 'git_static', repo_path: '/abs/repo', url: 'https://x', rollback: { strategy: 'git_revert', repo_path: '/abs/repo' } }, list: [{ repo_path: '/a', keep: 1 }] };
  const out: any = stripPrivatePaths(input);
  assert.equal(out.status, 'PUBLISHED');
  assert.equal(out.deployment.url, 'https://x');
  assert.equal('repo_path' in out.deployment, false);
  assert.equal('repo_path' in out.deployment.rollback, false);
  assert.equal('repo_path' in out.list[0], false);
  assert.equal(out.list[0].keep, 1);
  const date = new Date();
  assert.equal(stripPrivatePaths({ at: date }).at, date);
});
