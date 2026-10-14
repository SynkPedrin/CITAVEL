import { db } from '@/lib/db';
import { requireOperator } from '@/lib/auth';
import { ok, fail } from '../../../_utils';
import { approveAction, createEnginePost, guardActionMutation } from '@/lib/action-decisions';
import { syncEngineClient } from '@/lib/sync';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    guardActionMutation(request);
    const actor = await requireOperator();
    const { id } = await params;
    const sync = async () => {
      const action = await db.action.findUnique({ where: { id }, select: { client: { select: { engineClientId: true, organizationId: true } } } });
      if (action) await syncEngineClient(action.client.engineClientId, action.client.organizationId);
    };
    const result = await approveAction({ actor, actionId: id, db, enginePost: createEnginePost(), sync });
    return ok(result);
  } catch (error) { return fail(error); }
}
