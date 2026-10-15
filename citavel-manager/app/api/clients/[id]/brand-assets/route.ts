import { z, ZodError } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { uploadLogo } from '@/lib/brand/service';
import { ok, fail } from '../../../_utils';
const schema = z.object({ competitorId: z.string().min(10).max(40).nullable().optional(), data: z.string().min(20).max(800_000) }).strict();
// Manual upload by an operator: validated by content, stored privately and approved right away.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id); rateLimit(`logo:${actor.id}`, 30);
    const input = schema.parse(await readJson(request, 900_000)); const a = await uploadLogo(id, input.competitorId ?? null, actor, input.data); return ok({ id: a.id }, 201);
  } catch (e) { return fail(e instanceof ZodError ? new HttpError(400, 'Envie uma imagem válida.', 'INVALID_INPUT') : e); }
}
