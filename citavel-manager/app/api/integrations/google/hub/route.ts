import { after } from 'next/server';
import { z } from 'zod';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { hubOverview, discoverProperties, disconnect, bindProperty, unbindProperty, setPrimary, createDraftClient } from '@/lib/gsc/connection';
import { enqueueSync, runJob } from '@/lib/gsc/sync';
import { GscApiError } from '@/lib/gsc/api';
import { db } from '@/lib/db';
import { ok, fail } from '../../../_utils';
export const dynamic = 'force-dynamic';
const id = z.string().min(1).max(128);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('discover') }).strict(),
  z.object({ action: z.literal('disconnect'), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('bind'), propertyId: id, clientId: id, confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('draftClient'), name: z.string().trim().min(2).max(120), domain: z.string().trim().max(300) }).strict(),
  z.object({ action: z.literal('unbind'), bindingId: id, purgeData: z.boolean().default(false), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal('primary'), bindingId: id }).strict(),
  z.object({ action: z.literal('sync'), bindingId: id, type: z.enum(['GSC_MANUAL_SYNC', 'GSC_INITIAL_SYNC']).default('GSC_MANUAL_SYNC') }).strict(),
]);
export async function GET() { try { const actor = await requireAdmin(); return ok(await hubOverview(actor.organizationId)); } catch (e) { return fail(e); } }
export async function POST(request: Request) {
  try {
    assertRequestMutation(request); const actor = await requireAdmin(); const body = schema.parse(await readJson(request));
    const queue = async (bindingId: string, type: 'GSC_INITIAL_SYNC' | 'GSC_MANUAL_SYNC') => {
      const b = await db.clientPropertyBinding.findUnique({ where: { id: bindingId }, include: { client: { select: { organizationId: true } } } });
      if (!b || b.client.organizationId !== actor.organizationId) throw new HttpError(404, 'Vínculo não encontrado.', 'BINDING_NOT_FOUND');
      const r = await enqueueSync(bindingId, type, 'MANAGER', actor.id);
      if (r.created) after(() => runJob(r.job.id).then(() => {}));
      return { jobId: r.job.id, status: r.job.status, existing: !r.created };
    };
    switch (body.action) {
      case 'discover': try { return ok({ properties: await discoverProperties(actor.organizationId) }); } catch (e) { if (e instanceof GscApiError) throw new HttpError(e.status === 401 ? 401 : 502, e.message, e.code); throw e; }
      case 'disconnect': return ok(await disconnect(actor.organizationId, actor.id));
      case 'bind': { const binding = await bindProperty(actor, body.propertyId, body.clientId); return ok({ bindingId: binding.id, job: await queue(binding.id, 'GSC_INITIAL_SYNC') }, 202); }
      case 'draftClient': { const c = await createDraftClient(actor, body); return ok({ clientId: c.id, name: c.name, status: c.status }); }
      case 'unbind': await unbindProperty(actor, body.bindingId, body.purgeData); return ok({ ok: true });
      case 'primary': await setPrimary(actor, body.bindingId); return ok({ ok: true });
      case 'sync': return ok(await queue(body.bindingId, body.type), 202);
    }
  } catch (e) { return fail(e instanceof z.ZodError ? new HttpError(400, 'Dados inválidos ou confirmação ausente.', 'INVALID_INPUT') : e); }
}
