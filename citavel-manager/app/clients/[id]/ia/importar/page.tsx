import { redirect } from 'next/navigation';
import { getSession, canOperate } from '@/lib/auth';
import { requireClientAccess } from '@/lib/clients';
import { db } from '@/lib/db';
import { AiImport } from '@/components/ai-import';
export const dynamic = 'force-dynamic';
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id } = await params; await requireClientAccess(actor, id);
  if (!canOperate(actor)) redirect(`/clients/${id}/ia`);
  const c = await db.client.findUniqueOrThrow({ where: { id }, select: { name: true } });
  return <div className="section-stack"><h2 className="section-title big">Importar medição</h2><AiImport clientId={id} clientName={c.name} /></div>;
}
