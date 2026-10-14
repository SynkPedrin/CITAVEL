import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStage, finalRunStatus } from '../lib/run-state';

test('queue acceptance and wrong client results never confirm an Engine stage', () => {
  for (const status of ['QUEUED', 'RUNNING', 'READY']) assert.throws(() => summarizeStage({ client_id: 'a', stage: 'REPORT', status }, 'a', 'REPORT'));
  assert.throws(() => summarizeStage({ client_id: 'b', stage: 'REPORT', status: 'SUCCESS' }, 'a', 'REPORT'));
});

test('partial and failed Engine stages are not reported as successful runs', () => {
  const success = summarizeStage({ client_id: 'a', stage: 'AUDIT', status: 'SUCCESS', summary: { prompts: 40 } }, 'a', 'AUDIT');
  const partial = { ...success, status: 'PARTIAL' as const };
  const failure = { ...success, status: 'ERROR' as const };
  assert.equal(finalRunStatus([success]), 'SUCCESS');
  assert.equal(finalRunStatus([success, partial]), 'PARTIAL');
  assert.equal(finalRunStatus([success, failure]), 'PARTIAL');
  assert.equal(finalRunStatus([failure]), 'FAILED');
  assert.equal(finalRunStatus([]), 'FAILED');
});
