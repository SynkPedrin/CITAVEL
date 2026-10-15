'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search, ArrowRight } from 'lucide-react';
import { DateLabel } from './ui';
type Row = { id: string; name: string; domain: string; status: string; google: { state: string; lastSyncAt: string | null }; lastMeasurement: string | null; lastReport: string | null };
const googleText: Record<string, [string, string]> = { LINKED: ['Conectado', 'ok'], NOT_LINKED: ['Não vinculado', 'muted'], AUTH_EXPIRED: ['Reautorizar', 'warn'], DISCONNECTED: ['Desconectado', 'warn'], SYNC_ERROR: ['Erro na sincronização', 'warn'] };
const host = (d: string) => { try { return new URL(d).hostname.replace(/^www\./, ''); } catch { return d; } };
export function ClientList({ clients, canManage }: { clients: Row[]; canManage: boolean }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => { const n = q.trim().toLowerCase(); return n ? clients.filter(c => c.name.toLowerCase().includes(n) || c.domain.toLowerCase().includes(n)) : clients; }, [q, clients]);
  if (!clients.length) return <div className="empty-state"><h3>Nenhum cliente disponível</h3><p>{canManage ? 'Cadastre o primeiro cliente para começar.' : 'Nenhum cliente foi atribuído à sua conta.'}</p>{canManage && <Link className="button primary" href="/clients/novo">Cadastrar cliente</Link>}</div>;
  return <>
    <label className="search-field"><Search size={15} aria-hidden /><input type="search" placeholder="Buscar por nome ou domínio" aria-label="Buscar clientes" value={q} onChange={e => setQ(e.target.value)} /></label>
    <div className="client-grid">{list.map(c => { const [g, tone] = googleText[c.google.state] || [c.google.state, 'muted']; return <Link key={c.id} href={`/clients/${c.id}/google`} className="client-card">
      <div className="client-card-head"><span className="client-initial" aria-hidden>{c.name.slice(0, 1)}</span><div><h3>{c.name}</h3><small>{host(c.domain)}</small></div>{c.status !== 'ACTIVE' && <span className="pill muted">{c.status === 'DRAFT' ? 'Rascunho' : c.status === 'PAUSED' ? 'Pausado' : 'Em implantação'}</span>}</div>
      <dl className="client-facts">
        <div><dt>Google</dt><dd><span className={`dot ${tone}`} />{g}{c.google.lastSyncAt && <small> · <DateLabel value={c.google.lastSyncAt} /></small>}</dd></div>
        <div><dt>Última medição de IA</dt><dd>{c.lastMeasurement ? <DateLabel value={c.lastMeasurement} /> : <span className="muted-text">Nenhuma</span>}</dd></div>
        <div><dt>Último relatório</dt><dd>{c.lastReport ? <DateLabel value={c.lastReport} /> : <span className="muted-text">Nenhum</span>}</dd></div>
      </dl>
      <span className="client-open">Abrir <ArrowRight size={14} /></span>
    </Link>; })}</div>
    {!list.length && <p className="kicker" style={{ marginTop: 16 }}>Nenhum cliente encontrado para “{q}”.</p>}
  </>;
}
