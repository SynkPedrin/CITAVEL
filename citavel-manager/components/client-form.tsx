'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
type Initial = { name: string; domain: string; industry: string; locations: string[]; services: string[]; brandTerms: string[]; status: string };
export function ClientForm({ id, initial }: { id?: string; initial?: Initial }) {
  const [v, setV] = useState({ name: initial?.name || '', domain: initial?.domain || '', industry: initial?.industry || '', locations: (initial?.locations || []).join(', '), services: (initial?.services || []).join(', '), brandTerms: (initial?.brandTerms || []).join(', '), status: initial?.status && ['ACTIVE', 'PAUSED', 'DRAFT'].includes(initial.status) ? initial.status : 'ACTIVE' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const router = useRouter();
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(x => x.length >= 2);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch(id ? `/api/client-profiles/${id}` : '/api/client-profiles', { method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ name: v.name, domain: v.domain, industry: v.industry, locations: list(v.locations), services: list(v.services), brandTerms: list(v.brandTerms), status: v.status }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      router.push(`/clients/${d.id}/google`); router.refresh();
    } catch (e) { setErr((e as Error).message || 'Não foi possível salvar.'); setBusy(false); }
  }
  return <form className="panel form-panel" onSubmit={save}>
    <div className="form-grid">
      <div className="field"><label htmlFor="cf-name">Nome do cliente</label><input id="cf-name" required value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="cf-domain">Domínio</label><input id="cf-domain" required placeholder="https://empresa.com.br/" value={v.domain} onChange={e => setV({ ...v, domain: e.target.value })} /></div>
      <div className="field"><label htmlFor="cf-industry">Segmento</label><input id="cf-industry" placeholder="Ex.: Diagnóstico por imagem" value={v.industry} onChange={e => setV({ ...v, industry: e.target.value })} /></div>
      <div className="field"><label htmlFor="cf-status">Situação</label><select id="cf-status" value={v.status} onChange={e => setV({ ...v, status: e.target.value })}><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option><option value="DRAFT">Rascunho</option></select></div>
      <div className="field full"><label htmlFor="cf-services">Serviços confirmados <small className="kicker">(separados por vírgula — usados no Google e no briefing de IA)</small></label><input id="cf-services" placeholder="Ex.: ressonância magnética, tomografia" value={v.services} onChange={e => setV({ ...v, services: e.target.value })} /></div>
      <div className="field"><label htmlFor="cf-locations">Localidades confirmadas</label><input id="cf-locations" placeholder="Ex.: Campinas, Valinhos" value={v.locations} onChange={e => setV({ ...v, locations: e.target.value })} /></div>
      <div className="field"><label htmlFor="cf-brand">Termos de marca adicionais</label><input id="cf-brand" placeholder="Ex.: dcs, dcs imagem" value={v.brandTerms} onChange={e => setV({ ...v, brandTerms: e.target.value })} /></div>
    </div>
    <p className="kicker" style={{ marginTop: 12 }}>Informe apenas serviços e localidades confirmados pelo cliente. Nada é inferido automaticamente.</p>
    {err && <p className="notice warning" role="alert">{err}</p>}
    <div className="form-actions"><button type="button" className="button ghost" onClick={() => router.back()} disabled={busy}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : id ? 'Salvar alterações' : 'Cadastrar cliente'}</button></div>
  </form>;
}
