import { z } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson } from '@/lib/security';
import { setArchived } from '@/lib/ai-measurement/service';
import { ok, fail } from '../../../../../_utils';
export async function POST(request: Request, { params }: { params: Promise<{ id: string; measurementId: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id, measurementId } = await params; await assertClient(actor, id);
    const { archived } = z.object({ archived: z.boolean() }).strict().parse(await readJson(request));
    await setArchived(id, measurementId, actor, archived); return ok({ ok: true });
  } catch (e) { return fail(e); }
}
