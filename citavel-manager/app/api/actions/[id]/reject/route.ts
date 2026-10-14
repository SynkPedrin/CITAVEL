import { db } from '@/lib/db';
import { requireOperator } from '@/lib/auth';
import { readJson } from '@/lib/security';
import { actionRejectSchema } from '@/lib/validation';
import { ok, fail } from '../../../_utils';
import { createEnginePost, guardActionMutation, rejectAction } from '@/lib/action-decisions';
import { syncEngineClient } from '@/lib/sync';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    guardActionMutation(request);
    const actor = await requireOperator();
    const { id } = await params;
    const body = actionRejectSchema.parse(await readJson(request));
    const sync = async () => {
      const action = await db.action.findUnique({ where: { id }, select: { client: { select: { engineClientId: true, organizationId: true } } } });
      if (action) await syncEngineClient(action.client.engineClientId, action.client.organizationId);
    };
    const result = await rejectAction({ actor, actionId: id, note: body.note, db, enginePost: createEnginePost(), sync });
    return ok(result);
  } catch (error) { return fail(error); }
}
