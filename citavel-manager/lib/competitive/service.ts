// Competitive intelligence persistence. Everything is scoped by clientId (and organization): a competitor row, its
// metrics and its logos belong to ONE client. Identity = confirmed domain, else the exact normalized name; names that
// merely look alike are never merged. Adding a competitor by hand creates no measurement data.
import { z } from 'zod';
import { db as prisma } from '../db';
import { HttpError, type Actor } from '../security';
import { normalizeDomain, providerLabel } from '../ai-measurement/parse';
import { buildComparison, type CompetitorInput } from './metrics';
import { logoState } from '../brand/service';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const count = z.number().int().min(0).max(1_000_000).nullable().optional();
export const competitiveInput = z.array(z.object({
  name: z.string().trim().min(2).max(120), domain: z.string().trim().max(200).nullable().optional(),
  metrics: z.array(z.object({ provider: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/), observationCount: count, mentionCount: count, recommendationCount: count, citationCount: count }).strict()).max(20),
}).strict()).max(100);
export type CompetitiveInput = z.infer<typeof competitiveInput>;

export const nameKey = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function validateCompetitive(list: CompetitiveInput, platforms: { provider: string; observationCount?: number | null }[]) {
  const seen = new Set<string>();
  for (const c of list) {
    const k = nameKey(c.name); if (!k) throw new HttpError(400, 'Nome de concorrente inválido.', 'INVALID_COMPETITOR');
    if (seen.has(k)) throw new HttpError(400, `Concorrente repetido na análise competitiva: ${c.name}.`, 'DUPLICATE_COMPETITOR'); seen.add(k);
    if (c.domain && !normalizeDomain(c.domain)) throw new HttpError(400, `Domínio inválido para ${c.name}.`, 'INVALID_DOMAIN');
    const provs = new Set<string>();
    for (const m of c.metrics) {
      if (provs.has(m.provider)) throw new HttpError(400, `${c.name}: plataforma repetida (${providerLabel(m.provider)}).`, 'DUPLICATE_PLATFORM'); provs.add(m.provider);
      for (const f of ['mentionCount', 'recommendationCount', 'citationCount'] as const) if (m[f] != null && m.observationCount != null && m[f]! > m.observationCount) throw new HttpError(400, `${c.name} · ${providerLabel(m.provider)}: ${f} maior que observações.`, 'IMPOSSIBLE_VALUE');
    }
  }
}

/** Finds or creates the client's competitor record for a name/domain, without similarity matching. */
async function upsertCompetitor(tx: Tx, scope: { organizationId: string; clientId: string }, name: string, domainRaw: string | null | undefined, origin: 'IMPORT' | 'MANUAL') {
  const domain = domainRaw ? normalizeDomain(domainRaw) : null; const key = nameKey(name);
  let found = domain ? await tx.clientCompetitor.findFirst({ where: { clientId: scope.clientId, officialDomain: domain } }) : null;
  found ??= await tx.clientCompetitor.findUnique({ where: { clientId_nameKey: { clientId: scope.clientId, nameKey: key } } });
  if (found) {
    if (domain && found.officialDomain && found.officialDomain !== domain) found = null; // same name, different company
    else if (domain && !found.officialDomain) return tx.clientCompetitor.update({ where: { id: found.id }, data: { officialDomain: domain } });
    else return found;
  }
  const taken = await tx.clientCompetitor.findUnique({ where: { clientId_nameKey: { clientId: scope.clientId, nameKey: key } } });
  return tx.clientCompetitor.create({ data: { ...scope, name, nameKey: taken && domain ? `${key}@${domain}` : key, officialDomain: domain, origin } });
}

export async function syncMeasurementCompetitors(tx: Tx, scope: { organizationId: string; clientId: string }, measurementId: string, competitive: CompetitiveInput, names: string[]) {
  await tx.aiMeasurementCompetitorMetric.deleteMany({ where: { measurementId } });
  const done = new Set<string>();
  for (const c of competitive) {
    const row = await upsertCompetitor(tx, scope, c.name, c.domain, 'IMPORT'); done.add(nameKey(c.name));
    for (const m of c.metrics) await tx.aiMeasurementCompetitorMetric.create({ data: { measurementId, competitorId: row.id, provider: m.provider, observationCount: m.observationCount ?? null, mentionCount: m.mentionCount ?? null, recommendationCount: m.recommendationCount ?? null, citationCount: m.citationCount ?? null } });
  }
  for (const n of names) if (!done.has(nameKey(n)) && nameKey(n)) { await upsertCompetitor(tx, scope, n, null, 'IMPORT'); done.add(nameKey(n)); }
}

export async function listCompetitors(clientId: string, db = prisma) {
  const comps = await db.clientCompetitor.findMany({ where: { clientId }, orderBy: [{ isPriority: 'desc' }, { name: 'asc' }], include: { _count: { select: { metrics: true } } } });
  const logos = await logoState(clientId, db);
  return comps.map(c => ({ id: c.id, name: c.name, domain: c.officialDomain, verificationStatus: c.verificationStatus, origin: c.origin, isPriority: c.isPriority, isVisible: c.isVisible, hasMeasurements: c._count.metrics > 0, logo: logos.get(c.id) ?? { approved: null, pending: null } }));
}

const patchSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), domain: z.string().trim().max(200).nullable().optional(), isVisible: z.boolean().optional(), isPriority: z.boolean().optional(), verificationStatus: z.enum(['UNVERIFIED', 'CONFIRMED']).optional() }).strict();
export async function addCompetitor(clientId: string, actor: Actor, raw: unknown, db = prisma) {
  const input = z.object({ name: z.string().trim().min(2).max(120), domain: z.string().trim().max(200).nullable().optional() }).strict().parse(raw);
  if (input.domain && !normalizeDomain(input.domain)) throw new HttpError(400, 'Domínio inválido.', 'INVALID_DOMAIN');
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
  const c = await db.$transaction(async tx => upsertCompetitor(tx, { organizationId: client.organizationId, clientId }, input.name, input.domain, 'MANUAL'));
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'COMPETITIVE', message: 'COMPETITOR_ADDED', metadata: { competitor_id: c.id } } });
  return c;
}
export async function updateCompetitor(clientId: string, competitorId: string, actor: Actor, raw: unknown, db = prisma) {
  const input = patchSchema.parse(raw); const c = await db.clientCompetitor.findUnique({ where: { id: competitorId } });
  if (!c || c.clientId !== clientId) throw new HttpError(404, 'Concorrente não encontrado.', 'NOT_FOUND');
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) { data.name = input.name; data.nameKey = nameKey(input.name); }
  if (input.domain !== undefined) { const d = input.domain ? normalizeDomain(input.domain) : null; if (input.domain && !d) throw new HttpError(400, 'Domínio inválido.', 'INVALID_DOMAIN'); data.officialDomain = d; if (d !== c.officialDomain) data.verificationStatus = 'UNVERIFIED'; }
  for (const k of ['isVisible', 'isPriority', 'verificationStatus'] as const) if (input[k] !== undefined && !(k === 'verificationStatus' && 'verificationStatus' in data)) data[k] = input[k];
  try { const r = await db.clientCompetitor.update({ where: { id: c.id }, data }); await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'COMPETITIVE', message: 'COMPETITOR_UPDATED', metadata: { competitor_id: c.id, fields: Object.keys(data) } } }); return r; }
  catch (e: any) { if (e?.code === 'P2002') throw new HttpError(409, 'Já existe um concorrente com este nome neste cliente.', 'DUPLICATE_COMPETITOR'); throw e; }
}
export async function deleteCompetitor(clientId: string, competitorId: string, actor: Actor, db = prisma) {
  const c = await db.clientCompetitor.findUnique({ where: { id: competitorId }, include: { _count: { select: { metrics: true } } } });
  if (!c || c.clientId !== clientId) throw new HttpError(404, 'Concorrente não encontrado.', 'NOT_FOUND');
  if (c._count.metrics > 0) throw new HttpError(409, 'Este concorrente tem dados de medição. Oculte-o em vez de excluir.', 'HAS_MEASUREMENTS');
  await db.clientCompetitor.delete({ where: { id: c.id } });
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'COMPETITIVE', message: 'COMPETITOR_DELETED', metadata: { competitor_id: c.id } } });
}

/** Comparison for one approved measurement (default: the latest). Visible competitors only unless includeHidden. */
export async function loadComparison(clientId: string, opts: { measurementId?: string | null; provider?: string | null; includeHidden?: boolean } = {}, db = prisma) {
  const m = await db.aiMeasurement.findFirst({ where: { clientId, status: 'APPROVED', ...(opts.measurementId ? { id: opts.measurementId } : {}) }, orderBy: [{ executedAt: 'desc' }, { importedAt: 'desc' }], include: { platforms: true, competitorMetrics: { include: { competitor: true } } } });
  if (!m) return null;
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { brandName: true, name: true, domain: true } });
  const byId = new Map<string, CompetitorInput>();
  for (const x of m.competitorMetrics) {
    if (x.competitor.clientId !== clientId) continue; // defensive: never cross clients
    if (!opts.includeHidden && !x.competitor.isVisible) continue;
    const e = byId.get(x.competitorId) ?? { id: x.competitorId, name: x.competitor.name, domain: x.competitor.officialDomain, metrics: [] };
    e.metrics.push({ provider: x.provider, observationCount: x.observationCount, mentionCount: x.mentionCount, recommendationCount: x.recommendationCount, citationCount: x.citationCount }); byId.set(x.competitorId, e);
  }
  const named = await db.clientCompetitor.findMany({ where: { clientId, isVisible: true, metrics: { none: { measurementId: m.id } } }, select: { id: true, name: true, officialDomain: true } });
  const comparison = buildComparison({ clientName: client.brandName || client.name, clientDomain: client.domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, ''), platforms: m.platforms.map(p => ({ ...p, label: providerLabel(p.provider) })), competitors: [...byId.values()], provider: opts.provider });
  const logos = await logoState(clientId, db);
  return { measurement: { id: m.id, title: m.title, classification: m.classification, methodology: m.methodology, methodologyVersion: m.methodologyVersion, executedAt: m.executedAt, periodStart: m.periodStart, periodEnd: m.periodEnd, version: m.version, providers: m.platforms.map(p => p.provider) },
    comparison, withoutData: named.map(n => ({ id: n.id, name: n.name, domain: n.officialDomain })), logos };
}
export type ComparisonView = NonNullable<Awaited<ReturnType<typeof loadComparison>>>;
