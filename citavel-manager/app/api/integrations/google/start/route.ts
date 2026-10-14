import { cookies } from 'next/headers';
import { createHash,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAdmin,assertClient,assertRequestMutation } from '@/lib/auth';
import { readJson,appOrigin,HttpError } from '@/lib/security';
import { encryptConfig,platformConfig } from '@/lib/private-config';
import { googleProviderSchema } from '@/lib/settings-schema';
import { googleScopes,googleCallback } from '@/lib/integrations/google-connect';
import { ok,fail } from '../../../_utils';
export async function POST(request:Request){try{
  assertRequestMutation(request);const actor=await requireAdmin();const {clientId,provider}=z.object({clientId:z.string().max(128),provider:googleProviderSchema}).strict().parse(await readJson(request));await assertClient(actor,clientId);
  const cfg=await platformConfig();if(!cfg.GOOGLE_CLIENT_ID||!cfg.GOOGLE_CLIENT_SECRET)throw new HttpError(400,'Salve primeiro o ID e o segredo OAuth nas configurações da plataforma.');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const payload={state,verifier,clientId,provider,actorId:actor.id,organizationId:actor.organizationId,expires:Date.now()+600000};
  (await cookies()).set('citavel_google_state',encryptConfig(payload),{httpOnly:true,secure:appOrigin().startsWith('https:'),sameSite:'lax',path:'/api/integrations/google',maxAge:600});
  const params=new URLSearchParams({client_id:cfg.GOOGLE_CLIENT_ID,redirect_uri:googleCallback(),response_type:'code',scope:googleScopes[provider],state,access_type:'offline',prompt:'consent',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return ok({url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`,redirectUri:googleCallback()});
}catch(e){return fail(e)}}
