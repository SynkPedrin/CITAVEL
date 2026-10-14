'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, Pencil, X } from 'lucide-react';

export function IdentityControls({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctionsText, setCorrectionsText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function decide(decision: 'confirm' | 'reject') {
    setBusy(decision); setMessage(''); setError(false);
    let corrections: unknown;
    if (decision === 'confirm' && correcting && correctionsText.trim()) {
      try { corrections = JSON.parse(correctionsText); }
      catch { setError(true); setMessage('Correções em JSON inválido. Use o formato exibido acima do campo.'); setBusy(null); return; }
    }
    try {
      const response = await fetch(`/api/clients/${clientId}/identity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' },
        body: JSON.stringify({ decision, ...(corrections ? { corrections } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
      setMessage(decision === 'confirm' ? `Identidade confirmada${result.status ? ` (${result.status})` : ''}.` : 'Identidade rejeitada; a descoberta poderá ser refeita.');
      setCorrecting(false); setCorrectionsText('');
      router.refresh();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : 'Não foi possível concluir.'); }
    finally { setBusy(null); }
  }
  return <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 18 }}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button className="button primary" onClick={() => decide('confirm')} disabled={busy !== null}>
        {busy === 'confirm' ? <LoaderCircle size={14} /> : <Check size={14} />} {busy === 'confirm' ? 'Confirmando…' : correcting ? 'Confirmar com correções' : 'Confirmar identidade'}
      </button>
      <button className="button" onClick={() => { setCorrecting(!correcting); setMessage(''); setError(false); }} disabled={busy !== null}><Pencil size={14} /> {correcting ? 'Cancelar correção' : 'Corrigir'}</button>
      <button className="button danger" onClick={() => decide('reject')} disabled={busy !== null}>
        {busy === 'reject' ? <LoaderCircle size={14} /> : <X size={14} />} {busy === 'reject' ? 'Rejeitando…' : 'Rejeitar'}
      </button>
    </div>
    {correcting && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <div className="field"><label htmlFor="identity-corrections">Correções em JSON (opcional — campos permitidos: description, tagline, official_domain)</label>
        <textarea id="identity-corrections" rows={3} maxLength={3000} value={correctionsText} disabled={busy !== null} onChange={event => setCorrectionsText(event.target.value)} placeholder='{"description":"…","tagline":"…","official_domain":"https://…"}' />
      </div>
    </div>}
    {message && <p role={error ? 'alert' : 'status'} style={{ fontSize: 11, color: error ? 'var(--amber)' : 'var(--green)', margin: '9px 0 0' }}>{message}</p>}
  </div>;
}
