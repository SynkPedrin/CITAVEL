import { after } from 'next/server';
import { requireOperator, requireSession, assertClient, assertRequestMutation } from '@/lib/auth';
import { HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { enqueueSync, runPendingJobs } from '@/lib/gsc/sync';
import { ok, fail } from '../../../../_utils';
export const dynamic = 'force-dynamic';
// "Atualizar dados" inside a client: refreshes every active Search Console binding of THIS client now.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    rateLimit(`client-sync:${id}`, 3, 120_000);
    const bindings = await db.clientPropertyBinding.findMany({ where: { clientId: id, status: 'ACTIVE' }, include: { property: { include: { connection: true } } } });
    if (!bindings.length) throw new HttpError(409, 'Este cliente ainda não tem propriedade do Google vinculada.', 'NOT_BOUND');
    const usable = bindings.filter(b => b.property.accessible && b.property.connection.status === 'CONNECTED');
    if (!usable.length) throw new HttpError(409, 'A conexão com o Google precisa ser reautorizada em Configurações → Integrações.', 'GOOGLE_NOT_CONNECTED');
    const jobs = [];
    for (const b of usable) {
      const done = await db.gscSyncJob.count({ where: { bindingId: b.id, type: 'GSC_INITIAL_SYNC', status: { in: ['SUCCESS', 'PARTIAL'] } } });
      const r = await enqueueSync(b.id, done ? 'GSC_MANUAL_SYNC' : 'GSC_INITIAL_SYNC', 'CLIENT_BUTTON', actor.id);
      jobs.push(r.job.id);
    }
    await db.systemEvent.create({ data: { clientId: id, actorId: actor.id, source: 'GOOGLE_HUB', message: 'GSC_MANUAL_REFRESH', metadata: { jobs } } });
    after(async () => { await runPendingJobs({ organizationId: actor.organizationId }).catch(() => {}); });
    return ok({ jobs }, 202);
  } catch (e) { return fail(e); }
}
// Progress of this client's most recent sync jobs (for the button).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(); const { id } = await params; await assertClient(actor, id);
    const ids = new URL(request.url).searchParams.get('jobs')?.split(',').filter(Boolean).slice(0, 10) || [];
    const jobs = await db.gscSyncJob.findMany({ where: { clientId: id, ...(ids.length ? { id: { in: ids } } : {}) }, orderBy: { createdAt: 'desc' }, take: ids.length || 1, select: { id: true, status: true, errorDetail: true, finishedAt: true, availableEndDate: true } });
    return ok({ jobs });
  } catch (e) { return fail(e); }
}
