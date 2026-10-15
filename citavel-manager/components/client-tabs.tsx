'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const TABS = [['google', 'Google / SEO'], ['ia', 'Presença em IA'], ['relatorios', 'Relatórios']] as const;
export function ClientTabs({ id }: { id: string }) {
  const path = usePathname();
  return <nav className="client-tabs" aria-label="Seções do cliente">{TABS.map(([k, label]) => { const active = path.startsWith(`/clients/${id}/${k}`); return <Link key={k} href={`/clients/${id}/${k}`} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} prefetch>{label}</Link>; })}</nav>;
}
