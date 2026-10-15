'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, SlidersHorizontal, LogOut, Menu, X, UserRound } from 'lucide-react';
import { labels } from './ui';

// Manager 2.0: one compact global sidebar. Client sections live in the client header (Google / SEO, Presença em IA, Relatórios).
export function Shell({ children, actor }: { children: React.ReactNode; actor: { name: string; role: string }; client?: unknown; pendingApprovals?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(actor.role);
  const items: [string, string, typeof Building2][] = [['/clients', 'Clientes', Building2], ...(isAdmin ? [['/admin/settings', 'Configurações', SlidersHorizontal] as [string, string, typeof Building2]] : [])];
  const active = (href: string) => href === '/clients' ? pathname === '/clients' || pathname.startsWith('/clients/') : pathname.startsWith('/admin');
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', close); };
  }, [open]);
  async function logout() {
    setSigningOut(true); setLogoutError('');
    try { const r = await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Citavel-Request': '1' } }); if (!r.ok) throw new Error('Não foi possível sair.'); window.location.assign('/login'); }
    catch (e) { setLogoutError(e instanceof Error ? e.message : 'Não foi possível sair.'); setSigningOut(false); }
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <button className="mobile-menu icon-button" aria-label="Abrir menu" aria-controls="main-navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button>
    {open && <button className="drawer-overlay" aria-label="Fechar menu" onClick={() => setOpen(false)} />}
    <aside id="main-navigation" className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Menu principal">
      <div className="brand-row">
        <Link href="/clients" className="brand" aria-label="CITÁVEL Manager — clientes" onClick={() => setOpen(false)}><img src="/brand/citavel-logo.png" width={2172} height={724} alt="CITÁVEL" /></Link>
        <button className="icon-button mobile-close" aria-label="Fechar menu" onClick={() => setOpen(false)}><X size={18} /></button>
      </div>
      <nav aria-label="Navegação principal">{items.map(([href, label, Icon]) => <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={active(href) ? 'active' : ''} onClick={() => setOpen(false)}><Icon size={17} /><span>{label}</span></Link>)}</nav>
      <div className="sidebar-bottom">
        <Link className={`user-profile ${pathname.startsWith('/account') ? 'active' : ''}`} href="/account" title="Meu perfil" onClick={() => setOpen(false)}><div className="avatar">{actor.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</div><span><strong>{actor.name}</strong><small>{labels[actor.role] || actor.role}</small></span><UserRound size={14} className="profile-icon" /></Link>
        <button className="logout-button" onClick={logout} disabled={signingOut}><LogOut size={14} /><span>{signingOut ? 'Saindo…' : 'Sair'}</span></button>
        {logoutError && <p className="sidebar-error" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="main-content" id="main-content" tabIndex={-1}>
      {children}
      <footer className="app-footer"><span>CITÁVEL®</span><span>Presença que constrói demanda.</span></footer>
    </div>
  </div>;
}
