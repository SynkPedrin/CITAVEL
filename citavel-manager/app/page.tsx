import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
export default async function Home() { const actor = await getSession(); if (!actor) redirect('/login'); redirect(actor.role.startsWith('CLIENT_') && !actor.clientIds.length ? '/account' : '/clients'); }
