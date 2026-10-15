// Client list / header read models for Manager 2.0. Tenant scope is applied here once:
// agency roles see their organization's clients; client roles only the clients assigned to them.
import { z } from 'zod';
import { db } from './db';
import { HttpError, isClientActor, type Actor } from './security';

export function clientScope(actor: Actor) {
  return isClientActor(actor) ? { organizationId: actor.organizationId, id: { in: actor.clientIds } } : { organizationId: actor.organizationId };
}

export type GoogleStatus = { state: 'NOT_LINKED' | 'LINKED' | 'AUTH_EXPIRED' | 'DISCONNECTED' | 'SYNC_ERROR'; siteUrl: string | null; lastSyncAt: Date | null; availableEnd: string | null };
async function googleStatus(clientIds: string[], organizationId: string) {
  const [bindings, conn] = await Promise.all([
    db.clientPropertyBinding.findMany({ where: { clientId: { in: clientIds }, status: 'ACTIVE' }, include: { property: true, jobs: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: [{ isPrimary: 'desc' }] }),
    db.googleConnection.findUnique({ where: { organizationId } }),
  ]);
  const out = new Map<string, GoogleStatus>();
  for (const id of clientIds) {
    const b = bindings.find(x => x.clientId === id);
    if (!b) { out.set(id, { state: 'NOT_LINKED', siteUrl: null, lastSyncAt: null, availableEnd: null }); continue; }
    const connState = conn?.status === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : !conn?.refreshTokenEnc ? 'DISCONNECTED' : b.jobs[0]?.status === 'FAILED' ? 'SYNC_ERROR' : 'LINKED';
    out.set(id, { state: connState, siteUrl: b.property.siteUrl, lastSyncAt: b.lastSuccessfulSyncAt, availableEnd: b.availableEndDate });
  }
  return out;
}

export async function listClients(actor: Actor) {
  const clients = await db.client.findMany({ where: clientScope(actor), orderBy: { name: 'asc' }, select: { id: true, name: true, domain: true, status: true, industry: true } });
  const ids = clients.map(c => c.id);
  const [google, measurements, reports] = await Promise.all([
    googleStatus(ids, actor.organizationId),
    db.aiMeasurement.findMany({ where: { clientId: { in: ids }, status: 'APPROVED' }, orderBy: { importedAt: 'desc' }, select: { clientId: true, executedAt: true, importedAt: true, classification: true } }),
    db.reportSnapshot.findMany({ where: { clientId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { clientId: true, createdAt: true } }),
  ]);
  return clients.map(c => ({ ...c, google: google.get(c.id)!, lastMeasurement: measurements.find(m => m.clientId === c.id) || null, lastReport: reports.find(r => r.clientId === c.id) || null }));
}

export async function clientHeader(actor: Actor, id: string) {
  const c = await db.client.findFirst({ where: { AND: [clientScope(actor), { id }] }, select: { id: true, name: true, domain: true, status: true, industry: true, location: true, metadata: true } });
  if (!c) return null;
  const google = (await googleStatus([id], actor.organizationId)).get(id)!;
  const lastMeasurement = await db.aiMeasurement.findFirst({ where: { clientId: id, status: 'APPROVED' }, orderBy: { importedAt: 'desc' }, select: { importedAt: true, executedAt: true } });
  const updatedAt = [google.lastSyncAt, lastMeasurement?.importedAt].filter(Boolean).sort((a, b) => +b! - +a!)[0] || null;
  return { ...c, google, lastMeasurement, updatedAt };
}

// ---- Client profile (create / edit) — agency admins only ----
const terms = z.array(z.string().trim().min(2).max(80)).max(40);
export const clientProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  domain: z.string().trim().max(300).refine(v => { try { const u = new URL(v.includes('://') ? v : `https://${v}`); return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') && !u.username && !u.password && !['localhost', '127.0.0.1'].includes(u.hostname); } catch { return false; } }, 'Informe um domínio público válido.'),
  industry: z.string().trim().max(120).default(''),
  locations: terms.default([]), services: terms.default([]), brandTerms: terms.default([]),
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']).default('ACTIVE'),
}).strict();
export type ClientProfile = z.infer<typeof clientProfileSchema>;
const normalizedDomain = (d: string) => { const u = new URL(d.includes('://') ? d : `https://${d}`); return `${u.protocol}//${u.hostname}/`; };

export async function saveClientProfile(actor: Actor, input: ClientProfile, clientId?: string) {
  const domain = normalizedDomain(input.domain);
  if (clientId) {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId } });
    if (!c) throw new HttpError(404, 'Cliente não encontrado.', 'NOT_FOUND');
    const meta = (c.metadata || {}) as any;
    const updated = await db.client.update({ where: { id: c.id }, data: { name: input.name, brandName: input.name, domain, industry: input.industry, location: input.locations[0] || '', status: input.status, metadata: { ...meta, gsc: { ...(meta.gsc || {}), terms: { brand: input.brandTerms, services: input.services, locations: input.locations }, termsReviewedBy: actor.id, termsReviewedAt: new Date().toISOString() } } } });
    await db.systemEvent.create({ data: { clientId: c.id, actorId: actor.id, source: 'MANAGER', message: 'CLIENT_PROFILE_UPDATED', metadata: { status: input.status } } });
    return updated;
  }
  const dup = await db.client.findFirst({ where: { organizationId: actor.organizationId, OR: [{ domain }, { name: { equals: input.name, mode: 'insensitive' } }] } });
  if (dup) throw new HttpError(409, `Já existe um cliente com este nome ou domínio (${dup.name}).`, 'DUPLICATE_CLIENT');
  const base = input.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente';
  let key = /^[a-z]/.test(base) ? base : `c-${base}`;
  for (let i = 2; await db.client.findFirst({ where: { OR: [{ clientKey: key }, { engineClientId: key }] } }); i++) key = `${base}-${i}`;
  const created = await db.client.create({ data: { organizationId: actor.organizationId, clientKey: key, engineClientId: key, name: input.name, brandName: input.name, domain, industry: input.industry, location: input.locations[0] || '', status: input.status, metadata: { gsc: { terms: { brand: input.brandTerms, services: input.services, locations: input.locations }, termsReviewedBy: actor.id, termsReviewedAt: new Date().toISOString() } } } });
  await db.systemEvent.create({ data: { clientId: created.id, actorId: actor.id, source: 'MANAGER', message: 'CLIENT_CREATED', metadata: { client_key: key } } });
  return created;
}

/** For client pages: layouts and pages render in parallel in Next.js, so every page re-checks tenant access. */
export async function requireClientAccess(actor: Actor, id: string) {
  const c = await db.client.findFirst({ where: { AND: [clientScope(actor), { id }] }, select: { id: true } });
  if (!c) { const { notFound } = await import('next/navigation'); notFound(); }
  return c!;
}
