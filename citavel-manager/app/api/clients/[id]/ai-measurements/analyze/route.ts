import { z } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { parseMeasurement } from '@/lib/ai-measurement/parse';
import { ok, fail } from '../../../../_utils';
// Interprets pasted agent output. Read-only: nothing is stored until the operator confirms the review.
const schema = z.object({ text: z.string().min(20, 'Cole o resultado da medição (mínimo 20 caracteres).').max(400_000, 'Texto muito grande (máx. 400 mil caracteres).') }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    rateLimit(`analyze:${actor.id}`, 30);
    const { text } = schema.parse(await readJson(request, 600_000));
    const parsed = parseMeasurement(text);
    const client = await db.client.findUniqueOrThrow({ where: { id }, select: { name: true, brandName: true, domain: true } });
    const host = (u: string | null) => { try { return u ? new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '') : null; } catch { return null; } };
    if (parsed.meta.domain.value && host(parsed.meta.domain.value) && host(parsed.meta.domain.value) !== host(client.domain)) parsed.warnings.push({ code: 'CLIENT_MISMATCH', message: `O texto cita o domínio ${parsed.meta.domain.value}, diferente do cliente (${client.domain}). Confirme que a medição é deste cliente.`, line: parsed.meta.domain.evidence?.line });
    return ok({ parsed, client });
  } catch (e) { return fail(e instanceof z.ZodError ? new HttpError(400, e.issues[0]?.message || 'Texto inválido.', 'INVALID_INPUT') : e); }
}
