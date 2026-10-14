import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUserRoleChange, userClientAssignments } from '../lib/user-management';
import type { Actor } from '../lib/security';

const admin: Actor = { id: 'admin', organizationId: 'org-a', role: 'ADMIN', name: 'Admin', email: 'admin@example.test', clientIds: [], forcePasswordChange: false };

test('ordinary administrators cannot grant or alter super administrator access', () => {
  assert.throws(() => assertUserRoleChange(admin, 'SUPER_ADMIN'), /super administrador/);
  assert.throws(() => assertUserRoleChange(admin, 'ANALYST', { id: 'other', role: 'SUPER_ADMIN', organizationIds: ['org-a'] }), /super administrador/);
  assert.doesNotThrow(() => assertUserRoleChange({ ...admin, role: 'SUPER_ADMIN' }, 'SUPER_ADMIN'));
});

test('a user outside the organization or shared globally cannot be mutated', () => {
  assert.throws(() => assertUserRoleChange(admin, 'ANALYST', { id: 'other', role: 'ANALYST', organizationIds: ['org-b'] }), /organização/);
  assert.throws(() => assertUserRoleChange(admin, 'ANALYST', { id: 'other', role: 'ANALYST', organizationIds: ['org-a', 'org-b'] }), /organização/);
});

test('administrators cannot disable or demote themselves', () => {
  const target = { id: admin.id, role: admin.role, organizationIds: ['org-a'] };
  assert.throws(() => assertUserRoleChange(admin, undefined, target, 'DISABLED'), /próprio acesso/);
  assert.throws(() => assertUserRoleChange(admin, 'ANALYST', target), /próprio acesso/);
  assert.doesNotThrow(() => assertUserRoleChange(admin, 'ADMIN', target, 'ACTIVE'));
});

test('client roles require assignments and internal roles do not retain them', () => {
  assert.throws(() => userClientAssignments('CLIENT_VIEWER', []), /pelo menos um cliente/);
  assert.deepEqual(userClientAssignments('CLIENT_ADMIN', ['client-a', 'client-a']), ['client-a']);
  assert.deepEqual(userClientAssignments('ANALYST', ['client-a']), []);
});
