import { redirect } from 'next/navigation';
import { getSession, canManage } from '@/lib/auth';
import { GoogleSection } from '@/components/google-section';
import { requireClientAccess } from '@/lib/clients';
export const dynamic = 'force-dynamic';
export default async function GooglePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await getSession(); if (!actor) redirect('/login');
  const { id } = await params; await requireClientAccess(actor, id);
  return <GoogleSection id={id} search={await searchParams} canAdmin={canManage(actor)} />;
}
