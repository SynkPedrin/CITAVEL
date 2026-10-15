import { cookies } from 'next/headers';
import { requireAdmin, assertRequestMutation } from '@/lib/auth';
import { appOrigin } from '@/lib/security';
import { encryptConfig, platformConfig } from '@/lib/private-config';
import { googleCallback } from '@/lib/integrations/google-connect';
import { newAuthRequest } from '@/lib/gsc/oauth';
import { markConnecting, oauthClientConfigured } from '@/lib/gsc/connection';
import { HttpError } from '@/lib/security';
import { ok, fail } from '../../../../_utils';
// Starts the organization-level Google authorization (Search Console read-only). Admins only.
export async function POST(request: Request) {
  try {
    assertRequestMutation(request); const actor = await requireAdmin();
    if (!(await oauthClientConfigured())) throw new HttpError(400, 'Configure o ID e o segredo OAuth do Google em Configurações → Acesso Google.', 'OAUTH_CLIENT_MISSING');
    const cfg = await platformConfig(); const redirectUri = googleCallback();
    const auth = newAuthRequest(cfg.GOOGLE_CLIENT_ID, redirectUri);
    const payload = { kind: 'HUB', state: auth.state, verifier: auth.verifier, actorId: actor.id, organizationId: actor.organizationId, expires: Date.now() + 600_000 };
    (await cookies()).set('citavel_google_state', encryptConfig(payload), { httpOnly: true, secure: appOrigin().startsWith('https:'), sameSite: 'lax', path: '/api/integrations/google', maxAge: 600 });
    await markConnecting(actor.organizationId);
    return ok({ url: auth.url, redirectUri });
  } catch (e) { return fail(e); }
}
