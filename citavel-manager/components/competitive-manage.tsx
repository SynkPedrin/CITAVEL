'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Search, Upload, X, Eye, EyeOff, Star } from 'lucide-react';

type Asset = { id: string; sourceUrl: string | null } | null;
type Logo = { approved: Asset; pending: Asset };
type Comp = { id: string; name: string; domain: string | null; verificationStatus: string; origin: string; isPriority: boolean; isVisible: boolean; hasMeasurements: boolean; logo: Logo };

export function CompetitiveManage({ clientId, competitors, clientLogo, pending }: { clientId: string; competitors: Comp[]; clientLogo: Logo; pending: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(pending > 0);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [name, setName] = useState(''); const [domain, setDomain] = useState('');
  const call = async (url: string, method: string, body?: unknown) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Falha na operação.'); return d;
  };
  const run = async (key: string, fn: () => Promise<string | void>) => { setBusy(key); setErr(''); setMsg(''); try { const m = await fn(); if (m) setMsg(m); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const base = `/api/clients/${clientId}`;
  const find = (competitorId: string | null) => run(`find-${competitorId}`, async () => { const d = await call(`${base}/brand-assets/resolve`, 'POST', { competitorId }); return ({ FOUND: d.identityMatch ? 'Logo encontrada no site oficial. Confira a prévia e aprove.' : 'Logo encontrada, mas o nome do site não bate com a empresa. Confira com atenção antes de aprovar.', NOT_FOUND: 'Nenhuma logo encontrada no site oficial. Envie o arquivo manualmente.', NO_DOMAIN: 'Informe o domínio oficial antes de buscar a logo.', ERROR: d.message || 'Falha na busca.' } as Record<string, string>)[d.status] });
  const upload = (competitorId: string | null, f: File | undefined) => { if (!f) return; if (f.size > 500_000) { setErr('A logo deve ter até 500 KB.'); return; } run(`up-${competitorId}`, async () => { const bytes = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192)); const data = btoa(bin); await call(`${base}/brand-assets`, 'POST', { competitorId, data }); return 'Logo enviada e aprovada.'; }); };

  const LogoCell = ({ owner, logo, label }: { owner: string | null; logo: Logo; label: string }) => {
    const file = useRef<HTMLInputElement>(null);
    return <div className="cmp-logo-ctl">
      {logo.approved ? <span className="pill ok">Logo aprovada</span> : logo.pending ? <span className="cmp-preview"><img src={`${base}/brand-assets/${logo.pending.id}`} alt={`Prévia da logo de ${label}`} /><button className="button primary" disabled={!!busy} onClick={() => run(`ap-${logo.pending!.id}`, async () => { await call(`${base}/brand-assets/${logo.pending!.id}/approve`, 'POST'); return 'Logo aprovada.'; })}><Check size={13} /> Aprovar</button><button className="button ghost" disabled={!!busy} onClick={() => run(`rj-${logo.pending!.id}`, async () => { await call(`${base}/brand-assets/${logo.pending!.id}/reject`, 'POST'); })}><X size={13} /> Rejeitar</button></span> : <span className="muted-text">Sem logo (avatar de iniciais)</span>}
      <button className="button ghost" disabled={!!busy} onClick={() => find(owner)}><Search size={13} /> {logo.approved || logo.pending ? 'Buscar novamente' : 'Buscar logo'}</button>
      <button className="button ghost" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={13} /> {logo.approved ? 'Alterar logo' : 'Enviar logo'}</button>
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={e => { upload(owner, e.target.files?.[0]); e.target.value = ''; }} />
    </div>;
  };

  return <div className="cmp-manage">
    <button className="button ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Fechar gerenciamento' : 'Gerenciar concorrentes'}{pending > 0 && !open ? ` (${pending} logo${pending > 1 ? 's' : ''} para aprovar)` : ''}</button>
    {open && <div className="cmp-manage-body">
      {msg && <p className="notice" role="status">{msg}</p>}{err && <p className="notice warning" role="alert">{err}</p>}
      <div className="cmp-row"><div><strong>Logo do cliente</strong></div><LogoCell owner={null} logo={clientLogo} label="o cliente" /></div>
      {competitors.map(c => <CompetitorRow key={c.id} c={c} busy={busy} run={run} call={call} base={base} LogoCell={LogoCell} />)}
      {!competitors.length && <p className="kicker">Nenhum concorrente identificado ainda. Eles surgem ao importar uma medição, ou podem ser adicionados abaixo.</p>}
      <form className="cmp-add" onSubmit={e => { e.preventDefault(); run('add', async () => { await call(`${base}/competitors`, 'POST', { name, domain: domain || null }); setName(''); setDomain(''); return 'Concorrente adicionado. Ele aparece como “Sem dados de medição” até uma medição trazer suas contagens.'; }); }}>
        <input aria-label="Nome do concorrente" placeholder="Nome do concorrente" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
        <input aria-label="Domínio oficial" placeholder="Domínio oficial (ex.: empresa.com.br)" value={domain} onChange={e => setDomain(e.target.value)} />
        <button className="button primary" disabled={!!busy}>Adicionar manualmente</button></form>
      <p className="fine-print">Adicionar um concorrente não cria indicadores: números só vêm de medições importadas. Logos são buscadas no site oficial informado e só entram na tabela e no PDF depois de aprovadas.</p>
    </div>}
  </div>;
}

function CompetitorRow({ c, busy, run, call, base, LogoCell }: { c: Comp; busy: string; run: (k: string, f: () => Promise<string | void>) => void; call: (u: string, m: string, b?: unknown) => Promise<any>; base: string; LogoCell: React.ComponentType<{ owner: string | null; logo: Logo; label: string }> }) {
  const [domain, setDomain] = useState(c.domain || '');
  const patch = (key: string, body: unknown, ok?: string) => run(key, async () => { await call(`${base}/competitors/${c.id}`, 'PATCH', body); return ok; });
  return <div className="cmp-row">
    <div className="cmp-row-main"><strong>{c.name}</strong> {c.isPriority && <Star size={12} aria-label="Prioritário" />}{!c.isVisible && <span className="pill">Oculto</span>}{c.origin === 'MANUAL' && <span className="pill">Manual</span>}
      <div className="cmp-domain"><input aria-label={`Domínio de ${c.name}`} placeholder="domínio oficial" value={domain} onChange={e => setDomain(e.target.value)} />
        <button className="button ghost" disabled={!!busy || domain === (c.domain || '')} onClick={() => patch(`dom-${c.id}`, { domain: domain || null }, 'Domínio atualizado. Confirme a identidade antes de buscar a logo.')}>Salvar domínio</button>
        <label className="chip"><input type="checkbox" checked={c.verificationStatus === 'CONFIRMED'} onChange={e => patch(`vf-${c.id}`, { verificationStatus: e.target.checked ? 'CONFIRMED' : 'UNVERIFIED' })} disabled={!c.domain || !!busy} /> Identidade confirmada</label></div></div>
    <LogoCell owner={c.id} logo={c.logo} label={c.name} />
    <div className="cmp-row-actions">
      <button className="button ghost" disabled={!!busy} onClick={() => patch(`pr-${c.id}`, { isPriority: !c.isPriority })}><Star size={13} /> {c.isPriority ? 'Remover prioridade' : 'Priorizar'}</button>
      <button className="button ghost" disabled={!!busy} onClick={() => patch(`vis-${c.id}`, { isVisible: !c.isVisible })}>{c.isVisible ? <><EyeOff size={13} /> Ocultar</> : <><Eye size={13} /> Mostrar</>}</button>
      {!c.hasMeasurements && <button className="button ghost" disabled={!!busy} onClick={() => run(`del-${c.id}`, async () => { await call(`${base}/competitors/${c.id}`, 'DELETE'); })}><X size={13} /> Excluir</button>}
    </div>
  </div>;
}
