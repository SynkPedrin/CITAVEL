'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LoaderCircle, X } from 'lucide-react';
import { Badge } from './ui';

async function mutate(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
  return result;
}

function DecisionResult({ result }: { result: any }) {
  const missing = Array.isArray(result?.validation?.missing) ? result.validation.missing : [];
  const url = result?.deployment?.url;
  const deploymentStatus = result?.deployment?.status;
  return <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="kicker">Estado final:</span>
      <Badge status={result?.status} />
      {deploymentStatus && <Badge status={deploymentStatus} />}
    </div>
    {url && <a className="text-link" href={url} target="_blank" rel="noreferrer">Abrir página publicada</a>}
    {result?.status === 'NEEDS_INFORMATION' && <p role="status" className="kicker" style={{ margin: 0 }}>O Engine bloqueou a execução: faltam informações{missing.length ? ` — ${missing.join(', ')}` : ''}. Complete as evidências antes de tentar novamente.</p>}
    {result?.status === 'NEEDS_HUMAN_ACTION' && <p role="status" className="kicker" style={{ margin: 0 }}>O Engine preparou o pacote, mas esta ação exige execução humana fora do Manager.</p>}
    {result?.status === 'FAILED' && <p role="alert" className="kicker" style={{ margin: 0, color: 'var(--red)' }}>A execução falhou no Engine. Verifique a atividade do cliente.</p>}
    {deploymentStatus === 'BLOCKED_NO_ACCESS' && <p role="status" className="kicker" style={{ margin: 0 }}>Publicação bloqueada: o Engine não tem acesso configurado ao destino de publicação.</p>}
  </div>;
}

export function ApproveRejectControl({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  async function decide(kind: 'approve' | 'reject') {
    setBusy(kind); setError(''); setResult(null);
    try {
      const outcome = await mutate(`/api/actions/${actionId}/${kind}`, kind === 'reject' ? { note: note.trim() || undefined } : {});
      setResult(outcome); setRejecting(false);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir.'); }
    finally { setBusy(null); }
  }
  return <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 18 }}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button className="button primary" onClick={() => decide('approve')} disabled={busy !== null}>
        {busy === 'approve' ? <LoaderCircle size={14} /> : <Check size={14} />} {busy === 'approve' ? 'Processando no Engine…' : 'Aprovar e executar'}
      </button>
      {!rejecting && <button className="button danger" onClick={() => { setRejecting(true); setError(''); setResult(null); }} disabled={busy !== null}><X size={14} /> Rejeitar</button>}
    </div>
    {rejecting && <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
      <div className="field"><label htmlFor={`reject-${actionId}`}>Motivo da rejeição (opcional)</label>
        <textarea id={`reject-${actionId}`} rows={2} maxLength={1000} value={note} disabled={busy !== null} onChange={event => setNote(event.target.value)} placeholder="Por que esta ação não deve avançar?" />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="button danger" onClick={() => decide('reject')} disabled={busy !== null}>{busy === 'reject' ? <LoaderCircle size={14} /> : <X size={14} />} {busy === 'reject' ? 'Rejeitando…' : 'Confirmar rejeição'}</button>
        <button className="button ghost" onClick={() => setRejecting(false)} disabled={busy !== null}>Cancelar</button>
      </div>
    </div>}
    {error && <p role="alert" style={{ fontSize: 11, color: 'var(--amber)', margin: '9px 0 0' }}>{error}</p>}
    {result && <DecisionResult result={result} />}
  </div>;
}
