import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { SettingsTabs } from '@/components/settings-tabs';
export const dynamic = 'force-dynamic';
// Configurações (agency admins). Client roles and operators never see agency administration (OAuth, users, platform).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getSession();
  if (!actor) redirect('/login');
  if (actor.role.startsWith('CLIENT_')) redirect(actor.clientIds[0] ? '/clients/' + actor.clientIds[0] : '/account');
  if (actor.role === 'ANALYST') redirect('/clients');
  return <Shell actor={actor}><div className="page"><header className="page-header"><div><h1>Configurações</h1><div className="page-description">Integrações, usuários e ajustes da plataforma.</div></div></header><SettingsTabs />{children}</div></Shell>;
}
