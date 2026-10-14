import { Actor, HttpError, canOperate, permitsClient } from './security';
import { goldenPlatforms } from './validation';

export type GoldenEnginePost = (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
export interface GoldenDb {
  client: { findUnique(args: any): Promise<any> };
  systemEvent: { create(args: any): Promise<any> };
}
export interface GoldenImportInput {
  platform: string;
  promptExternalId: string;
  response: string;
  timestamp: string;
}
interface GoldenImportDeps {
  actor: Actor | null;
  clientId: string;
  db: GoldenDb;
  enginePost: GoldenEnginePost;
  input: GoldenImportInput;
  sync?: (client: { engineClientId: string; organizationId: string }) => Promise<void>;
}

export async function importGoldenTest({ actor, clientId, db, enginePost, input, sync }: GoldenImportDeps) {
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  if (!canOperate(actor)) throw new HttpError(403, 'Você não tem permissão para esta ação.', 'FORBIDDEN');
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true, engineClientId: true } });
  if (!client || !permitsClient(actor, client)) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
  const record = {
    platform: input.platform,
    prompt_id: input.promptExternalId,
    response: input.response,
    timestamp: new Date(input.timestamp).toISOString(),
    capture_method: 'MANAGER_FORM',
  };
  const result = await enginePost(`/v1/import/${client.engineClientId}/golden`, [record], 60_000);
  const imported = typeof result?.imported === 'number' ? result.imported : 0;
  const total = typeof result?.total === 'number' ? result.total : null;
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'MANAGER', message: 'Teste GOLDEN importado', metadata: { platform: input.platform, promptExternalId: input.promptExternalId, imported } as any } });
  await sync?.(client);
  return { imported, total };
}

export interface GoldenChecklistItem {
  promptId: string;
  externalId: string;
  prompt: string;
  cluster: string;
  commercialScore: number | null;
  priority: string;
  collectedPlatforms: string[];
  collected: boolean;
}
type ChecklistPrompt = { id: string; externalId: string; prompt: string; cluster: string; commercialScore: number | null; priority: string; active: boolean };
type ChecklistRun = { promptId: string | null; platform: string; runType: string };

export function buildGoldenChecklist(prompts: ChecklistPrompt[], runs: ChecklistRun[]): GoldenChecklistItem[] {
  const collected = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.runType !== 'GOLDEN' || !run.promptId) continue;
    if (!goldenPlatforms.includes(run.platform as any)) continue;
    const set = collected.get(run.promptId) || new Set<string>();
    set.add(run.platform);
    collected.set(run.promptId, set);
  }
  return prompts
    .filter(p => p.active && ['P4', 'P5'].includes(p.priority))
    .map(p => {
      const collectedPlatforms = goldenPlatforms.filter(platform => collected.get(p.id)?.has(platform));
      return { promptId: p.id, externalId: p.externalId, prompt: p.prompt, cluster: p.cluster, commercialScore: p.commercialScore, priority: p.priority, collectedPlatforms, collected: collectedPlatforms.length > 0 };
    })
    .sort((a, b) => (b.commercialScore ?? -Infinity) - (a.commercialScore ?? -Infinity));
}
