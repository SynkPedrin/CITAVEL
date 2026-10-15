import { redirect, notFound } from 'next/navigation';
import { getSession, canManage } from '@/lib/auth';
import { db } from '@/lib/db';
import { ClientForm } from '@/components/client-form';
export const dynamic = 'force-dynamic';
export default async function EditClient({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id } = await params;
  if (!canManage(actor)) redirect(`/clients/${id}/google`);
  const c = await db.client.findFirst({ where: { id, organizationId: actor.organizationId } }); if (!c) notFound();
  const t = ((c.metadata || {}) as any).gsc?.terms || {};
  return <div className="narrow"><h2 className="section-title">Editar cliente</h2><ClientForm id={id} initial={{ name: c.name, domain: c.domain, industry: c.industry, locations: t.locations || (c.location ? [c.location] : []), services: t.services || [], brandTerms: t.brand || [], status: c.status }} /></div>;
}
