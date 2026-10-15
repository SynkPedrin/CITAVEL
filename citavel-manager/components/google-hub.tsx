'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, Badge, DateLabel } from './ui';

type Property = { id: string; siteUrl: string; propertyType: string; permissionLevel: string; accessible: boolean; binding: null | { id: string; clientId: string; clientName: string; isPrimary: boolean; lastSuccessfulSyncAt: string | null; availableStartDate: string | null; availableEndDate: string | null } };
type Job = { id: string; type: string; status: string; client: string; siteUrl: string; requestedStartDate: string; requestedEndDate: string; availableStartDate: string | null; availableEndDate: string | null; rowsImported: number; apiRequests: number; errorCode: string | null; errorDetail: string | null; createdAt: string; finishedAt: string | null };
type Overview = { status: string; email: string | null; connectedAt: string | null; lastSyncAt: string | null; lastDiscoveryAt: string | null; lastError: string | null; accessibleCount: number; boundCount: number; properties: Property[]; jobs: Job[] };

const statusLabel: Record<string, string> = { NOT_CONNECTED: 'Não conectado', CONNECTING: 'Conectando', CONNECTED: 'Conectado', AUTH_EXPIRED: 'Autorização expirada', SYNCING: 'Sincronizando', SYNC_ERROR: 'Erro de sincronização' };
const tone: Record<string, string> = { CONNECTED: 'CONNECTED', SYNCING: 'RUNNING', CONNECTING: 'RUNNING', AUTH_EXPIRED: 'FAILED', SYNC_ERROR: 'FAILED', NOT_CONNECTED: 'PENDING' };
const perm: Record<string, string> = { siteOwner: 'Proprietário', siteFullUser: 'Usuário completo', siteRestrictedUser: 'Usuário restrito', siteUnverifiedUser: 'Não verificado (sem dados)' };
const hubMessages: Record<string, string> = { connected: 'Conta Google conectada e propriedades listadas.', connected_discovery_failed: 'Conta conectada, mas a listagem de propriedades falhou. Use “Ver propriedades”.', declined: 'Autorização cancelada no Google.', failed: 'O Google não concluiu a autorização. Confira a URL de retorno cadastrada no Google Cloud.', offline_required: 'O Google não concedeu acesso contínuo. Tente conectar novamente.', scope_required: 'A permissão de leitura do Search Console não foi marcada. Conecte novamente e marque a permissão.', exchange_failed: 'O código de autorização foi recusado. Tente novamente.' };

export function GoogleHub({ initial, clients, oauthConfigured, callback, canConfigure, autoSync }: { initial: Overview; clients: { id: string; name: string; status: string }[]; oauthConfigured: boolean; callback: string; canConfigure: boolean; autoSync?: { active: boolean; lastTick: string | null } }) {
  const [setup, setSetup] = useState(false); const [creds, setCreds] = useState({ id: '', secret: '' });
  const router = useRouter();
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [view, setView] = useState<'properties' | 'bindings' | 'jobs'>('properties');
  const [selected, setSelected] = useState<Property | null>(null); const [clientId, setClientId] = useState(''); const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState({ name: '', domain: '' }); const [showDraft, setShowDraft] = useState(false);
  const o = initial; const connected = ['CONNECTED', 'SYNCING', 'SYNC_ERROR'].includes(o.status);
  const result = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('hub') : null;

  async function call(action: string, payload: Record<string, unknown> = {}, label = action) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/integrations/google/hub', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ action, ...payload }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha na operação.');
      router.refresh(); return d;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(''); }
  }
  async function saveCreds() {
    setBusy('creds'); setErr('');
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ group: 'GOOGLE', values: { GOOGLE_CLIENT_ID: creds.id.trim(), GOOGLE_CLIENT_SECRET: creds.secret.trim() } }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Não foi possível salvar as credenciais.');
      setCreds({ id: '', secret: '' }); setSetup(false); setBusy(''); await connect();
    } catch (e) { setErr((e as Error).message); setBusy(''); }
  }
  async function connect() {
    if (!oauthConfigured && !setup && busy !== 'creds') { setSetup(true); return; }
    setBusy('connect'); setErr('');
    try { const r = await fetch('/api/integrations/google/hub/start', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: '{}' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); window.location.assign(d.url); }
    catch (e) { setErr((e as Error).message || 'Não foi possível iniciar a autorização.'); setBusy(''); }
  }
  async function bind() {
    if (!selected || !clientId) return;
    const d = await call('bind', { propertyId: selected.id, clientId, confirm: true }, 'bind');
    if (d) { setMsg(`Propriedade vinculada. Importação do histórico iniciada (job ${d.job.jobId.slice(-6)}).`); setSelected(null); setConfirming(false); setClientId(''); setView('jobs'); }
  }
  async function createDraft() {
    const d = await call('draftClient', draft, 'draft');
    if (d) { setClientId(d.clientId); setShowDraft(false); setMsg(`Rascunho de cliente “${d.name}” criado (status DRAFT, não ativo). Confirme o vínculo.`); }
  }
  const clientName = clients.find(c => c.id === clientId)?.name;

  return <>
    <div className="section-heading"><div><h2>Google Search Console</h2><p>Uma conta Google conectada uma vez para a agência; cada propriedade é vinculada explicitamente a um cliente.</p></div><Badge status={tone[o.status]}>{statusLabel[o.status] || o.status}</Badge></div>
    {result && <div className="notice" role="status" style={{ marginBottom: 12 }}>{hubMessages[result] || 'Retorno da autorização recebido.'}</div>}
    {!oauthConfigured && <div className="notice warning" style={{ marginBottom: 12 }}>O aplicativo OAuth do Google ainda não está configurado. Salve o ID e o segredo em <a href="/admin/settings#google"><u>Configurações → Acesso Google</u></a>. URL de retorno a cadastrar no Google Cloud: <code style={{ overflowWrap: 'anywhere' }}>{callback}</code></div>}
    {o.status === 'AUTH_EXPIRED' && <div className="notice warning" style={{ marginBottom: 12 }}>A autorização Google expirou ou foi revogada. As sincronizações estão suspensas até reconectar. Os dados já importados continuam disponíveis.</div>}
    <Panel>
      <div className="grid grid-3">
        <div><div className="eyebrow">Conta Google</div><strong>{o.email || '—'}</strong><small className="kicker" style={{ display: 'block' }}>Conectada em <DateLabel value={o.connectedAt} time /></small></div>
        <div><div className="eyebrow">Propriedades</div><strong>{connected ? o.accessibleCount : '—'} acessíveis · {o.boundCount} vinculadas</strong><small className="kicker" style={{ display: 'block' }}>Listadas em <DateLabel value={o.lastDiscoveryAt} time /></small></div>
        <div><div className="eyebrow">Última sincronização</div><strong><DateLabel value={o.lastSyncAt} time /></strong><small className="kicker" style={{ display: 'block' }}>{autoSync?.active ? <>Atualização automática ativa: todos os clientes vinculados, todo dia (verificação a cada 10 min{autoSync.lastTick ? <>, última às <DateLabel value={autoSync.lastTick} time /></> : ''})</> : 'Atualização automática inativa neste servidor'}</small></div>
      </div>
      {setup && !oauthConfigured && <div className="notice" style={{ marginTop: 14 }}>
        <strong>Configure o aplicativo OAuth do Google (uma única vez).</strong> Use o Client ID e um <u>segredo novo</u> do cliente OAuth “Aplicativo da Web”. No Google Cloud, a URI de redirecionamento autorizada deve ser exatamente <code style={{ overflowWrap: 'anywhere' }}>{callback}</code>. Os valores ficam criptografados no servidor e nunca voltam ao navegador.
        {canConfigure ? <><div className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="g-cid">Client ID</label><input id="g-cid" autoComplete="off" placeholder="…apps.googleusercontent.com" value={creds.id} onChange={e => setCreds({ ...creds, id: e.target.value })} /></div>
          <div className="field"><label htmlFor="g-sec">Client Secret</label><input id="g-sec" type="password" autoComplete="new-password" placeholder="GOCSPX-…" value={creds.secret} onChange={e => setCreds({ ...creds, secret: e.target.value })} /></div>
        </div><div className="form-actions" style={{ justifyContent: 'flex-start' }}><button className="button ghost" onClick={() => setSetup(false)} disabled={!!busy}>Cancelar</button><button className="button primary" disabled={!!busy || !creds.id.trim() || !creds.secret.trim()} onClick={saveCreds}>{busy === 'creds' ? 'Salvando…' : busy === 'connect' ? 'Abrindo Google…' : 'Salvar e conectar com Google'}</button></div></>
          : <p style={{ marginTop: 8 }}>Somente o super administrador pode salvar essas credenciais.</p>}
      </div>}
      {err && <p className="notice warning" role="alert" style={{ marginTop: 14 }}>{err}</p>}
      {msg && <p className="notice" role="status" style={{ marginTop: 14 }}>{msg}</p>}
      <div className="form-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button className="button primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Abrindo Google…' : connected ? 'Reconectar com Google' : o.status === 'AUTH_EXPIRED' ? 'Reautorizar Google' : 'Conectar com Google'}</button>
        <button className="button" disabled={!connected || !!busy} onClick={async () => { const d = await call('discover', {}, 'discover'); if (d) { setMsg(`${d.properties} propriedade(s) encontrada(s).`); setView('properties'); } }}>{busy === 'discover' ? 'Consultando…' : 'Ver propriedades'}</button>
        <button className="button" disabled={!connected || !!busy || !o.boundCount} onClick={async () => { for (const p of o.properties.filter(p => p.binding)) await call('sync', { bindingId: p.binding!.id }, 'sync'); setView('jobs'); }}>{busy === 'sync' ? 'Enfileirando…' : 'Sincronizar'}</button>
        <button className="button" disabled={!!busy} onClick={() => setView('bindings')}>Gerenciar vínculos</button>
        <button className="button danger" disabled={!o.email || !!busy} onClick={async () => { if (confirm('Desconectar a conta Google? O acesso será revogado no Google e as sincronizações param. Dados já importados são mantidos.')) { const d = await call('disconnect', { confirm: true }, 'disconnect'); if (d) setMsg(d.revoked ? 'Conta desconectada e acesso revogado no Google.' : 'Conta desconectada. Não foi possível confirmar a revogação no Google; revise em myaccount.google.com/permissions.'); } }}>Desconectar</button>
      </div>
    </Panel>

    <div className="tabs" style={{ marginTop: 18 }}>{(['properties', 'bindings', 'jobs'] as const).map(v => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{{ properties: 'Propriedades encontradas', bindings: 'Vínculos', jobs: 'Sincronizações' }[v]}</button>)}</div>

    {view === 'properties' && (o.properties.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Propriedade (siteUrl)</th><th>Tipo</th><th>Permissão</th><th>Status</th><th></th></tr></thead><tbody>{o.properties.map(p => <tr key={p.id}>
      <td><strong style={{ overflowWrap: 'anywhere' }}>{p.siteUrl}</strong></td><td>{p.propertyType === 'DOMAIN' ? 'Domínio' : 'Prefixo de URL'}</td><td>{perm[p.permissionLevel] || p.permissionLevel}</td>
      <td>{p.binding ? <Badge status="CONNECTED">Vinculada · {p.binding.clientName}</Badge> : p.accessible ? <Badge status="PENDING">Disponível</Badge> : <Badge status="FAILED">Sem acesso</Badge>}</td>
      <td>{!p.binding && p.accessible && <button className="button" disabled={!!busy} onClick={() => { setSelected(p); setConfirming(false); setClientId(''); }}>Selecionar</button>}</td></tr>)}</tbody></table></div>
      : <div className="empty-state compact"><h3>Nenhuma propriedade listada</h3><p>{connected ? 'Clique em “Ver propriedades” para consultar a Sites API.' : 'Conecte uma conta Google para listar as propriedades às quais ela tem acesso.'}</p></div>)}
    {view === 'properties' && o.properties.some(p => p.propertyType === 'DOMAIN') && o.properties.some(p => p.propertyType === 'URL_PREFIX') && <p className="kicker" style={{ marginTop: 8 }}>Propriedades de domínio (sc-domain:) e de prefixo de URL podem cobrir o mesmo site com números diferentes. Cada uma é tratada separadamente; nada é somado entre elas.</p>}

    {selected && <Panel style={{ marginTop: 14 }}>
      <div className="eyebrow">Vincular propriedade ao cliente</div>
      <h3 style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{selected.siteUrl}</h3>
      {!confirming ? <>
        <div className="grid grid-2">
          <div className="field"><label htmlFor="hub-client">Cliente</label><select id="hub-client" value={clientId} onChange={e => setClientId(e.target.value)} disabled={!!busy}><option value="">Selecione…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.status === 'DRAFT' ? ' (rascunho)' : ''}</option>)}</select></div>
          <div className="field"><label>&nbsp;</label><button className="button" onClick={() => setShowDraft(!showDraft)} disabled={!!busy}>Criar rascunho de cliente</button></div>
        </div>
        {showDraft && <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="draft-name">Nome do cliente</label><input id="draft-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="draft-domain">Domínio</label><input id="draft-domain" placeholder={selected.siteUrl.startsWith('http') ? selected.siteUrl : ''} value={draft.domain} onChange={e => setDraft({ ...draft, domain: e.target.value })} /></div>
          <div className="field"><label>&nbsp;</label><button className="button" disabled={draft.name.trim().length < 2 || !!busy} onClick={createDraft}>{busy === 'draft' ? 'Criando…' : 'Criar rascunho (não ativo)'}</button></div>
        </div>}
        <div className="form-actions"><button className="button ghost" onClick={() => setSelected(null)}>Cancelar</button><button className="button primary" disabled={!clientId} onClick={() => setConfirming(true)}>Continuar</button></div>
      </> : <>
        <p className="notice">Confirmar vínculo: <strong>{selected.siteUrl}</strong> → <strong>{clientName}</strong>. Somente esta propriedade será importada (até 16 meses de histórico, conforme disponível na API). Os dados ficarão visíveis apenas para usuários autorizados deste cliente.</p>
        <div className="form-actions"><button className="button ghost" onClick={() => setConfirming(false)} disabled={!!busy}>Voltar</button><button className="button primary" disabled={!!busy} onClick={bind}>{busy === 'bind' ? 'Vinculando…' : 'Confirmar vínculo e importar histórico'}</button></div>
      </>}
    </Panel>}

    {view === 'bindings' && (o.properties.some(p => p.binding) ? <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Propriedade</th><th>Histórico disponível</th><th>Última sincronização</th><th>Ações</th></tr></thead><tbody>{o.properties.filter(p => p.binding).map(p => { const b = p.binding!; return <tr key={b.id}>
      <td><a href={`/clients/${b.clientId}/google`}><strong>{b.clientName}</strong></a>{b.isPrimary && <small>Propriedade principal</small>}</td><td style={{ overflowWrap: 'anywhere' }}>{p.siteUrl}</td>
      <td>{b.availableStartDate ? `${b.availableStartDate} → ${b.availableEndDate}` : '—'}</td><td><DateLabel value={b.lastSuccessfulSyncAt} time /></td>
      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="button" disabled={!!busy || !connected} onClick={() => call('sync', { bindingId: b.id }, 'sync').then(d => d && setView('jobs'))}>Sincronizar</button>
        {!b.isPrimary && <button className="button" disabled={!!busy} onClick={() => call('primary', { bindingId: b.id }, 'primary')}>Tornar principal</button>}
        <button className="button danger" disabled={!!busy} onClick={() => { if (!confirm(`Desvincular ${p.siteUrl} de ${b.clientName}?`)) return; const purge = confirm('Também apagar as métricas já importadas deste cliente para esta propriedade? (OK = apagar, Cancelar = manter histórico)'); call('unbind', { bindingId: b.id, purgeData: purge, confirm: true }, 'unbind'); }}>Desvincular</button>
      </td></tr>; })}</tbody></table></div> : <div className="empty-state compact"><h3>Nenhum vínculo</h3><p>Selecione uma propriedade em “Propriedades encontradas” para vinculá-la a um cliente.</p></div>)}

    {view === 'jobs' && (o.jobs.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Job</th><th>Cliente · Propriedade</th><th>Status</th><th>Janela solicitada</th><th>Disponível</th><th>Linhas</th><th>Fim</th></tr></thead><tbody>{o.jobs.map(j => <tr key={j.id}>
      <td><strong>{j.type.replace('GSC_', '').replace('_SYNC', '')}</strong><small>{j.id.slice(-8)}</small></td><td>{j.client}<small style={{ overflowWrap: 'anywhere' }}>{j.siteUrl}</small></td>
      <td><Badge status={j.status === 'PARTIAL' ? 'PARTIALLY_READY' : j.status} />{j.errorCode && <small title={j.errorDetail || ''}>{j.errorCode}</small>}</td>
      <td>{j.requestedStartDate} → {j.requestedEndDate}</td><td>{j.availableStartDate ? `${j.availableStartDate} → ${j.availableEndDate}` : '—'}</td><td>{j.rowsImported.toLocaleString('pt-BR')}<small>{j.apiRequests} req.</small></td><td><DateLabel value={j.finishedAt} time /></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><h3>Nenhuma sincronização</h3><p>As importações aparecem aqui após o primeiro vínculo.</p></div>)}
  </>;
}
