'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Upload } from 'lucide-react';

export interface GoldenFormPrompt {
  externalId: string;
  prompt: string;
  priority: string;
  commercialScore: number | null;
}

const PLATFORMS = ['ChatGPT', 'Gemini', 'Perplexity', 'Google AI Mode', 'Copilot'];

function localNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function GoldenImportForm({ clientId, prompts }: { clientId: string; prompts: GoldenFormPrompt[] }) {
  const router = useRouter();
  const [promptExternalId, setPromptExternalId] = useState(prompts[0]?.externalId || '');
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [response, setResponse] = useState('');
  const [timestamp, setTimestamp] = useState(localNow());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function submit() {
    setBusy(true); setMessage(''); setError(false);
    try {
      const res = await fetch(`/api/clients/${clientId}/golden`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' },
        body: JSON.stringify({ platform, promptExternalId, response, timestamp }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Não foi possível importar. Tente novamente.');
      setMessage(`Importado: ${result.imported}${result.total != null ? ` · total GOLDEN no Engine: ${result.total}` : ''}${result.imported === 0 ? ' (já existia — importação idempotente)' : ''}`);
      setResponse('');
      router.refresh();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : 'Não foi possível importar.'); }
    finally { setBusy(false); }
  }
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="form-grid">
      <div className="field full"><label htmlFor="golden-prompt">Prompt</label>
        <select id="golden-prompt" value={promptExternalId} disabled={busy || !prompts.length} onChange={event => setPromptExternalId(event.target.value)}>
          {!prompts.length && <option value="">Nenhum prompt ativo</option>}
          {prompts.map(p => <option key={p.externalId} value={p.externalId}>{['P4', 'P5'].includes(p.priority) ? '★ ' : ''}{p.prompt}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="golden-platform">Plataforma</label>
        <select id="golden-platform" value={platform} disabled={busy} onChange={event => setPlatform(event.target.value)}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="golden-timestamp">Coletada em</label>
        <input id="golden-timestamp" type="datetime-local" value={timestamp} disabled={busy} onChange={event => setTimestamp(event.target.value)} />
      </div>
      <div className="field full"><label htmlFor="golden-response">Resposta observada</label>
        <textarea id="golden-response" rows={7} maxLength={20000} value={response} disabled={busy} onChange={event => setResponse(event.target.value)} placeholder="Cole aqui a resposta completa exibida pela plataforma para este prompt." />
      </div>
    </div>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="button primary" onClick={submit} disabled={busy || !promptExternalId || response.trim().length < 20 || !timestamp}>
        {busy ? <LoaderCircle size={14} /> : <Upload size={14} />} {busy ? 'Importando…' : 'Importar teste GOLDEN'}
      </button>
      {message && <p role={error ? 'alert' : 'status'} style={{ fontSize: 11, color: error ? 'var(--amber)' : 'var(--green)', margin: 0 }}>{message}</p>}
    </div>
  </div>;
}
