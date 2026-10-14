import { redirect } from 'next/navigation';
import { getSession, canManage } from '@/lib/auth';
import { db } from '@/lib/db';
import { Shell } from '@/components/shell';
import { PageHeader } from '@/components/ui';
import { UserManager } from '@/components/user-manager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const actor = await getSession();
  if (!actor) redirect('/login');
  if (!canManage(actor)) redirect('/account');
  const [users, clients] = await Promise.all([
    db.user.findMany({ where: { memberships: { some: { organizationId: actor.organizationId } } }, include: { memberships: true, clientUsers: { where: { client: { organizationId: actor.organizationId } }, include: { client: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' } }),
    db.client.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return <Shell actor={actor}><div className="page"><PageHeader eyebrow="Acessos da equipe" title="Usuários" description="Crie acessos, atribua clientes e gerencie quem pode operar sua plataforma."/><UserManager actor={{ id: actor.id, role: actor.role }} clients={clients} initialUsers={users.map(user => ({ id: user.id, name: user.name, email: user.email, status: user.status, mustChangePassword: user.mustChangePassword, role: user.memberships.find(item => item.organizationId === actor.organizationId)!.role, clients: user.clientUsers.map(item => item.client), sharedAccount: user.memberships.length > 1 }))}/></div></Shell>;
}
