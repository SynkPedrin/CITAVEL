import 'server-only';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { Actor, HttpError, Role, appOrigin, assertMutation, hashToken, newToken, secureCookie, canManage, canOperate, isClientActor, permitsClient } from './security';

const COOKIE = 'citavel_session';
const SESSION_DAYS = 7;

function actorFrom(user: { id:string; name:string; email:string; mustChangePassword:boolean; memberships:{role:Role;organizationId:string}[]; clientUsers:{clientId:string}[] }): Actor {
  const membership = user.memberships[0];
  if (!membership) throw new HttpError(403, 'Usuário sem organização ativa.', 'NO_MEMBERSHIP');
  return { id:user.id, name:user.name, email:user.email, role:membership.role, organizationId:membership.organizationId, clientIds:user.clientUsers.map(x=>x.clientId), forcePasswordChange:user.mustChangePassword };
}

export async function getSession(): Promise<Actor|null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where:{tokenHash:hashToken(token)}, include:{user:{include:{memberships:true,clientUsers:true}}} });
  if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return null;
  return actorFrom(session.user);
}
export async function requireSession() { const actor=await getSession(); if(!actor) throw new HttpError(401,'Faça login para continuar.','AUTH_REQUIRED'); return actor; }
export async function requireAdmin() { const actor=await requireSession(); if(!canManage(actor)) throw new HttpError(403,'Acesso restrito à operação CITÁVEL.','FORBIDDEN'); return actor; }
export async function requireOperator() { const actor=await requireSession(); if(!canOperate(actor)) throw new HttpError(403,'Você não tem permissão para esta ação.','FORBIDDEN'); return actor; }
export async function assertClient(actor:Actor, clientId:string) {
  const client=await db.client.findUnique({where:{id:clientId},select:{id:true,organizationId:true}});
  if(!client || !permitsClient(actor,client)) throw new HttpError(403,'Este cliente não está disponível para sua conta.','TENANT_FORBIDDEN');
  return client;
}
export function assertRequestMutation(request:Request){assertMutation(request,appOrigin());}

async function rateLimit(identifier:string) {
  const now=new Date(); const windowMs=15*60*1000; const old=await db.loginAttempt.findUnique({where:{identifier}});
  if(old?.blockedUntil && old.blockedUntil>now) throw new HttpError(429,'Muitas tentativas. Tente novamente em alguns minutos.','LOGIN_RATE_LIMIT');
  if(!old || now.getTime()-old.windowStart.getTime()>windowMs){await db.loginAttempt.upsert({where:{identifier},create:{identifier,attempts:0},update:{attempts:0,windowStart:now,blockedUntil:null}});return;}
  if(old.attempts>=8){await db.loginAttempt.update({where:{identifier},data:{blockedUntil:new Date(now.getTime()+windowMs)}});throw new HttpError(429,'Muitas tentativas. Tente novamente em alguns minutos.','LOGIN_RATE_LIMIT');}
}
export async function login(email:string,password:string) {
  const normalized=email.trim().toLowerCase(); await rateLimit(normalized);
  const user=await db.user.findUnique({where:{email:normalized},include:{memberships:true,clientUsers:true}});
  const valid=user && user.status==='ACTIVE' && await bcrypt.compare(password,user.passwordHash);
  if(!valid){await db.loginAttempt.upsert({where:{identifier:normalized},create:{identifier:normalized,attempts:1},update:{attempts:{increment:1}}});throw new HttpError(401,'E-mail ou senha inválidos.','INVALID_LOGIN');}
  await db.loginAttempt.delete({where:{identifier:normalized}}).catch(()=>{});
  const token=newToken(); const expiresAt=new Date(Date.now()+SESSION_DAYS*86400000);
  await db.session.create({data:{tokenHash:hashToken(token),userId:user.id,expiresAt}});
  (await cookies()).set(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:secureCookie(),path:'/',expires:expiresAt});
  return actorFrom(user);
}
export async function logout(){const jar=await cookies();const token=jar.get(COOKIE)?.value;if(token)await db.session.deleteMany({where:{tokenHash:hashToken(token)}});jar.delete(COOKIE);}
export async function changePassword(actor:Actor,currentPassword:string,newPassword:string){const user=await db.user.findUnique({where:{id:actor.id}});if(!user||!(await bcrypt.compare(currentPassword,user.passwordHash)))throw new HttpError(401,'A senha atual não confere.','INVALID_PASSWORD');await db.user.update({where:{id:actor.id},data:{passwordHash:await bcrypt.hash(newPassword,12),mustChangePassword:false}});await db.session.deleteMany({where:{userId:actor.id,NOT:{tokenHash:hashToken((await cookies()).get(COOKIE)?.value||'')}}});}
export async function revokeUserSessions(userId:string){await db.session.deleteMany({where:{userId}})}
export { canManage, canOperate, isClientActor };
