import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const actor = await getSession(); if (!actor) redirect('/login');
  if (actor.forcePasswordChange) redirect('/account/password');
  return <Shell actor={actor}>{children}</Shell>;
}
