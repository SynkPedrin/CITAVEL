import { z, ZodError } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { resolveLogo } from '@/lib/brand/service';
import { ok, fail } from '../../../../_utils';
const schema = z.object({ competitorId: z.string().min(10).max(40).nullable().optional() }).strict();
// Looks for the logo on the company's official domain (SSRF-protected). Result waits for human approval.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id); rateLimit(`logo-find:${actor.id}`, 20);
    const input = schema.parse(await readJson(request, 2_000)); return ok(await resolveLogo(id, input.competitorId ?? null, actor));
  } catch (e) { return fail(e instanceof ZodError ? new HttpError(400, 'Pedido inválido.', 'INVALID_INPUT') : e); }
}
