'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const post = async (clientId: string, body: unknown) => {
  const r = await fetch(`/api/clients/${clientId}/gsc`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha na operação.'); return d;
};

export function OpportunityButton({ clientId, params }: { clientId: string; params: Record<string, string | undefined> }) {
  const [state, setState] = useState(''); const router = useRouter();
  return <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
    <button className="button" disabled={state === '…'} onClick={async () => { setState('…'); try { const d = await post(clientId, { action: 'opportunities', ...params }); setState(`${d.saved} oportunidade(s) registradas para revisão em Ações → Gaps.`); router.refresh(); } catch (e) { setState((e as Error).message); } }}>{state === '…' ? 'Analisando…' : 'Registrar oportunidades para revisão'}</button>
    {state && state !== '…' && <small className="kicker" role="status">{state}</small>}
  </span>;
}

const CATS = ['BRANDED', 'NON_BRANDED', 'SERVICE', 'LOCATION', 'INFORMATIONAL', 'COMMERCIAL', 'OTHER'];
export function QueryLabel({ clientId, query, category, source }: { clientId: string; query: string; category: string; source: string }) {
  const [value, setValue] = useState(source === 'HUMAN' ? category : ''); const [busy, setBusy] = useState(false); const router = useRouter();
  return <select aria-label={`Revisar categoria de ${query}`} value={value} disabled={busy} style={{ background: '#0a0a0a', color: '#ddd', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, fontSize: 11, padding: '3px 4px' }}
    onChange={async e => { const v = e.target.value; setBusy(true); try { await post(clientId, { action: 'label', query, category: v || null }); setValue(v); router.refresh(); } catch (err) { alert((err as Error).message); } finally { setBusy(false); } }}>
    <option value="">Regra automática</option>{CATS.map(c => <option key={c} value={c}>{c}</option>)}
  </select>;
}

export function TermsEditor({ clientId, initial }: { clientId: string; initial: { brand: string[]; services: string[]; locations: string[] } }) {
  const [v, setV] = useState({ brand: initial.brand.join(', '), services: initial.services.join(', '), locations: initial.locations.join(', ') });
  const [msg, setMsg] = useState(''); const router = useRouter();
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(x => x.length >= 2);
  return <div>
    <div className="grid grid-3">{(['brand', 'services', 'locations'] as const).map(k => <div className="field" key={k}><label htmlFor={`terms-${k}`}>{{ brand: 'Termos de marca', services: 'Serviços confirmados', locations: 'Localidades confirmadas' }[k]}</label><textarea id={`terms-${k}`} rows={3} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} /></div>)}</div>
    <div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}><button className="button" onClick={async () => { try { await post(clientId, { action: 'terms', brand: list(v.brand), services: list(v.services), locations: list(v.locations) }); setMsg('Termos salvos. A classificação foi recalculada.'); router.refresh(); } catch (e) { setMsg((e as Error).message); } }}>Salvar termos revisados</button>{msg && <small className="kicker" role="status">{msg}</small>}</div>
  </div>;
}
