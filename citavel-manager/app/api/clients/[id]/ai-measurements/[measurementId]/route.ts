import { ZodError } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { updateMeasurement } from '@/lib/ai-measurement/service';
import { ok, fail } from '../../../../_utils';
// Editing never overwrites: the previous state is stored as a revision and the version is incremented.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; measurementId: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id, measurementId } = await params; await assertClient(actor, id);
    rateLimit(`import:${actor.id}`, 20);
    const m = await updateMeasurement(id, measurementId, actor, await readJson(request, 1_000_000));
    return ok({ id: m.id, version: m.version });
  } catch (e) { return fail(e instanceof ZodError ? new HttpError(400, `Revise os campos: ${e.issues.slice(0, 3).map(i => i.path.join('.') + ' (' + i.message + ')').join('; ')}.`, 'INVALID_INPUT') : e); }
}
