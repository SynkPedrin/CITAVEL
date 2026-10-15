import { ZodError } from 'zod';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { clientProfileSchema, saveClientProfile } from '@/lib/clients';
import { ok, fail } from '../_utils';
export async function POST(request: Request) {
  try { assertRequestMutation(request); const actor = await requireAdmin(); const c = await saveClientProfile(actor, clientProfileSchema.parse(await readJson(request))); return ok({ id: c.id }, 201); }
  catch (e) { return fail(e instanceof ZodError ? new HttpError(400, e.issues[0]?.message || 'Dados inválidos.', 'INVALID_INPUT') : e); }
}
