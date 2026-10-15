import { redirect } from 'next/navigation';
// Retired in Manager 2.0 (data preserved in the database).
export default async function Retired({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/clients/${id}/google`); }
