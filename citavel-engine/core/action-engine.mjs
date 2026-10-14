import path from 'node:path';
import fs from 'node:fs/promises';
import {withClientLock, loadState, saveState, clientDir, atomicWrite, upsert, stableId, validateClientId, redactError} from './store.mjs';
import {createDraft, createExperiment, aggregateMetrics} from './intelligence.mjs';
import {getAdapter} from './publish.mjs';

/**
 * Action Engine. Contract: docs/action-engine.md.
 * Lifecycle: DETECTED → PROPOSED → WAITING_APPROVAL → APPROVED → EXECUTING →
 * VALIDATING → READY_TO_PUBLISH → PUBLISHING → PUBLISHED → MONITORING → MEASURED.
 * Nothing is deleted; every transition is appended to action.lifecycle.
 */
export const ACTION_STATUSES = Object.freeze([
  'DETECTED', 'PROPOSED', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'VALIDATING',
  'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'MONITORING', 'MEASURED',
  'NEEDS_INFORMATION', 'NEEDS_HUMAN_ACTION', 'FAILED', 'REJECTED', 'ROLLED_BACK',
]);

// PUBLISHING → READY_TO_PUBLISH models an aborted deploy (blocked or pending
// validation); the contract keeps the action READY_TO_PUBLISH in both cases and
// the lifecycle records how it got there. NEEDS_INFORMATION/FAILED → EXECUTING
// is the explicit human retry after filling the draft or fixing the cause.
const TRANSITIONS = Object.freeze({
  DETECTED: ['PROPOSED'],
  OPEN: ['PROPOSED'], // legacy alias, migrated on read
  PROPOSED: ['WAITING_APPROVAL', 'APPROVED', 'REJECTED'],
  WAITING_APPROVAL: ['APPROVED', 'REJECTED', 'NEEDS_HUMAN_ACTION'],
  APPROVED: ['EXECUTING', 'NEEDS_HUMAN_ACTION'],
  EXECUTING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['READY_TO_PUBLISH', 'NEEDS_INFORMATION', 'FAILED'],
  READY_TO_PUBLISH: ['PUBLISHING'],
  PUBLISHING: ['PUBLISHED', 'READY_TO_PUBLISH', 'FAILED', 'ROLLED_BACK'],
  PUBLISHED: ['MONITORING', 'ROLLED_BACK'],
  MONITORING: ['MEASURED', 'ROLLED_BACK'],
  MEASURED: ['ROLLED_BACK'],
  NEEDS_INFORMATION: ['EXECUTING'],
  NEEDS_HUMAN_ACTION: [],
  FAILED: ['EXECUTING'],
  REJECTED: [],
  ROLLED_BACK: [],
});

const MISSING = '[INFORMAÇÃO NECESSÁRIA]';
const HUMAN_TYPES = ['SOURCE', 'REPUTATION', 'CONVERSION'];
const DAY_MS = 86_400_000;
const WINDOWS = [['D1', 1], ['D7', 7], ['D14', 14], ['D30', 30], ['D60', 60], ['D90', 90]];

const now = () => new Date().toISOString();
const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];

/** Appends a validated transition to action.lifecycle. Never silent. */
export function transition(action, to, {actor = 'engine', note = '', at = now()} = {}) {
  const from = action.status;
  if (!(TRANSITIONS[from] || []).includes(to)) {
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }
  action.status = to;
  action.lifecycle = asArray(action.lifecycle);
  action.lifecycle.push({status: to, at, actor: actor || 'engine', note});
  return action;
}

/** OPEN is the pre-contract alias of PROPOSED; migrate on read without rewriting history. */
export function migrateAction(action, at = now()) {
  if (!action || typeof action !== 'object') return action;
  action.action_type ||= action.type === 'AUTHORITY' ? 'SOURCE' : action.type || 'CONTENT';
  action.automation_level ||= HUMAN_TYPES.includes(action.action_type) ? 'HUMAN_ACTION' : 'APPROVAL_REQUIRED';
  action.approval_required ??= action.automation_level !== 'AUTOMATIC';
  action.risk ||= ['TECHNICAL', 'REPUTATION'].includes(action.action_type) ? 'MEDIUM' : 'LOW';
  action.affected_prompts = asArray(action.affected_prompts);
  action.affected_urls = asArray(action.affected_urls);
  action.preview ??= null;
  action.execution ??= null;
  action.deployment ??= null;
  action.lifecycle = asArray(action.lifecycle);
  if (action.status === 'OPEN') {
    action.status = 'PROPOSED';
    action.lifecycle.push({status: 'PROPOSED', at, actor: 'engine', note: 'Migração automática OPEN→PROPOSTO (contrato v1).'});
  }
  if (!action.lifecycle.length) action.lifecycle.push({status: action.status, at: action.created_at || at, actor: 'engine', note: 'Estado inicial registrado na migração.'});
  return action;
}

function findAction(state, actionId) {
  const action = state.actions.find((candidate) => candidate.action_id === actionId);
  if (!action) throw new Error('ACTION_NOT_FOUND');
  return migrateAction(action);
}

/** Brief/pitch/facts for work that only a human can do (fontes, reputação, conversão). */
function humanPackage(state, action) {
  const prompts = state.prompts.filter((prompt) => action.affected_prompts.includes(prompt.prompt_id))
    .map((prompt) => ({prompt_id: prompt.prompt_id, prompt: prompt.prompt}));
  const facts = state.evidence
    .filter((item) => item.verified === true && item.public_allowed === true && (item.claim || item.value))
    .slice(0, 20)
    .map((item) => ({evidence_id: item.evidence_id, text: item.claim || item.value, source_url: item.source_url || null}));
  return {
    objective: action.description || action.title,
    target_prompts: prompts,
    origin: action.origin || {gap_id: action.gap_id || null},
    brief: {title: action.title, expected_signal: action.expected_signal || null, supporting_sources: asArray(action.supporting_sources)},
    pitch: `Contato humano necessário: ${action.title}. Usar somente fatos verificados anexos; não afirmar nada além das evidências.`,
    facts,
  };
}

function moveToHumanAction(action, state, actor, note) {
  const started = now();
  action.execution = {
    started_at: started, finished_at: started, status: 'NEEDS_HUMAN_ACTION',
    log: [{step: 'human_package', status: 'PREPARED', at: started, detail: 'Brief, pitch e fatos verificados preparados; nenhuma execução automática ocorre.'}],
    package: humanPackage(state, action),
  };
  transition(action, 'NEEDS_HUMAN_ACTION', {actor, note});
}

export async function decideAction(clientId, actionId, {decision, actor, note} = {}) {
  validateClientId(clientId);
  const call = String(decision || '').toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(call)) throw new Error('DECISION_INVALID');
  return withClientLock(clientId, async () => {
    const state = await loadState(clientId);
    const action = findAction(state, actionId);
    if (!['PROPOSED', 'WAITING_APPROVAL'].includes(action.status)) throw new Error(`INVALID_TRANSITION:${action.status}->${call === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`);
    if (call === 'REJECT') {
      transition(action, 'REJECTED', {actor, note: note || 'Rejeitado pelo revisor.'});
    } else if (action.automation_level === 'HUMAN_ACTION') {
      // Contrato §1: PROPOSED → WAITING_APPROVAL → (APPROVE) → NEEDS_HUMAN_ACTION.
      if (action.status === 'PROPOSED') transition(action, 'WAITING_APPROVAL', {actor: 'engine', note: 'Automação limitada: requer ação humana.'});
      moveToHumanAction(action, state, actor, note || 'Aprovado; pacote humano preparado.');
    } else {
      transition(action, 'APPROVED', {actor, note: note || 'Aprovado pelo revisor.'});
    }
    await saveState(clientId, state);
    return {action};
  });
}

const safeDraftPath = (id, slug) => {
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(String(slug || ''))) throw new Error('SLUG_INVALID');
  return path.join(clientDir(id), 'pages/drafts', `${slug}.html`);
};

// Drafts are noindex with a review banner; the published artifact must be
// indexable and clean, otherwise the publication would be invisible by design.
const publishableHtml = (html) => html
  .replace('<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">')
  .replace(/<aside>.*?<\/aside>/, '');

function logStep(action, step, status, detail) {
  action.execution.log.push({step, status, at: now(), detail});
}

function extractValidation(html, draft) {
  const markers = html.split(MISSING).length - 1;
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  const linksOk = hrefs.every((href) => /^(https?:\/\/|\/|#|mailto:)/.test(href));
  let schemaOk = true;
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(match[1]); } catch { schemaOk = false; }
  }
  return {
    evidence_ok: markers === 0,
    missing: markers === 0 ? [] : [...asArray(draft?.brief?.missing_information), `${markers} marcador(es) ${MISSING} no HTML`],
    links_ok: linksOk,
    schema_ok: schemaOk,
  };
}

function buildPreview(draft, config, missingInformation) {
  const metadata = draft.metadata || draft;
  let urlDesired = null;
  try {
    const base = config.publishing?.url_base || new URL('/p', config.domain).href;
    urlDesired = `${String(base).replace(/\/+$/, '')}/${metadata.slug}.html`;
  } catch { urlDesired = null; }
  return {
    page_type: metadata.page_type || 'GUIDE', slug: metadata.slug, url_desired: urlDesired,
    title: draft.title, meta_description: draft.meta_description, h1: draft.h1,
    outline: asArray(draft.outline || draft.h2), faq_count: asArray(draft.faq).length, cta: draft.cta || null,
    schema_types: [draft.structured_data?.['@type']].filter(Boolean),
    internal_links: asArray(draft.internal_links),
    evidence_ids: asArray(metadata.source_evidence_ids),
    missing_information: missingInformation,
  };
}

async function executeContent(clientId, state, action, actor) {
  const config = state.client;
  const existing = state.pages.find((page) => page.action_id === action.action_id);
  let draft = null;
  if (existing?.slug) {
    // O sidecar .json preserva outline/faq do pacote; o registro em state.pages
    // é só metadado. Sem sidecar, cai nos metadados.
    try { draft = JSON.parse(await fs.readFile(path.join(clientDir(clientId), 'pages/drafts', `${existing.slug}.json`), 'utf8')); } catch { draft = null; }
    logStep(action, 'draft', 'REUSED', `Rascunho existente preservado: ${existing.slug}. Edições humanas não são sobrescritas.`);
  } else {
    // createDraft é determinístico: o page_id gerado é o mesmo calculado acima.
    draft = createDraft(config, action, state.evidence, state.prompts);
    const dir = path.join(clientDir(clientId), 'pages/drafts');
    await atomicWrite(path.join(dir, `${draft.slug}.html`), draft.html);
    await atomicWrite(path.join(dir, `${draft.slug}.md`), draft.markdown);
    await atomicWrite(path.join(dir, `${draft.slug}.json`), {...draft, html: undefined, markdown: undefined});
    state.pages = upsert(state.pages, [{...draft.metadata, url: `/clients/${clientId}/pages/drafts/${draft.slug}.html`}], 'page_id', ['status', 'created_at']);
    state.experiments = upsert(state.experiments, [createExperiment(config, action, state.prompts, state.metrics)], 'experiment_id', ['status', 'start_date', 'baseline']);
    logStep(action, 'draft', 'GENERATED', `Pacote de conteúdo evidence-locked em pages/drafts/${draft.slug}.{html,md,json}.`);
  }
  const page = state.pages.find((candidate) => candidate.page_id === (existing?.page_id || draft?.page_id));
  action.execution.page_id = page.page_id;
  transition(action, 'VALIDATING', {actor, note: 'Validando evidências e marcadores do pacote.'});
  const html = await fs.readFile(safeDraftPath(clientId, page.slug), 'utf8');
  const validation = extractValidation(html, draft);
  action.preview = buildPreview(draft || page, config, !validation.evidence_ok);
  action.execution.validation = validation;
  action.execution.finished_at = now();
  logStep(action, 'validation', validation.evidence_ok ? 'OK' : 'MISSING_INFORMATION',
    validation.evidence_ok ? 'HTML sem marcadores; evidências verificadas presentes.' : validation.missing.join('; '));
  if (validation.evidence_ok) {
    action.execution.status = 'READY';
    transition(action, 'READY_TO_PUBLISH', {actor, note: 'Pacote validado; aguardando publicação.'});
  } else {
    action.execution.status = 'NEEDS_INFORMATION';
    transition(action, 'NEEDS_INFORMATION', {actor, note: 'Preencher os marcadores do rascunho e reexecutar.'});
  }
  return validation;
}

function executeTechnical(state, action, actor) {
  const issue = action.origin?.seo_issue_id || action.source_issue_id || null;
  const plan = {
    before: {url: action.affected_urls[0] || action.url || null, observed: action.description || null, issue},
    after: {recommendation: `Corrigir "${action.title}" e validar com novo crawl. Nenhum auto-fix é aplicado fora de um adapter configurado.`},
  };
  logStep(action, 'technical_plan', 'PREPARED', 'Plano before/after gerado; sem alteração automática no site.');
  action.execution.plan = plan;
  transition(action, 'VALIDATING', {actor, note: 'Plano técnico gerado.'});
  const validation = {evidence_ok: true, missing: [], links_ok: true, schema_ok: true};
  action.execution.validation = validation;
  action.execution.finished_at = now();
  action.execution.status = 'READY';
  transition(action, 'READY_TO_PUBLISH', {actor, note: 'Plano técnico pronto; publicação depende de adapter.'});
  return validation;
}

export async function executeAction(clientId, actionId, {actor} = {}) {
  validateClientId(clientId);
  return withClientLock(clientId, async () => {
    const state = await loadState(clientId);
    const action = findAction(state, actionId);
    // Idempotência do contrato: re-executar com pacote pronto retorna o existente.
    if (action.status === 'READY_TO_PUBLISH' && (action.execution?.page_id || action.execution?.plan)) {
      return {action, validation: action.execution.validation || null, idempotent: true};
    }
    if (action.status === 'NEEDS_HUMAN_ACTION') return {action, validation: null, idempotent: true};
    if (action.automation_level === 'HUMAN_ACTION' || HUMAN_TYPES.includes(action.action_type)) {
      if (action.status !== 'APPROVED') throw new Error(`INVALID_TRANSITION:${action.status}->NEEDS_HUMAN_ACTION`);
      moveToHumanAction(action, state, actor, 'Tipo exige execução humana; pacote preparado.');
      await saveState(clientId, state);
      return {action, validation: null};
    }
    if (!['APPROVED', 'NEEDS_INFORMATION', 'FAILED'].includes(action.status)) throw new Error(`INVALID_TRANSITION:${action.status}->EXECUTING`);
    try {
      transition(action, 'EXECUTING', {actor, note: 'Execução iniciada.'});
      action.execution = {started_at: now(), finished_at: null, status: 'EXECUTING', log: [], page_id: null};
      const validation = action.action_type === 'TECHNICAL'
        ? executeTechnical(state, action, actor)
        : await executeContent(clientId, state, action, actor);
      await saveState(clientId, state);
      return {action, validation};
    } catch (error) {
      if (action.status === 'EXECUTING' || action.status === 'VALIDATING') {
        logStep(action, 'error', 'FAILED', redactError(error));
        action.execution.status = 'FAILED';
        action.execution.finished_at = now();
        transition(action, 'FAILED', {actor, note: redactError(error)});
        await saveState(clientId, state);
      }
      throw error;
    }
  });
}

/** Métricas dos affected_prompts por run_type, mesmas fórmulas de aggregateMetrics. */
export function promptSnapshot(state, promptIds, runType, runs) {
  const selected = runs
    .filter((run) => run.run_type === runType && promptIds.includes(run.prompt_id) && run.valid !== false)
    .map((run) => ({...run, competitors: asArray(run.competitors), citations: asArray(run.citations)}));
  const metrics = aggregateMetrics(selected, state.prompts, state.client);
  return {mention: metrics.mention_rate, recommendation: metrics.recommendation_coverage, citation: metrics.citation_rate, runs: metrics.runs};
}

async function defaultFetch(url, timeoutMs) {
  const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: 'follow'});
  return {status: response.status, text: await response.text()};
}

/** Validação de produção: GET na URL esperada, até 3 tentativas com backoff curto. */
async function validateProduction(url, expectedText, fetchImpl) {
  const call = fetchImpl || defaultFetch;
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await call(url, 10_000);
      last = `tentativa ${attempt}: HTTP ${response.status}`;
      if (response.status === 200 && String(response.text).includes(expectedText)) return {ok: true, detail: last};
      last += response.status === 200 ? ' sem o conteúdo esperado' : '';
    } catch (error) { last = `tentativa ${attempt}: ${redactError(error)}`; }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  return {ok: false, detail: last || 'sem resposta'};
}

export async function publishAction(clientId, actionId, {actor, fetch: fetchImpl} = {}) {
  validateClientId(clientId);
  return withClientLock(clientId, async () => {
    const state = await loadState(clientId);
    const action = findAction(state, actionId);
    // Idempotência: publicação já confirmada não é repetida nem duplica commit.
    if (action.status === 'PUBLISHED' && action.deployment?.status === 'PUBLISHED') return {action, deployment: action.deployment, idempotent: true};
    if (!['READY_TO_PUBLISH', 'MONITORING', 'MEASURED'].includes(action.status)) throw new Error(`INVALID_TRANSITION:${action.status}->PUBLISHING`);
    if (action.status !== 'READY_TO_PUBLISH') return {action, deployment: action.deployment, idempotent: true};
    const config = state.client;
    const adapter = getAdapter(config);
    const blocked = async (note) => {
      action.deployment = {...action.deployment, adapter: config.publishing?.adapter || null, status: 'BLOCKED_NO_ACCESS', note};
      await saveState(clientId, state);
      return {action, deployment: action.deployment};
    };
    if (!adapter) return blocked('config.publishing ausente ou adapter desconhecido. Configure publishing.adapter git_static com repo_path, base_path, url_base e branch_prefix. Nenhuma publicação foi simulada.');
    const check = await adapter.check(config);
    if (!check.ok) return blocked(`Adapter ${adapter.type} sem acesso: ${check.detail}. Nenhuma publicação foi simulada.`);
    const page = state.pages.find((candidate) => candidate.page_id === action.execution?.page_id);
    if (!page?.slug) return blocked('Nenhum artefato publicável (página) associado à execução. Ações sem pacote de conteúdo exigem intervenção humana ou adapter específico.');
    // Baseline salvo ANTES de publicar; uma vez gravado, nunca é recalculado.
    if (!action.deployment?.baseline_snapshot) {
      action.deployment = {...action.deployment, baseline_snapshot: Object.fromEntries(['LAB', 'GOLDEN'].map((type) => [type, promptSnapshot(state, action.affected_prompts, type, state.ai_runs)]))};
    }
    const html = publishableHtml(await fs.readFile(safeDraftPath(clientId, page.slug), 'utf8'));
    transition(action, 'PUBLISHING', {actor, note: `Publicando via ${adapter.type}.`});
    let result;
    try {
      result = await adapter.publish({page, html, action, config});
    } catch (error) {
      transition(action, 'READY_TO_PUBLISH', {actor, note: 'Deploy abortado antes da escrita; permanece pronto.'});
      return blocked(`Publicação bloqueada: ${redactError(error)}.`);
    }
    action.deployment = {...action.deployment, adapter: adapter.type, repo_path: config.publishing.repo_path, branch: result.branch, commit: result.commit, url: result.url, rollback: result.rollback, pushed: result.pushed === true, status: 'VALIDATING_PRODUCTION'};
    const validation = await validateProduction(result.url, page.title || page.slug, fetchImpl);
    if (!validation.ok) {
      // Sem confirmação em produção não há PUBLISHED: o commit existe, mas o
      // deploy pode estar pendente (ex.: auto_push false, build não executado).
      action.deployment.status = 'DEPLOY_PENDING_VALIDATION';
      action.deployment.note = `Escrita registrada (branch ${result.branch}, commit ${result.commit}), mas a validação de produção falhou: ${validation.detail}. Reexecute publish após o deploy real.`;
      transition(action, 'READY_TO_PUBLISH', {actor, note: 'Aguardando validação de produção (DEPLOY_PENDING_VALIDATION).'});
      await saveState(clientId, state);
      return {action, deployment: action.deployment};
    }
    action.deployment.status = 'PUBLISHED';
    action.deployment.published_at = now();
    action.deployment.production_validation = validation.detail;
    transition(action, 'PUBLISHED', {actor, note: `Validação de produção OK: ${validation.detail}. Monitoramento inicia no próximo MONITOR.`});
    // Espelha o registro de publicação da página (mesma disciplina de setPageStatus).
    const stripWww = (host) => host.toLowerCase().replace(/^www\./, '');
    if (stripWww(new URL(result.url).hostname) !== stripWww(new URL(config.domain).hostname)) throw new Error('PUBLISHED_URL_MUST_BELONG_TO_CLIENT');
    page.status = 'PUBLISHED';
    page.url = result.url;
    page.published_at = action.deployment.published_at;
    await atomicWrite(path.join(clientDir(clientId), 'pages/published', `${page.slug}.html`), html);
    await saveState(clientId, state);
    return {action, deployment: action.deployment};
  });
}

// V1 heuristic: soma dos deltas não nulos (mention/recommendation/citation).
// > 0 sinal positivo, < 0 negativo, 0 ou indisponível neutro. Documentado, não causal.
function classifyResult(baseline, current) {
  const deltas = {};
  let sum = 0, known = 0;
  for (const key of ['mention', 'recommendation', 'citation']) {
    const before = baseline?.[key], after = current[key];
    deltas[key] = before != null && after != null ? after - before : null;
    if (deltas[key] !== null) { sum += deltas[key]; known += 1; }
  }
  return {deltas, result_status: !known ? 'NEUTRAL' : sum > 0 ? 'POSITIVE_SIGNAL' : sum < 0 ? 'NEGATIVE_SIGNAL' : 'NEUTRAL'};
}

/**
 * Stage MONITOR: mede actions PUBLISHED|MONITORING|MEASURED contra o baseline
 * salvo na publicação. Idempotente por result_id determinístico (dia + janela).
 */
export function measureActions(state, at = new Date()) {
  state.action_results = asArray(state.action_results);
  let measured = 0;
  for (const action of state.actions) {
    migrateAction(action, at.toISOString());
    if (!['PUBLISHED', 'MONITORING', 'MEASURED'].includes(action.status)) continue;
    const publishedAt = action.deployment?.published_at;
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;
    if (action.status === 'PUBLISHED') transition(action, 'MONITORING', {actor: 'engine', note: 'Primeiro MONITOR após publicação.', at: at.toISOString()});
    const elapsedDays = (at.getTime() - Date.parse(publishedAt)) / DAY_MS;
    const window = elapsedDays < 1 ? null : WINDOWS.filter(([, days]) => elapsedDays >= days).at(-1)[0];
    const runType = action.run_type || 'GOLDEN';
    const baseline = action.deployment?.baseline_snapshot?.[runType] || null;
    // Current: somente runs do mesmo run_type, dos prompts afetados, posteriores
    // à publicação. LAB e GOLDEN nunca são combinados.
    const currentRuns = state.ai_runs.filter((run) => run.run_type === runType
      && action.affected_prompts.includes(run.prompt_id) && run.valid !== false
      && run.timestamp && Date.parse(run.timestamp) >= Date.parse(publishedAt));
    const current = promptSnapshot(state, action.affected_prompts, runType, currentRuns);
    let resultStatus, deltas = {mention: null, recommendation: null, citation: null}, notes = '';
    if (!window) {
      resultStatus = 'TOO_EARLY';
      notes = 'Janela D1 ainda não atingida desde a publicação.';
    } else if (current.runs < 2) {
      resultStatus = 'INSUFFICIENT_DATA';
      notes = `${current.runs} run(s) ${runType} posterior(es) à publicação; mínimo de 2 para medir.`;
    } else {
      const classified = classifyResult(baseline, current);
      deltas = classified.deltas;
      resultStatus = classified.result_status;
      notes = baseline ? 'Comparação com o baseline salvo na publicação; associação observada, não causalidade.' : 'Baseline indisponível; deltas nulos e resultado neutro.';
    }
    const result = {
      result_id: stableId('res', [action.action_id, window || 'D1', at.toISOString().slice(0, 10)]),
      action_id: action.action_id, client_id: state.client.client_id, measured_at: at.toISOString(),
      window: window || 'D1', baseline, current, deltas, result_status: resultStatus, notes,
    };
    state.action_results = upsert(state.action_results, [result], 'result_id');
    measured += 1;
    if (action.status === 'MONITORING' && !['TOO_EARLY', 'INSUFFICIENT_DATA'].includes(resultStatus)) {
      transition(action, 'MEASURED', {actor: 'engine', note: `Primeira medição com dados (${result.window}: ${resultStatus}).`, at: at.toISOString()});
    }
  }
  return measured;
}
