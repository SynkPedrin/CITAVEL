import { ZodError } from 'zod';
import { requireOperator, requireSession, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { createMeasurement, listMeasurements } from '@/lib/ai-measurement/service';
import { ok, fail } from '../../../_utils';
const invalid = (e: ZodError) => new HttpError(400, `Revise os campos: ${e.issues.slice(0, 3).map(i => `${i.path.join('.') || 'dados'} (${i.message})`).join('; ')}.`, 'INVALID_INPUT');
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const actor = await requireSession(); const { id } = await params; await assertClient(actor, id); return ok({ measurements: (await listMeasurements(id)).map(({ rawText, ...m }) => m) }); } catch (e) { return fail(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    rateLimit(`import:${actor.id}`, 20);
    const m = await createMeasurement(id, actor, await readJson(request, 1_000_000));
    return ok({ id: m.id, version: m.version }, 201);
  } catch (e) { return fail(e instanceof ZodError ? invalid(e) : e); }
}
