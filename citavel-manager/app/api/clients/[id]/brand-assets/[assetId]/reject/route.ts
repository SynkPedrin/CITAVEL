import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { reject } from '@/lib/brand/service';
import { ok, fail } from '../../../../../_utils';
export async function POST(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try { assertRequestMutation(request); const actor = await requireOperator(); const { id, assetId } = await params; await assertClient(actor, id); await reject(id, assetId, actor); return ok({ ok: true }); } catch (e) { return fail(e); }
}
