import { requireAdmin,assertRequestMutation } from '@/lib/auth';
import { HttpError,readJson } from '@/lib/security';
import { publicSettings,savePlatform } from '@/lib/private-config';
import { settingUpdateSchema } from '@/lib/settings-schema';
import { writePrivate } from '@/lib/private-config';
import { ZodError } from 'zod';
import { ok,fail } from '../_utils';
export const dynamic = 'force-dynamic';
export async function GET() { try { const actor=await requireAdmin();if(actor.role!=='SUPER_ADMIN')throw new HttpError(403,'Configuração exclusiva do administrador da plataforma.');return ok({groups:await publicSettings()}); } catch(e) { return fail(e); } }
export async function PATCH(request:Request) { try {
  assertRequestMutation(request); const actor=await requireAdmin();if(actor.role!=='SUPER_ADMIN')throw new HttpError(403,'Configuração exclusiva do administrador da plataforma.');
  const body=settingUpdateSchema.parse(await readJson(request));
  await savePlatform(body.values);await writePrivate(`check-${body.group}`,null);
  return ok({ok:true,groups:await publicSettings()});
} catch(e) { return fail(e instanceof ZodError?new HttpError(400,e.issues[0]?.message||'Dados inválidos.','INVALID_SETTING'):e); } }
