// Google OAuth 2.0 Authorization Code flow (with PKCE) for the organization-level Search Console connection.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
// openid+email only identify which Google account was connected (shown to the admin); data access is read-only.
export const HUB_SCOPES = ['openid', 'email', GSC_SCOPE];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export class OAuthError extends Error { constructor(public code: string, message: string) { super(message); } }

// ---- Refresh-token encryption: a key derived only for this purpose (domain-separated from session cookies). ----
function tokenKey() {
  const explicit = process.env.GOOGLE_TOKEN_KEY;
  const secret = explicit || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Token encryption key unavailable');
  return Buffer.from(hkdfSync('sha256', secret, 'citavel-google-hub', 'refresh-token-v1', 32));
}
export function encryptToken(value: string) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}
export function decryptToken(value: string) {
  if (!value.startsWith('v1.')) throw new Error('Unknown token format');
  const raw = Buffer.from(value.slice(3), 'base64url');
  const d = createDecipheriv('aes-256-gcm', tokenKey(), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export function newAuthRequest(clientId: string, redirectUri: string) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: HUB_SCOPES.join(' '), state,
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  return { url: `${AUTH_URL}?${params}`, state, verifier };
}

type Creds = { clientId: string; clientSecret: string };
type F = typeof fetch;
async function post(f: F, url: string, body: Record<string, string>) {
  return f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store' } as RequestInit);
}

/** Decodes the id_token payload. It came directly from Google's token endpoint over TLS, so no signature check is needed (per Google's OpenID docs). */
function idClaims(idToken?: string): { email?: string; sub?: string; email_verified?: boolean } {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

export async function exchangeCode(creds: Creds, code: string, verifier: string, redirectUri: string, f: F = fetch) {
  const res = await post(f, TOKEN_URL, { code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
  if (!res.ok) throw new OAuthError('EXCHANGE_FAILED', 'O Google recusou o código de autorização.');
  const t: any = await res.json();
  if (!t.refresh_token) throw new OAuthError('OFFLINE_REQUIRED', 'O Google não forneceu acesso contínuo (refresh token).');
  const scopes = String(t.scope || '').split(' ').filter(Boolean);
  if (!scopes.includes(GSC_SCOPE)) throw new OAuthError('SCOPE_REQUIRED', 'A permissão de leitura do Search Console não foi concedida.');
  const claims = idClaims(t.id_token);
  return { refreshToken: t.refresh_token as string, accessToken: t.access_token as string, expiresIn: Number(t.expires_in) || 3600, scopes, email: claims.email || null, subject: claims.sub || null };
}

export async function refreshAccessToken(creds: Creds, refreshToken: string, f: F = fetch) {
  let res: Response;
  try { res = await post(f, TOKEN_URL, { client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }); }
  catch { throw new OAuthError('NETWORK', 'Não foi possível contatar o Google para renovar o acesso.'); }
  if (!res.ok) {
    let err = ''; try { err = ((await res.json()) as any).error || ''; } catch { /* ignore */ }
    // invalid_grant = revoked, expired (e.g. app in "Testing" mode: 7 days) or password change → reauthorization required.
    if (err === 'invalid_grant' || res.status === 400 || res.status === 401) throw new OAuthError('AUTH_EXPIRED', 'A autorização Google expirou ou foi revogada.');
    throw new OAuthError('REFRESH_FAILED', `Falha ao renovar o acesso Google (HTTP ${res.status}).`);
  }
  const t: any = await res.json();
  if (!t.access_token) throw new OAuthError('REFRESH_FAILED', 'O Google não forneceu um token de acesso.');
  return { accessToken: t.access_token as string, expiresIn: Number(t.expires_in) || 3600 };
}

export async function revokeToken(token: string, f: F = fetch) {
  try { const res = await post(f, REVOKE_URL, { token }); return res.ok || res.status === 400; } catch { return false; }
}
