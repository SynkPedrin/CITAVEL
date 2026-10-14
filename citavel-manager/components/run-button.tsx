'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, X } from 'lucide-react';

const modes = [['WEEKLY', 'Ciclo completo'], ['BASELINE', 'Medir presença em IA'], ['CONTENT', 'Preparar conteúdo'], ['MONITOR', 'Atualizar monitoramento'], ['REPORT', 'Gerar relatório']];
const statusMessage: Record<string, string> = {
  QUEUED: 'Ciclo na fila. Aguarde o início da análise.', RUNNING: 'Análise em andamento. Os resultados serão sincronizados ao final.',
  SUCCESS: 'Ciclo concluído. Os dados do cliente foram atualizados.', PARTIAL: 'Ciclo concluído com pendências. Consulte as integrações e o histórico da operação.',
  FAILED: 'Não foi possível concluir o ciclo. Consulte as integrações antes de tentar novamente.',
};

export default function RunButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState('WEEKLY');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const active = busy || ['QUEUED', 'RUNNING'].includes(status);
  useEffect(() => {
    if (!runId || !['QUEUED', 'RUNNING'].includes(status)) return;
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/clients/${clientId}/runs`, { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const data = await r.json();
        const run = data.runs?.find((item: any) => item.id === runId);
        if (!live || !run) return;
        setStatus(run.status);
        setMsg(statusMessage[run.status] || 'Aguardando confirmação do resultado.');
        if (!['QUEUED', 'RUNNING'].includes(run.status)) router.refresh();
      } catch { if (live) setMsg('A conexão com o acompanhamento foi interrompida. Tentaremos novamente.'); }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [clientId, runId, status, router]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  async function run() {
    setBusy(true);
    setMsg('Enviando solicitação…');
    try {
      const r = await fetch(`/api/clients/${clientId}/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ mode, confirmed: true }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Não foi possível iniciar o ciclo.');
      setRunId(data.runId);
      setStatus(data.status);
      setMsg(data.existing ? 'Já existe um ciclo em andamento. Acompanhando essa execução.' : statusMessage[data.status]);
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Não foi possível iniciar o ciclo.'); }
    finally { setBusy(false); }
  }
  return <>
    <button className="button" onClick={() => setOpen(true)}><Play size={13} />{active ? 'Acompanhar ciclo' : 'Executar'}</button>
    {open && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={() => setOpen(false)}>
      <div className="panel wallpaper" role="dialog" aria-modal="true" aria-labelledby={`run-title-${clientId}`} style={{ width: 'min(460px,calc(100% - 30px))' }} onClick={e => e.stopPropagation()}>
        <button className="button" aria-label="Fechar acompanhamento" onClick={() => setOpen(false)} style={{ float: 'right' }}><X size={15} /></button>
        <div className="eyebrow">OPERAÇÃO</div><h2 id={`run-title-${clientId}`} style={{ marginTop: 0 }}>Executar ciclo CITÁVEL</h2>
        <p className="kicker">Escolha a análise. Ela pode levar alguns minutos e continuará se você fechar esta janela.</p>
        <label className="field">Tipo de ciclo<select value={mode} onChange={e => setMode(e.target.value)} disabled={active}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {msg && <div className="notice" role="status" style={{ marginTop: 12 }}>{msg}</div>}
        <div className="form-actions"><button className="button" onClick={() => setOpen(false)}>Fechar</button><button className="button primary" onClick={run} disabled={active}>{active ? 'Em andamento…' : runId ? 'Executar novo ciclo' : 'Executar ciclo'}</button></div>
      </div>
    </div>}
  </>;
}
