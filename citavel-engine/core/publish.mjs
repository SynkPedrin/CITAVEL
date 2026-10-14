import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicWrite} from './store.mjs';

/**
 * Publishing adapters. Contract: docs/action-engine.md §3.
 * Interface: {type, check(config) → {ok, detail}, publish({page, html, action, config}) → {commit?, branch, url, rollback}, rollback(deployment, config)}.
 * An adapter never fakes a deploy: any missing access surfaces as {ok:false}.
 */
const run = promisify(execFile);
const GIT_TIMEOUT = 30_000;

async function git(repo, args) {
  const {stdout} = await run('git', ['-C', repo, ...args], {timeout: GIT_TIMEOUT, maxBuffer: 4 * 1024 * 1024});
  return stdout.trim();
}

const domainHost = (value) => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};

// Writes are confined to base_path inside the repo; slugs are draft-generated
// but revalidated here because this path reaches a real git repository.
const safeSlug = (slug) => {
  const value = String(slug || '');
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(value)) throw new Error('SLUG_INVALID');
  return value;
};

function publishingConfig(config) {
  const pub = config?.publishing;
  if (!pub || typeof pub !== 'object') throw new Error('PUBLISHING_NOT_CONFIGURED');
  if (pub.adapter !== 'git_static') throw new Error('PUBLISHING_ADAPTER_UNKNOWN');
  return pub;
}

async function checkGitStatic(config) {
  let pub;
  try { pub = publishingConfig(config); } catch (e) { return {ok: false, detail: e.message}; }
  if (typeof pub.repo_path !== 'string' || !path.isAbsolute(pub.repo_path)) return {ok: false, detail: 'REPO_PATH_MUST_BE_ABSOLUTE'};
  if (!pub.base_path || path.isAbsolute(pub.base_path) || pub.base_path.split('/').some((part) => !part || part === '.' || part === '..')) {
    return {ok: false, detail: 'BASE_PATH_INVALID'};
  }
  // Publication stays on the client domain; a foreign url_base is refused.
  const urlHost = domainHost(pub.url_base), ownHost = domainHost(config.domain);
  if (!urlHost || !ownHost || urlHost !== ownHost) return {ok: false, detail: 'URL_BASE_MUST_BELONG_TO_CLIENT_DOMAIN'};
  try {
    const stat = await fs.stat(pub.repo_path);
    if (!stat.isDirectory()) return {ok: false, detail: 'REPO_PATH_NOT_A_DIRECTORY'};
    if (await git(pub.repo_path, ['rev-parse', '--is-inside-work-tree']) !== 'true') return {ok: false, detail: 'REPO_PATH_NOT_A_GIT_REPO'};
  } catch { return {ok: false, detail: 'REPO_PATH_NOT_A_GIT_REPO'}; }
  return {ok: true, detail: 'git_static pronto'};
}

async function publishGitStatic({page, html, action, config}) {
  const pub = publishingConfig(config);
  const checked = await checkGitStatic(config);
  if (!checked.ok) { const e = new Error(checked.detail); e.code = 'BLOCKED_NO_ACCESS'; throw e; }
  const repo = pub.repo_path;
  // A dirty working tree means human work could be swept into a deploy branch.
  if (await git(repo, ['status', '--porcelain']) !== '') { const e = new Error('GIT_WORKING_TREE_DIRTY'); e.code = 'BLOCKED_NO_ACCESS'; throw e; }
  const prefix = typeof pub.branch_prefix === 'string' && /^[a-z0-9][a-z0-9/-]{0,40}$/i.test(pub.branch_prefix) ? pub.branch_prefix : 'citavel/';
  const shortId = String(action.action_id || '').replace(/^act_/, '').slice(0, 8) || 'draft';
  const branch = `${prefix}${config.client_id}-${shortId}`;
  // Never commit on main/master directly: the deploy branch is (re)created from
  // the current HEAD and verified before any commit happens.
  await git(repo, ['checkout', '-B', branch]);
  const current = await git(repo, ['branch', '--show-current']);
  if (['main', 'master'].includes(current)) throw new Error('REFUSE_COMMIT_ON_MAIN');
  const slug = safeSlug(page.slug);
  const baseResolved = path.resolve(repo, pub.base_path);
  const target = path.resolve(baseResolved, `${slug}.html`);
  if (!target.startsWith(baseResolved + path.sep)) throw new Error('WRITE_OUTSIDE_BASE_PATH');
  await atomicWrite(target, html);
  await git(repo, ['add', '--', path.relative(repo, target)]);
  let commit;
  if (await git(repo, ['status', '--porcelain']) === '') {
    // Idempotent republish: identical content reuses the existing commit.
    commit = await git(repo, ['rev-parse', 'HEAD']);
  } else {
    const message = `[CITAVEL-${action.action_id}] ${String(action.title || 'Implementação CITAVEL').replace(/[\r\n]+/g, ' ').slice(0, 120)}`;
    await git(repo, ['-c', 'user.name=CITAVEL Engine', '-c', 'user.email=citavel-engine@localhost', 'commit', '-m', message]);
    commit = await git(repo, ['rev-parse', 'HEAD']);
  }
  let pushed = false;
  if (pub.auto_push === true) { await git(repo, ['push', '-u', 'origin', branch]); pushed = true; }
  const url = `${String(pub.url_base).replace(/\/+$/, '')}/${slug}.html`;
  return {commit, branch, url, pushed, rollback: {strategy: 'git_revert', commit}};
}

async function rollbackGitStatic(deployment, config) {
  const pub = publishingConfig(config);
  if (!deployment?.rollback?.commit || !deployment?.branch) throw new Error('ROLLBACK_DATA_MISSING');
  await git(pub.repo_path, ['checkout', deployment.branch]);
  await git(pub.repo_path, ['revert', '--no-edit', deployment.rollback.commit]);
  if (pub.auto_push === true) await git(pub.repo_path, ['push', 'origin', deployment.branch]);
  return {reverted: deployment.rollback.commit, branch: deployment.branch};
}

export const ADAPTERS = {
  git_static: {type: 'git_static', check: checkGitStatic, publish: publishGitStatic, rollback: rollbackGitStatic},
};

/** Returns the configured adapter or null when the client has no publishing config. */
export function getAdapter(config) {
  const type = config?.publishing?.adapter;
  return type ? ADAPTERS[type] || null : null;
}
