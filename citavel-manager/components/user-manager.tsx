'use client';

import { useState, type FormEvent } from 'react';
import { Copy, Plus, UserRound, X } from 'lucide-react';
import { Badge, Panel, labels } from './ui';
import type { Role } from '@/lib/security';

type ClientChoice = { id: string; name: string };
type UserRow = { id: string; name: string; email: string; status: string; mustChangePassword: boolean; role: Role; clients: ClientChoice[]; sharedAccount: boolean };
const roles: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ANALYST', 'CLIENT_ADMIN', 'CLIENT_VIEWER'];
const fresh = { name: '', email: '', role: 'ANALYST' as Role, clientIds: [] as string[] };

export function UserManager({ actor, clients, initialUsers }: { actor: { id: string; role: Role }; clients: ClientChoice[]; initialUsers: UserRow[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState(fresh);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState<{ email: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmation, setConfirmation] = useState<{ user: UserRow; action: 'reset' | 'disable' } | null>(null);
  const [query, setQuery] = useState('');
  const clientRole = form.role.startsWith('CLIENT_');

  async function mutate(url: string, method: string, body: object, email?: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o acesso.');
      if (data.temporaryPassword) { setSecret({ email: email || form.email, value: data.temporaryPassword }); setCopied(false); }
      const refreshed = await fetch('/api/users', { cache: 'no-store' });
      if (!refreshed.ok) { window.location.assign('/login'); return; }
      setUsers((await refreshed.json()).users);
      setMessage('Acesso atualizado com sucesso.');
      setOpen(false); setConfirmation(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }

  function edit(user?: UserRow) {
    setForm(user ? { name: user.name, email: user.email, role: user.role, clientIds: user.clients.map(client => client.id) } : fresh);
    setEditing(user?.id || null); setError(''); setMessage(''); setConfirmation(null); setOpen(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (clientRole && !form.clientIds.length) { setError('Selecione pelo menos um cliente.'); return; }
    const body = { name: form.name, role: form.role, clientIds: clientRole ? form.clientIds : [] };
    void mutate(editing ? `/api/users/${editing}` : '/api/users', editing ? 'PATCH' : 'POST', editing ? body : { ...body, email: form.email });
  }
  async function copySecret() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret.value); setCopied(true); }
    catch { setError('Selecione e copie a senha exibida abaixo.'); }
  }

  return <div className="card-list" style={{ gap: 20 }}>
    {secret && <Panel wallpaper><div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><div className="eyebrow">Senha temporária criada</div><h2>{secret.email}</h2><p className="kicker">Copie agora. Ao fechar, esta senha não poderá ser consultada novamente.</p></div><button type="button" className="icon-button" aria-label="Ocultar senha temporária" onClick={() => setSecret(null)}><X size={18}/></button></div><div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap' }}><code style={{ fontSize: 18, overflowWrap: 'anywhere', userSelect: 'all' }}>{secret.value}</code><button className="button" onClick={copySecret}><Copy size={14}/>{copied ? 'Copiada' : 'Copiar senha'}</button></div><p className="kicker">O acesso ficará marcado para troca da senha no primeiro uso.</p></Panel>}
    {error && <div className="notice" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    <div className="section-heading"><label className="field" style={{ margin: 0, width: 'min(100%, 360px)' }}><span>Buscar usuário</span><input type="search" value={query} placeholder="Nome ou e-mail" onChange={event => setQuery(event.target.value)}/></label><button className="button primary" disabled={busy} onClick={() => edit()}><Plus size={15}/>Novo usuário</button></div>
    {open && <Panel wallpaper><div className="section-heading"><h2>{editing ? 'Editar acesso' : 'Criar acesso'}</h2><button className="icon-button" aria-label="Fechar formulário" disabled={busy} onClick={() => setOpen(false)}><X size={18}/></button></div><form onSubmit={submit}><div className="form-grid"><label className="field"><span>Nome</span><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={120}/></label><label className="field"><span>E-mail</span><input type="email" value={form.email} disabled={Boolean(editing)} onChange={event => setForm({ ...form, email: event.target.value })} required maxLength={254}/></label><label className="field full"><span>Perfil de acesso</span><select value={form.role} disabled={editing === actor.id} onChange={event => setForm({ ...form, role: event.target.value as Role, clientIds: [] })}>{roles.filter(role => actor.role === 'SUPER_ADMIN' || role !== 'SUPER_ADMIN').map(role => <option key={role} value={role}>{labels[role]}</option>)}</select><small className="kicker">Administradores gerenciam a plataforma. Analistas operam os clientes. Perfis de cliente acessam apenas os clientes selecionados.</small></label>{clientRole && <fieldset className="field full" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}><legend>Clientes permitidos</legend>{clients.length ? clients.map(client => <label key={client.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}><input type="checkbox" checked={form.clientIds.includes(client.id)} onChange={event => setForm({ ...form, clientIds: event.target.checked ? [...form.clientIds, client.id] : form.clientIds.filter(id => id !== client.id) })} style={{ width: 16, height: 16 }}/>{client.name}</label>) : <p className="kicker">Cadastre um cliente antes de criar acessos de cliente.</p>}</fieldset>}</div><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button><button className="button primary" disabled={busy || (clientRole && !clients.length)}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar e gerar senha'}</button></div></form></Panel>}
    {confirmation && <Panel><h2>{confirmation.action === 'reset' ? 'Gerar nova senha temporária?' : 'Desativar este acesso?'}</h2><p className="kicker">{confirmation.user.name} · {confirmation.user.email}. {confirmation.action === 'reset' ? 'A senha anterior deixará de funcionar e as sessões atuais serão encerradas.' : 'As sessões serão encerradas. Você poderá reativar o usuário nesta tela.'}</p><div className="form-actions"><button className="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</button><button className="button primary" disabled={busy} onClick={() => void mutate(`/api/users/${confirmation.user.id}`, 'PATCH', confirmation.action === 'reset' ? { resetPassword: true } : { status: 'DISABLED' }, confirmation.user.email)}>{busy ? 'Salvando…' : 'Confirmar'}</button></div></Panel>}
    <div className="table-wrap"><table className="table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Clientes</th><th>Status</th><th>Gerenciar</th></tr></thead><tbody>{users.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase())).map(user => {
      const editable = !user.sharedAccount && (actor.role === 'SUPER_ADMIN' || user.role !== 'SUPER_ADMIN');
      return <tr key={user.id}><td><strong><UserRound size={13} style={{ marginRight: 6 }}/>{user.name}{user.id === actor.id ? ' (você)' : ''}</strong><small>{user.email}</small>{user.mustChangePassword && <small>Troca de senha pendente</small>}</td><td><Badge status={user.role}/></td><td>{user.role.startsWith('CLIENT_') ? user.clients.map(client => client.name).join(', ') || 'Sem cliente atribuído' : 'Todos da organização'}</td><td><Badge status={user.status}/></td><td>{editable ? <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}><button className="button" disabled={busy} onClick={() => edit(user)}>Editar</button>{user.id !== actor.id && <><button className="button" disabled={busy} onClick={() => { setError(''); setConfirmation({ user, action: 'reset' }); }}>Nova senha</button><button className="button" disabled={busy} onClick={() => user.status === 'DISABLED' ? void mutate(`/api/users/${user.id}`, 'PATCH', { status: 'ACTIVE' }) : setConfirmation({ user, action: 'disable' })}>{user.status === 'DISABLED' ? 'Reativar' : 'Desativar'}</button></>}</div> : <span className="kicker">{user.sharedAccount ? 'Conta compartilhada entre organizações' : 'Gerenciado pelo super administrador'}</span>}</td></tr>;
    })}</tbody></table>{!users.some(user => `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase())) && <p className="kicker" style={{ padding: 20 }}>Nenhum usuário encontrado.</p>}</div>
  </div>;
}
