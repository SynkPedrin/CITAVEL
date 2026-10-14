import { z } from 'zod';import { db } from '@/lib/db';
import { requireAdmin,assertClient,assertRequestMutation } from '@/lib/auth';
import { readJson } from '@/lib/security';
import { googleProviderSchema,resourceSchemas } from '@/lib/settings-schema';
import { syncGoogle } from '@/lib/integrations/google-connect';
import { ok,fail } from '../../_utils';
const schema=z.object({clientId:z.string().max(128),provider:googleProviderSchema,settings:z.record(z.string(),z.string().max(512)).optional(),action:z.enum(['save','sync'])}).strict();
export async function POST(request:Request){try{assertRequestMutation(request);const actor=await requireAdmin();const body=schema.parse(await readJson(request));await assertClient(actor,body.clientId);
 if(body.action==='sync')return ok(await syncGoogle(body.clientId,body.provider));
 const settings=resourceSchemas[body.provider].parse(body.settings);const where={clientId_provider:{clientId:body.clientId,provider:body.provider}};const previous=await db.integration.findUnique({where});const metadata={...(previous?.metadata as any||{}),managerConfigured:true,settings,detail:'Configuração salva. Teste a conexão para confirmar o acesso.'};delete metadata.snapshot;
 await db.integration.upsert({where,create:{clientId:body.clientId,provider:body.provider,status:'PENDING',metadata},update:{status:'PENDING',metadata}});return ok({ok:true});
}catch(e){return fail(e)}}
