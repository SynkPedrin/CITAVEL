'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Plus, X, AlertTriangle } from 'lucide-react';
const KINDS = [['GOOGLE', 'Google / SEO', 'Dados do Search Console'], ['IA', 'Presença em IA', 'Medição de IA importada'], ['COMPLETO', 'Completo', 'Google + Presença em IA']] as const;
type Measurement = { id: string; title: string; executedAt: string | null; classification: string; version: number };
export function ReportGenerator({ clientId, measurements, startOpen = false }: { clientId: string; measurements: Measurement[]; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<string>('COMPLETO'); const [format, setFormat] = useState('EXECUTIVO');
  const [period, setPeriod] = useState('28d'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [mid, setMid] = useState(measurements[0]?.id || ''); const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const router = useRouter();
  const needsGoogle = kind !== 'IA', needsAi = kind !== 'GOOGLE';
  useEffect(() => {
    if (!open || (period === 'custom' && (!from || !to))) return;
    const q = new URLSearchParams({ kind, period, ...(period === 'custom' ? { from, to } : {}), ...(mid ? { measurementId: mid } : {}) });
    let alive = true; setPreview(null);
    fetch(`/api/clients/${clientId}/report-snapshots/preview?${q}`).then(r => r.json()).then(d => { if (alive) setPreview(d); }).catch(() => {});
    return () => { alive = false; };
  }, [open, kind, period, from, to, mid, clientId]);
  async function generate() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/clients/${clientId}/report-snapshots`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ kind, format, period: needsGoogle ? period : '28d', ...(needsGoogle && period === 'custom' ? { from, to } : {}), measurementId: needsAi ? (mid || null) : null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      if (d.pdfStatus !== 'READY') throw new Error(`O snapshot foi salvo, mas o PDF não foi gerado: ${d.error || 'renderizador indisponível'}.`);
      setOpen(false); setMsg('Relatório gerado. Ele está no topo do histórico.'); router.refresh();
    } catch (e) { setMsg((e as Error).message || 'Não foi possível gerar o relatório.'); } finally { setBusy(false); }
  }
  const blocked = kind === 'IA' && !measurements.length;
  if (!open) return <div className="section-actions">{msg && <span className="kicker" role="status">{msg}</span>}<button className="button primary" onClick={() => { setOpen(true); setMsg(''); }}><Plus size={15} /> Gerar relatório</button></div>;
  return <section className="card generator" aria-label="Gerar relatório">
    <div className="summary-head"><h3 className="card-label">Novo relatório</h3><button className="icon-button" aria-label="Fechar" onClick={() => setOpen(false)}><X size={16} /></button></div>
    <div className="kind-grid" role="radiogroup" aria-label="Tipo de relatório">{KINDS.map(([k, l, d]) => <button key={k} role="radio" aria-checked={kind === k} className={`kind ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}><FileText size={16} /><strong>{l}</strong><small>{d}</small></button>)}</div>
    <div className="form-grid">
      {needsGoogle && <div className="field"><label htmlFor="rg-period">Período do Google</label><select id="rg-period" value={period} onChange={e => setPeriod(e.target.value)}><option value="7d">Últimos 7 dias</option><option value="28d">Últimos 28 dias</option><option value="3m">Últimos 3 meses</option><option value="6m">Últimos 6 meses</option><option value="12m">Últimos 12 meses</option><option value="custom">Personalizado</option></select>{period === 'custom' && <div className="inline-2" style={{ marginTop: 6 }}><input type="date" aria-label="Data inicial" value={from} onChange={e => setFrom(e.target.value)} /><input type="date" aria-label="Data final" value={to} onChange={e => setTo(e.target.value)} /></div>}</div>}
      {needsAi && <div className="field"><label htmlFor="rg-m">Medição de IA</label><select id="rg-m" value={mid} onChange={e => setMid(e.target.value)} disabled={!measurements.length}>{measurements.length ? measurements.map(m => <option key={m.id} value={m.id}>{m.title} · {m.executedAt ? m.executedAt.split('-').reverse().join('/') : 's/ data'} · {m.classification} · v{m.version}</option>) : <option>Nenhuma medição aprovada</option>}</select></div>}
      <div className="field"><label htmlFor="rg-f">Formato</label><select id="rg-f" value={format} onChange={e => setFormat(e.target.value)}><option value="EXECUTIVO">Executivo (essencial)</option><option value="COMPLETO">Completo (todas as seções)</option></select></div>
    </div>
    <div className="preview-box">{preview ? <>
      <dl className="summary-grid">{preview.google && <div><dt>Google</dt><dd>{preview.google.state === 'READY' ? `${preview.google.available.days} de ${preview.google.requested.days} dias com dados · ${preview.google.impressions.toLocaleString('pt-BR')} impressões · ${preview.google.clicks.toLocaleString('pt-BR')} cliques` : 'sem dados disponíveis'}</dd></div>}{preview.ai && <div><dt>Presença em IA</dt><dd>{preview.ai.state === 'READY' ? `${preview.ai.title} · ${preview.ai.classification} · ${preview.ai._count.platforms} plataformas` : 'nenhuma medição aprovada'}</dd></div>}</dl>
      {preview.warnings?.length > 0 && <ul className="warn-inline">{preview.warnings.map((w: string, i: number) => <li key={i}><AlertTriangle size={13} /> {w}</li>)}</ul>}
    </> : <span className="kicker">Conferindo os dados disponíveis…</span>}</div>
    {msg && <p className="notice warning" role="alert">{msg}</p>}
    <p className="fine-print">A geração usa apenas dados já salvos: não executa medições nem chama provedores de IA. O relatório fica congelado; edições futuras não o alteram.</p>
    <div className="form-actions"><button className="button ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button className="button primary" onClick={generate} disabled={busy || blocked || (needsGoogle && period === 'custom' && (!from || !to))}>{busy ? 'Gerando PDF…' : 'Gerar PDF'}</button></div>
  </section>;
}
export function DownloadButton({ clientId, snapshotId }: { clientId: string; snapshotId: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return <span><button className="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { const r = await fetch(`/api/clients/${clientId}/report-snapshots/${snapshotId}/link`, { method: 'POST', headers: { 'X-Citavel-Request': '1' } }); const d = await r.json(); if (!r.ok) throw new Error(d.error); window.location.assign(d.url); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Preparando…' : 'Baixar'}</button>{err && <small className="kicker" role="alert"> {err}</small>}</span>;
}
