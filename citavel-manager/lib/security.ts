import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'ANALYST', 'CLIENT_ADMIN', 'CLIENT_VIEWER'] as const;
export type Role = (typeof ROLES)[number];
export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  clientIds: string[];
  forcePasswordChange: boolean;
}
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message); }
}
export const canManage = (actor: Actor) => ['SUPER_ADMIN', 'ADMIN'].includes(actor.role);
export const canOperate = (actor: Actor) => ['SUPER_ADMIN', 'ADMIN', 'ANALYST'].includes(actor.role);
export const isClientActor = (actor: Actor) => ['CLIENT_ADMIN', 'CLIENT_VIEWER'].includes(actor.role);
export function assertRole(actor: Actor, roles: readonly Role[]) {
  if (!roles.includes(actor.role)) throw new HttpError(403, 'Você não tem permissão para esta ação.', 'FORBIDDEN');
}
export function permitsClient(actor: Actor, client: { id: string; organizationId: string }): boolean {
  return actor.organizationId === client.organizationId && (!isClientActor(actor) || actor.clientIds.includes(client.id));
}
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function newTemporaryPassword() { return `${randomBytes(18).toString('base64url')}!a7`; }
export function secretMatches(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
export function appOrigin() {
  const configured = process.env.APP_URL;
  if (!configured) throw new Error('APP_URL is required');
  return new URL(configured).origin;
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function localOriginAlias(actual: string, expected: string) {
  try {
    const a = new URL(actual); const e = new URL(expected);
    return a.protocol === e.protocol && a.port === e.port && LOCAL_HOSTS.has(a.hostname) && LOCAL_HOSTS.has(e.hostname);
  } catch { return false; }
}
export function secureCookie() {
  const url = new URL(appOrigin());
  if (url.protocol === 'https:') return true;
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.ALLOW_INSECURE_LOCAL_HTTP === 'true') return false;
  if (process.env.NODE_ENV === 'production') throw new Error('HTTPS is required outside the explicitly configured local environment');
  return false;
}
export function assertMutation(request: Request, expectedOrigin = appOrigin()) {
  const origin = request.headers.get('origin') || '';
  const originMatches = origin === expectedOrigin || localOriginAlias(origin, expectedOrigin);
  if (!originMatches || request.headers.get('x-citavel-request') !== '1') {
    throw new HttpError(403, 'A sessão de segurança precisa ser atualizada. Recarregue a página.', 'CSRF_REJECTED');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  const localSameSite = fetchSite === 'same-site' && localOriginAlias(origin, expectedOrigin);
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none' && !localSameSite) throw new HttpError(403, 'Solicitação não autorizada.', 'CSRF_REJECTED');
}
export async function readJson(request: Request, maxBytes = 65_536): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Envie os dados no formato JSON.', 'INVALID_CONTENT_TYPE');
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new HttpError(413, 'Os dados enviados excedem o limite.', 'BODY_TOO_LARGE');
  if (!request.body) throw new HttpError(400, 'Dados inválidos.', 'INVALID_JSON');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const item = await reader.read(); if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Os dados enviados excedem o limite.', 'BODY_TOO_LARGE'); }
    chunks.push(item.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Dados inválidos.', 'INVALID_JSON'); }
}
export function logSecurity(event: string, fields: { actor_id?: string; client_id?: string; run_id?: string; code?: string } = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), event, ...fields })}\n`);
}
