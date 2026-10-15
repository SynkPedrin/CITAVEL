import { z } from 'zod';
import { requireOperator, requireSession, assertClient, assertRequestMutation } from '@/lib/auth';
import { readJson, HttpError } from '@/lib/security';
import { db } from '@/lib/db';
import { loadSearchData, saveOpportunities } from '@/lib/gsc/insights';
import { QUERY_CATEGORIES } from '@/lib/gsc/classify';
import { ok, fail } from '../../../_utils';
export const dynamic = 'force-dynamic';
const terms = z.array(z.string().trim().min(2).max(80)).max(60);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('opportunities'), propertyId: z.string().max(128).optional(), period: z.string().max(10).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional() }).strict(),
  z.object({ action: z.literal('label'), query: z.string().min(1).max(500), category: z.enum(QUERY_CATEGORIES).nullable(), note: z.string().max(300).optional() }).strict(),
  z.object({ action: z.literal('terms'), brand: terms, services: terms, locations: terms }).strict(),
]);
// Read access: any actor allowed on the client (CLIENT_VIEWER included). Mutations: operators only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(); const { id } = await params; await assertClient(actor, id);
    const u = new URL(request.url); const data = await loadSearchData(id, { propertyId: u.searchParams.get('property') || undefined, period: u.searchParams.get('period') || undefined, from: u.searchParams.get('from') || undefined, to: u.searchParams.get('to') || undefined });
    if (data.state !== 'READY') return ok({ state: data.state });
    const { bindings, binding, lastJob, lastSuccess, queries, ...rest } = data as any;
    return ok({ ...rest, property: binding.property.siteUrl, lastSyncedAt: lastSuccess?.finishedAt || null });
  } catch (e) { return fail(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertRequestMutation(request); const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    const body = schema.parse(await readJson(request));
    if (body.action === 'opportunities') {
      const data = await loadSearchData(id, body);
      if (data.state !== 'READY') throw new HttpError(409, 'Ainda não há dados do Search Console para este cliente.', 'NO_DATA');
      const saved = await saveOpportunities(id, data.opportunities, data.period);
      await db.systemEvent.create({ data: { clientId: id, actorId: actor.id, source: 'GOOGLE_HUB', message: 'GSC_OPPORTUNITIES_DETECTED', metadata: { count: saved, period: { start: data.period.start, end: data.period.end } } } });
      return ok({ saved });
    }
    if (body.action === 'label') {
      if (body.category === null) await db.gscQueryLabel.deleteMany({ where: { clientId: id, query: body.query } });
      else await db.gscQueryLabel.upsert({ where: { clientId_query: { clientId: id, query: body.query } }, create: { clientId: id, query: body.query, category: body.category, reviewedById: actor.id, note: body.note }, update: { category: body.category, reviewedById: actor.id, note: body.note } });
      await db.systemEvent.create({ data: { clientId: id, actorId: actor.id, source: 'GOOGLE_HUB', message: 'GSC_QUERY_LABELED', metadata: { category: body.category } } });
      return ok({ ok: true });
    }
    const client = await db.client.findUniqueOrThrow({ where: { id } }); const meta = (client.metadata || {}) as any;
    await db.client.update({ where: { id }, data: { metadata: { ...meta, gsc: { ...(meta.gsc || {}), terms: { brand: body.brand, services: body.services, locations: body.locations }, termsReviewedBy: actor.id, termsReviewedAt: new Date().toISOString() } } } });
    return ok({ ok: true });
  } catch (e) { return fail(e instanceof z.ZodError ? new HttpError(400, 'Dados inválidos.', 'INVALID_INPUT') : e); }
}
