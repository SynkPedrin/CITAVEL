import 'server-only';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after } from 'next/server';
import { db } from './db';
import { syncEngineClient } from './sync';
import { Actor, HttpError } from './security';
import { engineStages, summarizeStage, finalRunStatus, type StageResult } from './run-state';

async function event(clientId: string, source: string, message: string, metadata: Record<string, unknown>, actorId?: string) {
  return db.systemEvent.create({ data: { clientId, actorId, source, message, metadata: metadata as any } });
}

type ProvisionInput = { clientKey: string; name: string; brandName: string; domain: string; industry: string; location: string; priorityServices?: string[]; market?: string; goals?: string[] };

async function ensureEngineClient(input: ProvisionInput) {
  const engineRoot = process.env.CITAVEL_ENGINE_PATH || '/Users/pedro/Documents/CITAVEL/citavel-engine';
  const store = await import(/* webpackIgnore: true */ pathToFileURL(path.join(engineRoot, 'core/store.mjs')).href);
  try { await store.loadConfig(input.clientKey); return; } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  await store.createClient(input.clientKey, {
    brand: input.brandName, domain: input.domain.includes('://') ? input.domain : `https://${input.domain}`,
    market: input.industry, locations: [input.location], priority_services: input.priorityServices || [],
    google: { sheets_spreadsheet_id: null, search_console_property: null, ga4_property_id: null, gtm_account_id: null, gtm_container_id: null },
    automation: { baseline_enabled: true, weekly_monitoring: true, auto_publish: false, lab_sample_size: 4, crawl_max_pages: 8 },
  });
}

async function executeStage(engineClientId: string, mode: string, stage: string, batchId: string): Promise<StageResult> {
  const engine = (process.env.CITAVEL_ENGINE_URL || 'http://localhost:8788').replace(/\/$/, '');
  const response = await fetch(`${engine}/v1/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    signal: AbortSignal.timeout(15 * 60 * 1000),
    body: JSON.stringify({ client_id: engineClientId, mode, stage, batch_id: batchId }),
  });
  if (!response.ok) throw new Error('ENGINE_STAGE_REQUEST_FAILED');
  return summarizeStage(await response.json(), engineClientId, stage);
}

async function processRun(runId: string, clientId: string, automationId: string, engineClientId: string, organizationId: string, mode: string, actorId: string, onStage?: (stage: StageResult) => Promise<void>) {
  const started = Date.now();
  const stages: StageResult[] = [];
  try {
    await db.automationRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), summary: { transport: 'ENGINE', stages: [] } } });
    await event(clientId, 'ENGINE', 'Execução iniciada no Engine local', { run_id: runId, mode }, actorId);
    for (const stage of engineStages(mode)) {
      await event(clientId, 'ENGINE', 'Etapa iniciada', { run_id: runId, stage, status: 'RUNNING' }, actorId);
      const result = await executeStage(engineClientId, mode, stage, `manager-${runId}`);
      stages.push(result);
      await db.automationRun.update({ where: { id: runId }, data: { summary: { transport: 'ENGINE', stage, stages: stages as any } } });
      await event(clientId, 'ENGINE', 'Etapa finalizada', { run_id: runId, ...result }, actorId);
      await onStage?.(result);
    }
    await syncEngineClient(engineClientId, organizationId);
    const status = finalRunStatus(stages);
    await db.automationRun.update({ where: { id: runId }, data: {
      status, finishedAt: new Date(), durationMs: Date.now() - started,
      errorMessage: status === 'SUCCESS' ? null : 'Uma ou mais etapas precisam de atenção. Verifique as integrações e o histórico da operação.',
      summary: { transport: 'ENGINE', stages: stages as any, synced: true },
    } });
    await db.automation.update({ where: { id: automationId }, data: { lastRunAt: new Date(), status: status === 'SUCCESS' ? 'CONNECTED' : 'DEGRADED' } });
    await event(clientId, 'ENGINE', status === 'SUCCESS' ? 'Execução concluída e dados sincronizados' : 'Execução concluída com pendências', { run_id: runId, status }, actorId);
    return status;
  } catch {
    await db.automationRun.update({ where: { id: runId }, data: {
      status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - started,
      errorMessage: 'Não foi possível confirmar o resultado do ciclo. Verifique a conexão com o Engine antes de tentar novamente.',
      summary: { transport: 'ENGINE', stages: stages as any },
    } }).catch(() => {});
    await event(clientId, 'ENGINE', 'Execução interrompida; resultado não confirmado', { run_id: runId, status: 'FAILED' }, actorId).catch(() => {});
    return 'FAILED';
  }
}

export async function enqueueRun(clientId: string, mode: string, actorId: string) {
  engineStages(mode);
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new HttpError(404, 'Cliente não encontrado.');
  if (client.status === 'PAUSED') throw new HttpError(409, 'Retome a operação do cliente antes de executar um ciclo.');
  const automation = await db.automation.findFirst({ where: { clientId, enabled: true }, orderBy: { id: 'asc' } });
  if (!automation) throw new HttpError(409, 'A automação deste cliente ainda precisa ser configurada.');
  const queued = await db.$transaction(async tx => {
    // Serialize submissions for one client, including requests from different tabs.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${clientId}))`;
    const existing = await tx.automationRun.findFirst({ where: { clientId, status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
    if (existing) return { run: existing, created: false };
    return { run: await tx.automationRun.create({ data: { clientId, automationId: automation.id, status: 'QUEUED', mode, summary: { transport: 'ENGINE' } } }), created: true };
  });
  if (queued.created) {
    await event(clientId, 'MANAGER', 'Execução colocada na fila', { run_id: queued.run.id, mode }, actorId);
    after(() => processRun(queued.run.id, clientId, automation.id, client.engineClientId, client.organizationId, mode, actorId).then(() => {}));
  }
  return { runId: queued.run.id, status: queued.run.status, existing: !queued.created };
}

export async function enqueueProvision(input: ProvisionInput, actor: Actor) {
  const org = await db.organization.findUnique({ where: { id: actor.organizationId } });
  if (!org) throw new Error('ORGANIZATION_NOT_FOUND');
  const client = await db.client.create({ data: {
    organizationId: org.id, clientKey: input.clientKey, name: input.name, brandName: input.brandName, domain: input.domain,
    industry: input.industry, location: input.location, status: 'PROVISIONING', engineClientId: input.clientKey,
    metadata: { wizard: { priorityServices: input.priorityServices || [], market: input.market || '', goals: input.goals || [] } },
  } });
  const progress = (step: string, status: string) => event(client.id, 'PROVISIONING', step, { step, status }, actor.id);
  await progress('CLIENT_CREATED', 'SUCCESS');
  after(async () => {
    try {
      await progress('ENGINE_CONFIGURED', 'RUNNING');
      await ensureEngineClient(input);
      await progress('ENGINE_CONFIGURED', 'SUCCESS');
      const automation = await db.automation.create({ data: { clientId: client.id, externalId: `engine-${input.clientKey}`, externalWorkflowId: input.clientKey, provider: 'ENGINE', name: `CITÁVEL CLIENT — ${input.brandName}`, status: 'CONNECTED', metadata: { transport: 'ENGINE' } } });
      await progress('AUTOMATION_CONNECTED', 'SUCCESS');
      const run = await db.automationRun.create({ data: { clientId: client.id, automationId: automation.id, mode: 'ONBOARDING', status: 'QUEUED' } });
      await progress('SITE_ANALYZED', 'RUNNING');
      let ingestStatus = 'RUNNING';
      const status = await processRun(run.id, client.id, automation.id, input.clientKey, org.id, 'ONBOARDING', actor.id, async stage => {
        if (stage.stage === 'INGEST') ingestStatus = stage.status;
        if (stage.stage === 'AUDIT') {
          await progress('SITE_ANALYZED', stage.status === 'SUCCESS' && ingestStatus === 'SUCCESS' && (stage.counts.pages || 0) > 0 ? 'SUCCESS' : 'PARTIAL');
          await progress('PROMPTS_PREPARED', 'RUNNING');
        }
        if (stage.stage === 'DEMAND') {
          await progress('PROMPTS_PREPARED', stage.status === 'SUCCESS' && (stage.counts.prompts || 0) > 0 ? 'SUCCESS' : 'PARTIAL');
          await progress('BASELINE_STARTED', 'RUNNING');
        }
        if (stage.stage === 'INTELLIGENCE') await progress('BASELINE_STARTED', stage.status === 'SUCCESS' && (stage.counts.ai_runs || 0) > 0 ? 'SUCCESS' : 'PARTIAL');
      });
      if (status === 'FAILED') throw new Error('ONBOARDING_FAILED');
      await db.client.update({ where: { id: client.id }, data: { status: 'PARTIALLY_READY' } });
      await progress('OPERATION_ACTIVE', status === 'SUCCESS' ? 'SUCCESS' : 'PARTIAL');
    } catch {
      await db.client.update({ where: { id: client.id }, data: { status: 'ERROR' } }).catch(() => {});
      await progress('PROVISIONING_FAILED', 'FAILED').catch(() => {});
    }
  });
  return client;
}

export async function pauseClient(clientId: string, paused: boolean, actorId: string) {
  const client = await db.client.update({ where: { id: clientId }, data: { status: paused ? 'PAUSED' : 'PARTIALLY_READY' } });
  await db.automation.updateMany({ where: { clientId }, data: { enabled: !paused } });
  await event(clientId, 'MANAGER', paused ? 'WORKFLOW_PAUSED' : 'WORKFLOW_RESUMED', {}, actorId);
  return client;
}
