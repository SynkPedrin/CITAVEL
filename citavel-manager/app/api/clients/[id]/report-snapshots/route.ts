import { z } from 'zod';
import { requireOperator, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { rateLimit } from '@/lib/rate-limit';
import { generateReportV2 } from '@/lib/report/service';
import { REPORT_KINDS, REPORT_FORMATS } from '@/lib/report/snapshot-v2';
import { ok, fail } from '../../../_utils';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({ kind: z.enum(REPORT_KINDS), format: z.enum(REPORT_FORMATS), period: z.enum(['7d', '28d', '3m', '6m', '12m', 'custom']).default('28d'), from: day.optional(), to: day.optional(), measurementId: z.string().max(64).nullable().optional() }).strict()
  .refine(v => v.period !== 'custom' || (v.from && v.to && v.from <= v.to), 'Informe as datas do período personalizado.');
// Generation never runs measurements or calls AI providers: it only reads stored, approved data.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    rateLimit(`report:${actor.id}`, 10);
    return ok(await generateReportV2(id, actor, schema.parse(await readJson(request))), 201);
  } catch (e) { return fail(e instanceof z.ZodError ? new HttpError(400, e.issues[0]?.message || 'Parâmetros do relatório inválidos.', 'INVALID_INPUT') : e); }
}
