import { db } from '@/lib/db';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { readJson } from '@/lib/security';
import { cleanroomSchema } from '@/lib/validation';
import { ok, fail } from '../../_utils';
import { createEnginePost } from '@/lib/action-decisions';
import { startCleanroom } from '@/lib/cleanroom';
import { enqueueProvision } from '@/lib/jobs';

export async function POST(request: Request) {
  try {
    assertRequestMutation(request);
    const actor = await requireAdmin();
    const body = cleanroomSchema.parse(await readJson(request));
    const result = await startCleanroom({
      actor, db, enginePost: createEnginePost(), input: body,
      provision: input => enqueueProvision(input, actor),
    });
    return ok(result);
  } catch (error) { return fail(error); }
}
