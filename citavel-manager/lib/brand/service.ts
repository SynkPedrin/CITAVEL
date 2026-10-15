// Brand asset persistence. Files are stored in private storage (never hot-linked); only APPROVED assets are shown
// in the UI or the PDF. A newer automatic find never replaces an approved logo; it waits as PENDING for a human.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db as prisma } from '../db';
import { HttpError, type Actor } from '../security';
import { validateLogo } from './image';
import { findLogo } from './resolver';
import type { Resolver } from './net';

export const assetRoot = () => path.resolve(process.env.BRAND_ASSET_DIR || path.join(process.cwd(), '.runtime', 'brand-assets'));
const keyOk = (k: string) => /^[a-z0-9]{10,40}\/[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/i.test(k);
export const assetFile = (storageKey: string) => { if (!keyOk(storageKey)) throw new Error('INVALID_STORAGE_KEY'); return path.join(assetRoot(), storageKey); };

async function store(clientId: string, bytes: Buffer) {
  const info = validateLogo(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `${clientId}/${sha256}.${info.ext}`;
  const file = assetFile(storageKey);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, bytes, { mode: 0o600 }).catch(() => {});
  return { info, sha256, storageKey };
}

type Target = { clientId: string; organizationId: string; competitorId: string | null };
async function target(clientId: string, competitorId: string | null, db = prisma): Promise<Target & { brand: string; domain: string | null }> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, organizationId: true, brandName: true, domain: true } });
  if (!competitorId) return { clientId, organizationId: client.organizationId, competitorId: null, brand: client.brandName, domain: client.domain };
  const c = await db.clientCompetitor.findUnique({ where: { id: competitorId } });
  if (!c || c.clientId !== clientId) throw new HttpError(404, 'Concorrente não encontrado.', 'NOT_FOUND');
  return { clientId, organizationId: client.organizationId, competitorId, brand: c.name, domain: c.officialDomain };
}

async function addAsset(t: Target, data: { bytes: Buffer; origin: 'AUTO' | 'UPLOAD'; sourceUrl: string | null; actor?: Actor }, db = prisma) {
  const { info, sha256, storageKey } = await store(t.clientId, data.bytes);
  const same = await db.brandAsset.findFirst({ where: { clientId: t.clientId, competitorId: t.competitorId, sha256 } });
  if (same) { if (data.origin === 'UPLOAD' && same.verificationStatus !== 'APPROVED') return approve(t.clientId, same.id, data.actor!, db); return same; }
  const approved = data.origin === 'UPLOAD' && data.actor;
  if (approved) await db.brandAsset.updateMany({ where: { clientId: t.clientId, competitorId: t.competitorId, isCurrent: true }, data: { isCurrent: false } });
  return db.brandAsset.create({ data: { organizationId: t.organizationId, clientId: t.clientId, competitorId: t.competitorId, sourceUrl: data.sourceUrl, origin: data.origin, storageKey, mimeType: info.mime, sha256, bytes: data.bytes.length, width: info.width, height: info.height,
    verificationStatus: approved ? 'APPROVED' : 'PENDING', isCurrent: Boolean(approved), approvedById: approved ? data.actor!.id : null, approvedAt: approved ? new Date() : null } });
}

export async function uploadLogo(clientId: string, competitorId: string | null, actor: Actor, dataBase64: string, db = prisma) {
  const bytes = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
  const t = await target(clientId, competitorId, db);
  const asset = await addAsset(t, { bytes, origin: 'UPLOAD', sourceUrl: null, actor }, db);
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'BRAND_ASSET', message: 'BRAND_ASSET_UPLOADED', metadata: { asset_id: asset.id, competitor_id: competitorId } } });
  return asset;
}

export async function resolveLogo(clientId: string, competitorId: string | null, actor: Actor | null, opts: { resolver?: Resolver } = {}, db = prisma) {
  const t = await target(clientId, competitorId, db);
  if (!t.domain) return { status: 'NO_DOMAIN' as const };
  try {
    const found = await findLogo(t.domain, t.brand, validateLogo, opts.resolver);
    if (!found) return { status: 'NOT_FOUND' as const };
    const asset = await addAsset(t, { bytes: found.bytes, origin: 'AUTO', sourceUrl: found.sourceUrl }, db);
    await db.systemEvent.create({ data: { clientId, actorId: actor?.id ?? null, source: 'BRAND_ASSET', message: 'BRAND_ASSET_FOUND', metadata: { asset_id: asset.id, competitor_id: competitorId, via: found.via, identity_match: found.identityMatch } } });
    return { status: 'FOUND' as const, assetId: asset.id, identityMatch: found.identityMatch };
  } catch (e) { return { status: 'ERROR' as const, message: e instanceof HttpError ? e.message : 'Falha ao buscar a logo.' }; }
}

/** Background pass after an import: fill logos only where no approved or pending one exists. Never throws. */
export async function resolveMissingLogos(clientId: string, opts: { resolver?: Resolver } = {}, db = prisma) {
  if (process.env.CITAVEL_DISABLE_LOGO_LOOKUP === '1') return;
  try {
    const have = await db.brandAsset.findMany({ where: { clientId, verificationStatus: { in: ['APPROVED', 'PENDING'] } }, select: { competitorId: true } });
    const done = new Set(have.map(a => a.competitorId ?? 'CLIENT'));
    const comps = await db.clientCompetitor.findMany({ where: { clientId, isVisible: true, officialDomain: { not: null } }, select: { id: true } });
    const todo: (string | null)[] = [...(done.has('CLIENT') ? [] : [null]), ...comps.filter(c => !done.has(c.id)).map(c => c.id)];
    for (const id of todo) await resolveLogo(clientId, id, null, opts, db);
  } catch { /* logos are optional; the comparison never depends on them */ }
}

export async function approve(clientId: string, assetId: string, actor: Actor, db = prisma) {
  const a = await db.brandAsset.findUnique({ where: { id: assetId } });
  if (!a || a.clientId !== clientId) throw new HttpError(404, 'Logo não encontrada.', 'NOT_FOUND');
  return db.$transaction(async tx => {
    await tx.brandAsset.updateMany({ where: { clientId, competitorId: a.competitorId, isCurrent: true, NOT: { id: a.id } }, data: { isCurrent: false } });
    const r = await tx.brandAsset.update({ where: { id: a.id }, data: { verificationStatus: 'APPROVED', isCurrent: true, approvedById: actor.id, approvedAt: new Date() } });
    await tx.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'BRAND_ASSET', message: 'BRAND_ASSET_APPROVED', metadata: { asset_id: a.id, competitor_id: a.competitorId } } });
    return r;
  });
}
export async function reject(clientId: string, assetId: string, actor: Actor, db = prisma) {
  const a = await db.brandAsset.findUnique({ where: { id: assetId } });
  if (!a || a.clientId !== clientId) throw new HttpError(404, 'Logo não encontrada.', 'NOT_FOUND');
  const r = await db.brandAsset.update({ where: { id: a.id }, data: { verificationStatus: 'REJECTED', isCurrent: false } });
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'BRAND_ASSET', message: 'BRAND_ASSET_REJECTED', metadata: { asset_id: a.id } } });
  return r;
}

/** Latest asset per owner: the approved/current one, else the newest pending (shown only in the management panel). */
export async function logoState(clientId: string, db = prisma) {
  const all = await db.brandAsset.findMany({ where: { clientId, verificationStatus: { not: 'REJECTED' } }, orderBy: { createdAt: 'desc' } });
  const by = new Map<string, { approved: (typeof all)[number] | null; pending: (typeof all)[number] | null }>();
  for (const a of all) {
    const k = a.competitorId ?? 'CLIENT'; const e = by.get(k) ?? { approved: null, pending: null };
    if (a.verificationStatus === 'APPROVED' && a.isCurrent && !e.approved) e.approved = a;
    if (a.verificationStatus === 'PENDING' && !e.pending) e.pending = a;
    by.set(k, e);
  }
  return by;
}

/** Data URI of an APPROVED asset, for PDFs (no remote loading at render time). */
export async function dataUri(asset: { storageKey: string; mimeType: string }) {
  try { return `data:${asset.mimeType};base64,${(await fs.readFile(assetFile(asset.storageKey))).toString('base64')}`; } catch { return null; }
}
