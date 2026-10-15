'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const TABS = [['/admin/integrations', 'Integrações'], ['/admin/users', 'Usuários e acessos'], ['/admin/settings', 'Plataforma']] as const;
export function SettingsTabs() { const p = usePathname(); return <nav className="client-tabs" aria-label="Configurações">{TABS.map(([h, l]) => <Link key={h} href={h} className={p.startsWith(h) ? 'active' : ''} aria-current={p.startsWith(h) ? 'page' : undefined}>{l}</Link>)}</nav>; }
