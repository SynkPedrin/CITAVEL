import { redirect } from 'next/navigation';
import { getSession, canOperate } from '@/lib/auth';
import { requireClientAccess } from '@/lib/clients';
import { AiPresence } from '@/components/ai-presence';
export const dynamic = 'force-dynamic';
export default async function AiPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string; p?: string; k?: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id } = await params; await requireClientAccess(actor, id);
  const q = await searchParams;
  return <AiPresence id={id} operate={canOperate(actor)} query={{ m: typeof q.m === 'string' ? q.m : undefined, p: typeof q.p === 'string' ? q.p : undefined, k: typeof q.k === 'string' ? q.k : undefined }} />;
}
