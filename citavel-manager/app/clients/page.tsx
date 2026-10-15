import Link from 'next/link';
import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getSession, canManage } from '@/lib/auth';
import { listClients } from '@/lib/clients';
import { PageHeader } from '@/components/ui';
import { ClientList } from '@/components/client-list';
export const dynamic = 'force-dynamic';
export default async function ClientsPage() {
  const actor = await getSession(); if (!actor) redirect('/login');
  const clients = await listClients(actor);
  if (actor.role.startsWith('CLIENT_') && clients.length === 1) redirect(`/clients/${clients[0].id}/google`);
  return <div className="page">
    <PageHeader title="Clientes" description="Acompanhe a presença digital das empresas atendidas." actions={canManage(actor) ? <Link className="button primary" href="/clients/novo"><Plus size={15} /> Novo cliente</Link> : undefined} />
    <ClientList clients={clients.map(c => ({ id: c.id, name: c.name, domain: c.domain, status: c.status, google: { state: c.google.state, lastSyncAt: c.google.lastSyncAt?.toISOString() || null }, lastMeasurement: c.lastMeasurement ? (c.lastMeasurement.executedAt || c.lastMeasurement.importedAt.toISOString()) : null, lastReport: c.lastReport?.createdAt.toISOString() || null }))} canManage={canManage(actor)} />
  </div>;
}
