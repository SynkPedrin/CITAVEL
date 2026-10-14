import { getClientData } from '@/lib/sync';
import { ClientTabs, ContentSection } from '@/components/client-sections';
export const dynamic = 'force-dynamic';
export default async function ClientContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getClientData(id);
  if (!data) return null;
  return <ContentSection id={id} data={data} tabs={<ClientTabs id={id} active="content" />} />;
}
