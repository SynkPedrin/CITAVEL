import { Actor, HttpError, appOrigin, assertMutation, canOperate, permitsClient } from './security';
import { stripPrivatePaths } from './redact';

export function guardActionMutation(request: Request, expectedOrigin = appOrigin()) {
  assertMutation(request, expectedOrigin);
}

export type EnginePost = (path: string, body: unknown, timeoutMs?: number) => Promise<any>;

export function engineBaseUrl() {
  return (process.env.CITAVEL_ENGINE_URL || 'http://localhost:8788').replace(/\/+$/, '');
}

export function createEnginePost(baseUrl = engineBaseUrl()): EnginePost {
  return async (path, body, timeoutMs = 120_000) => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(body),
      });
    } catch (error) {
      throw new HttpError(502, `Engine indisponível em ${baseUrl} (${error instanceof Error ? error.message : 'falha de conexão'}).`, 'ENGINE_OFFLINE');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof payload?.error === 'string' ? payload.error : 'ENGINE_ERROR';
      throw new HttpError(502, `Engine respondeu HTTP ${response.status}: ${code}.`, code);
    }
    return payload;
  };
}

export interface ActionDecisionDb {
  action: { findUnique(args: any): Promise<any> };
  systemEvent: { create(args: any): Promise<any> };
}
interface DecisionDeps {
  actor: Actor | null;
  actionId: string;
  db: ActionDecisionDb;
  enginePost: EnginePost;
  sync?: () => Promise<void>;
}

async function loadAuthorizedAction(deps: DecisionDeps) {
  const { actor, db, actionId } = deps;
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  if (!canOperate(actor)) throw new HttpError(403, 'Você não tem permissão para esta ação.', 'FORBIDDEN');
  const action = await db.action.findUnique({ where: { id: actionId }, include: { client: { select: { id: true, organizationId: true, engineClientId: true } } } });
  if (!action) throw new HttpError(404, 'Ação não encontrada.', 'NOT_FOUND');
  if (!permitsClient(actor, action.client)) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
  return { actor, action };
}

function stepError(step: string, state: string | undefined, error: unknown): HttpError {
  const e = error instanceof HttpError ? error : new HttpError(502, 'Falha inesperada ao falar com o Engine.', 'ENGINE_ERROR');
  return new HttpError(e.status, `Etapa ${step} não concluída (estado atual: ${state || 'desconhecido'}). ${e.message}`, e.code);
}

export async function approveAction(deps: DecisionDeps) {
  const { db, enginePost, sync } = deps;
  const { actor, action } = await loadAuthorizedAction(deps);
  const base = `/v1/actions/${action.client.engineClientId}/${action.externalId}`;
  const event = (message: string, metadata: Record<string, unknown>) =>
    db.systemEvent.create({ data: { clientId: action.clientId, actorId: actor.id, source: 'MANAGER', message, metadata: metadata as any } });
  const auditFailure = (step: string, state: string, error: unknown) =>
    event(`Falha na etapa ${step} da ação`, { action_id: action.id, external_id: action.externalId, step, state, error: error instanceof Error ? error.message : String(error) }).catch(() => {});

  let state: string = action.status;
  let decided: any;
  try { decided = await enginePost(`${base}/decide`, { decision: 'APPROVE', actor: actor.email }, 30_000); }
  catch (error) { await auditFailure('APPROVE', state, error); throw stepError('APPROVE', state, error); }
  state = decided?.action?.status || 'APPROVED';
  await event('Ação aprovada', { action_id: action.id, external_id: action.externalId, from: action.status, to: state });

  let executed: any;
  try { executed = await enginePost(`${base}/execute`, { actor: actor.email }, 120_000); }
  catch (error) { await auditFailure('EXECUTE', state, error); throw stepError('EXECUTE', state, error); }
  state = executed?.action?.status || state;
  const validation = executed?.validation ?? null;
  await event(state === 'READY_TO_PUBLISH' ? 'Execução concluída; pronta para publicar' : `Execução concluída com estado ${state}`, {
    action_id: action.id, external_id: action.externalId, to: state,
    ...(Array.isArray(validation?.missing) && validation.missing.length ? { missing: validation.missing } : {}),
  });

  let published: any = null;
  if (state === 'READY_TO_PUBLISH') {
    try { published = await enginePost(`${base}/publish`, { actor: actor.email }, 120_000); }
    catch (error) { await auditFailure('PUBLISH', state, error); throw stepError('PUBLISH', state, error); }
    state = published?.action?.status || state;
    const dep = published?.deployment ?? published?.action?.deployment ?? null;
    await event(dep?.url ? 'Conteúdo publicado' : `Publicação não concluída (${dep?.status || state})`, {
      action_id: action.id, external_id: action.externalId, to: state,
      deployment_status: dep?.status || null, url: dep?.url || null, commit: dep?.commit || null,
    });
  }
  await sync?.();
  const finalAction = published?.action ?? executed?.action ?? decided?.action ?? null;
  const deployment = published?.deployment ?? finalAction?.deployment ?? null;
  return { status: state, validation, deployment: stripPrivatePaths(deployment), action: stripPrivatePaths(finalAction) };
}

export async function rejectAction(deps: DecisionDeps & { note?: string }) {
  const { db, enginePost, sync, note } = deps;
  const { actor, action } = await loadAuthorizedAction(deps);
  const base = `/v1/actions/${action.client.engineClientId}/${action.externalId}`;
  let decided: any;
  try { decided = await enginePost(`${base}/decide`, { decision: 'REJECT', actor: actor.email, ...(note ? { note } : {}) }, 30_000); }
  catch (error) {
    await db.systemEvent.create({ data: { clientId: action.clientId, actorId: actor.id, source: 'MANAGER', message: 'Falha na etapa REJECT da ação', metadata: { action_id: action.id, external_id: action.externalId, step: 'REJECT', state: action.status, error: error instanceof Error ? error.message : String(error) } as any } }).catch(() => {});
    throw stepError('REJECT', action.status, error);
  }
  const state: string = decided?.action?.status || 'REJECTED';
  await db.systemEvent.create({ data: { clientId: action.clientId, actorId: actor.id, source: 'MANAGER', message: 'Ação rejeitada', metadata: { action_id: action.id, external_id: action.externalId, from: action.status, to: state, ...(note ? { note } : {}) } as any } });
  await sync?.();
  return { status: state, action: stripPrivatePaths(decided?.action ?? null) };
}
