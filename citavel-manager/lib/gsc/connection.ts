import { db as prisma } from '../db';
import { platformConfig } from '../private-config';
import { Actor, HttpError } from '../security';
import { GscApi, GscApiError, hasDataAccess, propertyType, type Deps } from './api';
import { OAuthError, decryptToken, encryptToken, refreshAccessToken, revokeToken } from './oauth';

export type HubStatus = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'AUTH_EXPIRED' | 'SYNCING' | 'SYNC_ERROR';
export type HubDeps = Deps & { db?: typeof prisma };

async function creds() {
  const cfg = await platformConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) throw new HttpError(400, 'Configure o ID e o segredo OAuth do Google em Configurações → Acesso Google.', 'OAUTH_CLIENT_MISSING');
  return { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET };
}
export async function oauthClientConfigured() { const cfg = await platformConfig(); return Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET); }

// Short-lived access tokens are cached in memory only; the refresh token is read from the encrypted column per refresh.
const cache = new Map<string, { token: string; expires: number }>();
export function clearTokenCache() { cache.clear(); }

export async function markConnecting(organizationId: string) {
  await prisma.googleConnection.upsert({ where: { organizationId }, create: { organizationId, status: 'CONNECTING' }, update: { status: 'CONNECTING', lastError: null } });
}
export async function connectionFailed(organizationId: string, code: string) {
  const row = await prisma.googleConnection.findUnique({ where: { organizationId } });
  if (!row) return;
  // A cancelled re-authorization must not hide a still-valid existing connection.
  await prisma.googleConnection.update({ where: { organizationId }, data: { status: row.refreshTokenEnc ? (row.status === 'CONNECTING' ? 'CONNECTED' : row.status) : 'NOT_CONNECTED', lastError: code } });
}

export async function saveConnection(organizationId: string, actorId: string, t: { refreshToken: string; scopes: string[]; email: string | null; subject: string | null }, d: HubDeps = {}) {
  const db = d.db || prisma;
  const previous = await db.googleConnection.findUnique({ where: { organizationId } });
  const data = { status: 'CONNECTED', refreshTokenEnc: encryptToken(t.refreshToken), grantedScopes: t.scopes.join(' '), googleEmail: t.email, googleSubject: t.subject, connectedById: actorId, connectedAt: new Date(), lastError: null };
  const row = await db.googleConnection.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  cache.delete(row.id);
  // A different Google account replaces the previous one: its old token is revoked so access does not linger.
  if (previous?.refreshTokenEnc && previous.googleSubject && t.subject && previous.googleSubject !== t.subject) {
    try { await revokeToken(decryptToken(previous.refreshTokenEnc), d.fetch); } catch { /* best effort */ }
  }
  await db.systemEvent.create({ data: { actorId, source: 'GOOGLE_HUB', message: 'GOOGLE_CONNECTED', metadata: { organization_id: organizationId, google_email: t.email, scopes: t.scopes } } });
  return row;
}

export async function accessToken(organizationId: string, d: HubDeps = {}): Promise<string> {
  const db = d.db || prisma;
  const row = await db.googleConnection.findUnique({ where: { organizationId } });
  if (!row?.refreshTokenEnc || row.status === 'AUTH_EXPIRED') throw new GscApiError(401, 'AUTH_REQUIRED', 'Conecte (ou reconecte) a conta Google em Integrações.');
  const hit = cache.get(row.id);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  try {
    const t = await refreshAccessToken(await creds(), decryptToken(row.refreshTokenEnc), d.fetch);
    cache.set(row.id, { token: t.accessToken, expires: Date.now() + t.expiresIn * 1000 });
    await db.googleConnection.update({ where: { id: row.id }, data: { lastRefreshAt: new Date(), lastError: null } });
    return t.accessToken;
  } catch (error) {
    if (error instanceof OAuthError && error.code === 'AUTH_EXPIRED') {
      await db.googleConnection.update({ where: { id: row.id }, data: { status: 'AUTH_EXPIRED', lastError: 'AUTH_EXPIRED' } });
      await db.systemEvent.create({ data: { source: 'GOOGLE_HUB', level: 'ERROR', message: 'GOOGLE_AUTH_EXPIRED', metadata: { organization_id: organizationId } } });
      throw new GscApiError(401, 'AUTH_EXPIRED', error.message);
    }
    throw new GscApiError(0, error instanceof OAuthError ? error.code : 'REFRESH_FAILED', error instanceof Error ? error.message : 'Falha ao renovar acesso.', true);
  }
}

export function apiFor(organizationId: string, d: HubDeps = {}) { return new GscApi(() => accessToken(organizationId, d), d); }

/** Lists every property the connected account can see and records it. Properties that disappeared are kept but flagged inaccessible. */
export async function discoverProperties(organizationId: string, d: HubDeps = {}) {
  const db = d.db || prisma;
  const conn = await db.googleConnection.findUnique({ where: { organizationId } });
  if (!conn) throw new HttpError(409, 'Conecte uma conta Google primeiro.', 'NOT_CONNECTED');
  const sites = await apiFor(organizationId, d).listSites();
  const seen = new Date();
  for (const s of sites) {
    const data = { connectionId: conn.id, permissionLevel: s.permissionLevel, propertyType: propertyType(s.siteUrl), accessible: hasDataAccess(s.permissionLevel), lastSeenAt: seen };
    await db.searchConsoleProperty.upsert({ where: { organizationId_siteUrl: { organizationId, siteUrl: s.siteUrl } }, create: { organizationId, siteUrl: s.siteUrl, ...data }, update: data });
  }
  await db.searchConsoleProperty.updateMany({ where: { organizationId, siteUrl: { notIn: sites.map(s => s.siteUrl) } }, data: { accessible: false } });
  await db.googleConnection.update({ where: { id: conn.id }, data: { lastDiscoveryAt: seen } });
  return sites.length;
}

export async function disconnect(organizationId: string, actorId: string, d: HubDeps = {}) {
  const db = d.db || prisma;
  const row = await db.googleConnection.findUnique({ where: { organizationId } });
  if (!row) return { revoked: false };
  let revoked = false;
  if (row.refreshTokenEnc) { try { revoked = await revokeToken(decryptToken(row.refreshTokenEnc), d.fetch); } catch { revoked = false; } }
  cache.delete(row.id);
  // Bindings and already imported metrics are kept (history); syncing stops until a new authorization.
  await db.googleConnection.update({ where: { id: row.id }, data: { status: 'NOT_CONNECTED', refreshTokenEnc: null, grantedScopes: '', lastError: null } });
  await db.systemEvent.create({ data: { actorId, source: 'GOOGLE_HUB', message: 'GOOGLE_DISCONNECTED', metadata: { organization_id: organizationId, revoked } } });
  return { revoked };
}

export async function hubOverview(organizationId: string) {
  const conn = await prisma.googleConnection.findUnique({ where: { organizationId } });
  const properties = await prisma.searchConsoleProperty.findMany({ where: { organizationId }, include: { binding: { include: { client: { select: { id: true, name: true, status: true } } } } }, orderBy: { siteUrl: 'asc' } });
  const jobs = await prisma.gscSyncJob.findMany({ where: { client: { organizationId } }, orderBy: { createdAt: 'desc' }, take: 30, include: { client: { select: { name: true } }, binding: { include: { property: { select: { siteUrl: true } } } } } });
  const running = jobs.some(j => ['QUEUED', 'RUNNING'].includes(j.status));
  const lastFinished = jobs.find(j => j.finishedAt);
  let status: HubStatus = (conn?.status as HubStatus) || 'NOT_CONNECTED';
  // An abandoned authorization (state cookie expired after 10 min) falls back to the real token state.
  if (status === 'CONNECTING' && conn && Date.now() - conn.updatedAt.getTime() > 11 * 60_000) status = conn.refreshTokenEnc ? 'CONNECTED' : 'NOT_CONNECTED';
  if (status === 'CONNECTED' && running) status = 'SYNCING';
  else if (status === 'CONNECTED' && lastFinished?.status === 'FAILED') status = 'SYNC_ERROR';
  const lastSuccess = jobs.find(j => ['SUCCESS', 'PARTIAL'].includes(j.status) && j.finishedAt)?.finishedAt || null;
  return {
    status, email: conn?.googleEmail || null, connectedAt: conn?.connectedAt || null, lastDiscoveryAt: conn?.lastDiscoveryAt || null, lastError: conn?.lastError || null,
    lastSyncAt: lastSuccess, scopes: conn?.grantedScopes || '',
    accessibleCount: properties.filter(p => p.accessible).length,
    boundCount: properties.filter(p => p.binding?.status === 'ACTIVE').length,
    properties: properties.map(p => ({ id: p.id, siteUrl: p.siteUrl, propertyType: p.propertyType, permissionLevel: p.permissionLevel, accessible: p.accessible, lastSeenAt: p.lastSeenAt,
      binding: p.binding && p.binding.status === 'ACTIVE' ? { id: p.binding.id, clientId: p.binding.clientId, clientName: p.binding.client.name, isPrimary: p.binding.isPrimary, lastSuccessfulSyncAt: p.binding.lastSuccessfulSyncAt, availableStartDate: p.binding.availableStartDate, availableEndDate: p.binding.availableEndDate } : null })),
    jobs: jobs.map(j => ({ id: j.id, type: j.type, status: j.status, client: j.client.name, siteUrl: j.binding.property.siteUrl, trigger: j.trigger, requestedStartDate: j.requestedStartDate, requestedEndDate: j.requestedEndDate, availableStartDate: j.availableStartDate, availableEndDate: j.availableEndDate, rowsImported: j.rowsImported, apiRequests: j.apiRequests, errorCode: j.errorCode, errorDetail: j.errorDetail, createdAt: j.createdAt, finishedAt: j.finishedAt })),
  };
}

// ---- Bindings ----
export async function bindProperty(actor: Actor, propertyId: string, clientId: string, d: HubDeps = {}) {
  const db = d.db || prisma;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'gsc-bind-' + propertyId}))`;
    const property = await tx.searchConsoleProperty.findUnique({ where: { id: propertyId }, include: { binding: true } });
    const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true, name: true } });
    // Both sides must belong to the actor's organization: a property can never be attached across tenants.
    if (!property || property.organizationId !== actor.organizationId) throw new HttpError(404, 'Propriedade não encontrada.', 'PROPERTY_NOT_FOUND');
    if (!client || client.organizationId !== actor.organizationId) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
    if (!property.accessible) throw new HttpError(409, 'A conta conectada não tem acesso aos dados desta propriedade.', 'PROPERTY_NOT_ACCESSIBLE');
    if (property.binding?.status === 'ACTIVE' && property.binding.clientId !== clientId) throw new HttpError(409, 'Esta propriedade já está vinculada a outro cliente. Desvincule antes de alterar.', 'PROPERTY_ALREADY_BOUND');
    if (property.binding?.status === 'ACTIVE') return property.binding;
    const hasPrimary = await tx.clientPropertyBinding.count({ where: { clientId, status: 'ACTIVE', isPrimary: true } });
    const data = { clientId, status: 'ACTIVE', isPrimary: hasPrimary === 0, boundById: actor.id, boundAt: new Date(), unboundAt: null, lastSuccessfulSyncAt: null, availableStartDate: null, availableEndDate: null };
    const binding = property.binding ? await tx.clientPropertyBinding.update({ where: { id: property.binding.id }, data }) : await tx.clientPropertyBinding.create({ data: { propertyId, ...data } });
    await tx.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'GOOGLE_HUB', message: 'GSC_PROPERTY_BOUND', metadata: { site_url: property.siteUrl, binding_id: binding.id } } });
    return binding;
  });
}

export async function unbindProperty(actor: Actor, bindingId: string, purgeData: boolean, d: HubDeps = {}) {
  const db = d.db || prisma;
  const b = await db.clientPropertyBinding.findUnique({ where: { id: bindingId }, include: { client: { select: { organizationId: true } }, property: true } });
  if (!b || b.client.organizationId !== actor.organizationId) throw new HttpError(404, 'Vínculo não encontrado.', 'BINDING_NOT_FOUND');
  await db.$transaction(async tx => {
    await tx.clientPropertyBinding.update({ where: { id: b.id }, data: { status: 'UNLINKED', unboundAt: new Date(), isPrimary: false } });
    if (purgeData) {
      await tx.gscDailyMetric.deleteMany({ where: { clientId: b.clientId, siteUrl: b.property.siteUrl } });
      await tx.gscDimensionMetric.deleteMany({ where: { clientId: b.clientId, siteUrl: b.property.siteUrl } });
    }
    if (b.isPrimary) {
      const next = await tx.clientPropertyBinding.findFirst({ where: { clientId: b.clientId, status: 'ACTIVE' }, orderBy: { boundAt: 'asc' } });
      if (next) await tx.clientPropertyBinding.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await tx.systemEvent.create({ data: { clientId: b.clientId, actorId: actor.id, source: 'GOOGLE_HUB', message: 'GSC_PROPERTY_UNBOUND', metadata: { site_url: b.property.siteUrl, purged: purgeData } } });
  });
}

export async function setPrimary(actor: Actor, bindingId: string, d: HubDeps = {}) {
  const db = d.db || prisma;
  const b = await db.clientPropertyBinding.findUnique({ where: { id: bindingId }, include: { client: { select: { organizationId: true } } } });
  if (!b || b.status !== 'ACTIVE' || b.client.organizationId !== actor.organizationId) throw new HttpError(404, 'Vínculo não encontrado.', 'BINDING_NOT_FOUND');
  await db.$transaction([
    db.clientPropertyBinding.updateMany({ where: { clientId: b.clientId, status: 'ACTIVE' }, data: { isPrimary: false } }),
    db.clientPropertyBinding.update({ where: { id: b.id }, data: { isPrimary: true } }),
  ]);
}

/** Creates a DRAFT client (not provisioned in the Engine, not active) so a property can be attached before onboarding. */
export async function createDraftClient(actor: Actor, input: { name: string; domain: string }, d: HubDeps = {}) {
  const db = d.db || prisma;
  const base = input.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente';
  let key = /^[a-z]/.test(base) ? base : `c-${base}`;
  for (let i = 2; await db.client.findFirst({ where: { OR: [{ clientKey: key }, { engineClientId: key }] } }); i++) key = `${base}-${i}`;
  const client = await db.client.create({ data: { organizationId: actor.organizationId, clientKey: key, engineClientId: key, name: input.name, brandName: input.name, domain: input.domain, status: 'DRAFT', metadata: { draft: { createdFrom: 'GOOGLE_HUB', createdBy: actor.id } } } });
  await db.systemEvent.create({ data: { clientId: client.id, actorId: actor.id, source: 'GOOGLE_HUB', message: 'DRAFT_CLIENT_CREATED', metadata: { client_key: key } } });
  return client;
}
