import { redirect } from 'next/navigation';
import { getSession, canManage } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ClientForm } from '@/components/client-form';
export const dynamic = 'force-dynamic';
export default async function NewClient() {
  const actor = await getSession(); if (!actor) redirect('/login'); if (!canManage(actor)) redirect('/clients');
  return <div className="page narrow"><PageHeader eyebrow="Clientes" title="Novo cliente" description="Cadastro simples. Depois, vincule a propriedade do Search Console em Configurações → Integrações." /><ClientForm /></div>;
}
