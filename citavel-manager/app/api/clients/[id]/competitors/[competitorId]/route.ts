import { ZodError } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { updateCompetitor, deleteCompetitor } from '@/lib/competitive/service';
import { ok, fail } from '../../../../_utils';
type P = { params: Promise<{ id: string; competitorId: string }> };
export async function PATCH(request: Request, { params }: P) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id, competitorId } = await params; await assertClient(actor, id); rateLimit(`competitor:${actor.id}`, 60);
    await updateCompetitor(id, competitorId, actor, await readJson(request, 8_000)); return ok({ ok: true });
  } catch (e) { return fail(e instanceof ZodError ? new HttpError(400, 'Dados do concorrente inválidos.', 'INVALID_INPUT') : e); }
}
export async function DELETE(request: Request, { params }: P) {
  try { assertRequestMutation(request); const actor = await requireOperator(); const { id, competitorId } = await params; await assertClient(actor, id); await deleteCompetitor(id, competitorId, actor); return ok({ ok: true }); } catch (e) { return fail(e); }
}
