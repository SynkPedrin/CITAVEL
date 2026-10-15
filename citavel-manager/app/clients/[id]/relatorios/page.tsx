import { redirect } from 'next/navigation';
import { getSession, canOperate } from '@/lib/auth';
import { requireClientAccess } from '@/lib/clients';
import { ReportsSection } from '@/components/reports-section';
export const dynamic = 'force-dynamic';
export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id } = await params; await requireClientAccess(actor, id);
  return <ReportsSection id={id} operate={canOperate(actor)} />;
}
