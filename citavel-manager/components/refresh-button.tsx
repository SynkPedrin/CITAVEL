'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
export function RefreshDataButton({ clientId }: { clientId: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle'); const [msg, setMsg] = useState(''); const router = useRouter();
  async function run() {
    setState('running'); setMsg('Buscando dados no Google…');
    try {
      const r = await fetch(`/api/clients/${clientId}/gsc/sync`, { method: 'POST', headers: { 'X-Citavel-Request': '1' } }); const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Não foi possível atualizar.');
      for (let i = 0; i < 90; i++) {
        await new Promise(res => setTimeout(res, 2000));
        const s = await (await fetch(`/api/clients/${clientId}/gsc/sync?jobs=${d.jobs.join(',')}`, { cache: 'no-store' })).json();
        const jobs: { status: string; errorDetail: string | null }[] = s.jobs || [];
        if (jobs.length && jobs.every(j => !['QUEUED', 'RUNNING'].includes(j.status))) {
          const failed = jobs.find(j => j.status === 'FAILED');
          if (failed) throw new Error(failed.errorDetail || 'A atualização falhou.');
          setState('done'); setMsg(jobs.some(j => j.status === 'PARTIAL') ? 'Dados atualizados (parcialmente).' : 'Dados atualizados.'); router.refresh(); setTimeout(() => setState('idle'), 6000); return;
        }
      }
      throw new Error('A atualização está demorando; ela continua em segundo plano.');
    } catch (e) { setState('error'); setMsg((e as Error).message); }
  }
  return <span className="refresh-wrap">
    <button className="button" onClick={run} disabled={state === 'running'} aria-live="polite"><RefreshCw size={14} className={state === 'running' ? 'spin' : ''} />{state === 'running' ? 'Atualizando…' : 'Atualizar dados'}</button>
    {msg && state !== 'idle' && <small className={`kicker ${state === 'error' ? 'err-text' : ''}`} role="status">{msg}</small>}
  </span>;
}
