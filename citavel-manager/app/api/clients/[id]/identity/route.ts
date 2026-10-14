import { db } from '@/lib/db';
import { requireOperator, assertRequestMutation } from '@/lib/auth';
import { readJson } from '@/lib/security';
import { identityDecisionSchema } from '@/lib/validation';
import { ok, fail } from '../../../_utils';
import { createEnginePost } from '@/lib/action-decisions';
import { decideIdentity } from '@/lib/identity';
import { syncEngineClient } from '@/lib/sync';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request);
    const actor = await requireOperator();
    const { id } = await params;
    const body = identityDecisionSchema.parse(await readJson(request));
    const result = await decideIdentity({
      actor, clientId: id, db, enginePost: createEnginePost(), decision: body.decision, corrections: body.corrections,
      sync: client => syncEngineClient(client.engineClientId, client.organizationId).then(() => {}),
    });
    return ok(result);
  } catch (error) { return fail(error); }
}
