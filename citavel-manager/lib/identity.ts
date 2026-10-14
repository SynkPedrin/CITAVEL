import { Actor, HttpError, canOperate, permitsClient } from './security';
import type { EnginePost } from './action-decisions';

export interface IdentityDb {
  client: { findUnique(args: any): Promise<any> };
  systemEvent: { create(args: any): Promise<any> };
}
interface IdentityDeps {
  actor: Actor | null;
  clientId: string;
  db: IdentityDb;
  enginePost: EnginePost;
  decision: 'confirm' | 'reject';
  corrections?: { description?: string; tagline?: string; official_domain?: string };
  sync?: (client: { engineClientId: string; organizationId: string }) => Promise<void>;
}

export async function decideIdentity({ actor, clientId, db, enginePost, decision, corrections, sync }: IdentityDeps) {
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  if (!canOperate(actor)) throw new HttpError(403, 'Você não tem permissão para esta ação.', 'FORBIDDEN');
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true, engineClientId: true } });
  if (!client || !permitsClient(actor, client)) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
  const result = await enginePost(`/v1/discover/${client.engineClientId}/confirm`, {
    actor: actor.email,
    decision,
    ...(corrections ? { corrections } : {}),
  }, 60_000);
  const status = result?.brand_identity?.status ?? result?.status ?? null;
  await db.systemEvent.create({ data: {
    clientId, actorId: actor.id, source: 'MANAGER',
    message: decision === 'confirm' ? 'Identidade da marca confirmada' : 'Identidade da marca rejeitada',
    metadata: { decision, status, ...(corrections ? { corrections } : {}) } as any,
  } });
  await sync?.(client);
  return { status };
}
