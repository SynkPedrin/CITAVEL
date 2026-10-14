import { requireAdmin,assertRequestMutation } from '@/lib/auth';
import { HttpError,readJson } from '@/lib/security';
import { checkService } from '@/lib/integrations/checks';
import { z } from 'zod';import { ok,fail } from '../../_utils';
export async function POST(request:Request){try{assertRequestMutation(request);const actor=await requireAdmin();if(actor.role!=='SUPER_ADMIN')throw new HttpError(403,'Acesso restrito à configuração da plataforma.');const {provider}=z.object({provider:z.enum(['ENGINE','N8N','OLLAMA','GEMINI'])}).strict().parse(await readJson(request));return ok(await checkService(provider));}catch(e){return fail(e)}}
