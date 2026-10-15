import { ZodError } from 'zod';
import { requireOperator, requireSession, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { addCompetitor, listCompetitors } from '@/lib/competitive/service';
import { ok, fail } from '../../../_utils';
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const actor = await requireSession(); const { id } = await params; await assertClient(actor, id); return ok({ competitors: await listCompetitors(id) }); } catch (e) { return fail(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id); rateLimit(`competitor:${actor.id}`, 60);
    const c = await addCompetitor(id, actor, await readJson(request, 8_000)); return ok({ id: c.id }, 201);
  } catch (e) { return fail(e instanceof ZodError ? new HttpError(400, 'Informe o nome (e, se souber, o domínio) do concorrente.', 'INVALID_INPUT') : e); }
}
