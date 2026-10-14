import { getClientData } from '@/lib/sync';
import { ActionsSection, ClientTabs } from '@/components/client-sections';
export const dynamic = 'force-dynamic';
export default async function ClientActionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getClientData(id);
  if (!data) return null;
  return <ActionsSection id={id} data={data} tabs={<ClientTabs id={id} active="actions" />} />;
}
