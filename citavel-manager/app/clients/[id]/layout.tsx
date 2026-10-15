import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { getSession, canManage, canOperate } from '@/lib/auth';
import { RefreshDataButton } from '@/components/refresh-button';
import { clientHeader } from '@/lib/clients';
import { DateLabel } from '@/components/ui';
import { ClientTabs } from '@/components/client-tabs';
export const dynamic = 'force-dynamic';
const googleLabel: Record<string, string> = { LINKED: 'Google conectado', NOT_LINKED: 'Google não vinculado', AUTH_EXPIRED: 'Google: reautorização necessária', DISCONNECTED: 'Google desconectado', SYNC_ERROR: 'Google: erro na última sincronização' };
// Header + three tabs. Persisted across tab navigation (only the page segment re-renders).
export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login');
  const { id } = await params;
  const c = await clientHeader(actor, id);
  if (!c) notFound(); // also covers clients of other tenants: indistinguishable from non-existent
  const host = (() => { try { return new URL(c.domain).hostname.replace(/^www\./, ''); } catch { return c.domain; } })();
  return <div className="page client-page">
    <header className="client-header">
      <div className="client-title">
        <Link href="/clients" className="crumb">Clientes</Link>
        <h1>{c.name}</h1>
        <div className="client-meta">
          <a href={c.domain} target="_blank" rel="noopener noreferrer">{host}</a>
          <span className={`status-chip ${c.google.state === 'LINKED' ? 'ok' : c.google.state === 'NOT_LINKED' ? 'muted' : 'warn'}`}><span className="dot" />{googleLabel[c.google.state]}</span>
          <span className="muted-text">Atualizado em <DateLabel value={c.updatedAt} time /></span>
          {c.status === 'DRAFT' && <span className="pill muted">Rascunho</span>}
        </div>
      </div>
      <div className="header-actions">{canOperate(actor) && c.google.state !== 'NOT_LINKED' && <RefreshDataButton clientId={id} />}{canManage(actor) && <Link className="button ghost" href={`/clients/${id}/editar`}><Pencil size={14} /> Editar cliente</Link>}</div>
    </header>
    <ClientTabs id={id} />
    <div className="client-body">{children}</div>
  </div>;
}
