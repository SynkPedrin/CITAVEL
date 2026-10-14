import { Actor, HttpError, canManage } from './security';
import type { EnginePost } from './action-decisions';

export function slugifyClientKey(brandName: string): string {
  const slug = brandName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const candidate = /^[a-z]/.test(slug) ? slug : `c${slug ? `-${slug}` : ''}`;
  return /^[a-z][a-z0-9-]{1,62}$/.test(candidate) ? candidate : '';
}

export interface CleanroomDb {
  client: { findUnique(args: any): Promise<any> };
}
interface CleanroomDeps {
  actor: Actor | null;
  db: CleanroomDb;
  enginePost: EnginePost;
  input: { brandName: string; officialDomain?: string };
  provision: (input: { clientKey: string; name: string; brandName: string; domain: string; industry: string; location: string }) => Promise<{ id: string }>;
}

export async function startCleanroom({ actor, db, enginePost, input, provision }: CleanroomDeps) {
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  if (!canManage(actor)) throw new HttpError(403, 'Acesso restrito à operação CITÁVEL.', 'FORBIDDEN');
  let clientKey = slugifyClientKey(input.brandName);
  if (!clientKey) throw new HttpError(400, 'Informe um nome de marca válido.', 'INVALID_BRAND_NAME');
  if (await db.client.findUnique({ where: { clientKey } })) {
    const alternate = `${clientKey}-cleanroom-v1`.slice(0, 63);
    if (await db.client.findUnique({ where: { clientKey: alternate } })) throw new HttpError(409, 'Já existe um cliente clean-room para esta marca.', 'CLIENT_EXISTS');
    clientKey = alternate;
  }
  const result = await enginePost('/v1/cleanroom', {
    client_id: clientKey,
    brand_name: input.brandName,
    ...(input.officialDomain ? { official_domain: input.officialDomain } : {}),
  }, 300_000);
  if (result?.status === 'DOMAIN_REQUIRED') {
    throw new HttpError(422, result.note || 'O Engine precisa do domínio oficial para descobrir a marca.', 'DOMAIN_REQUIRED');
  }
  const client = await provision({ clientKey, name: input.brandName, brandName: input.brandName, domain: input.officialDomain || '', industry: '', location: '' });
  return { clientId: client.id, clientKey };
}
