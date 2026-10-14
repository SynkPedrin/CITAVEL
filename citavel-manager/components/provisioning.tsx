'use client';
import { useEffect, useState } from 'react';
import { Check, LoaderCircle, Circle, AlertTriangle } from 'lucide-react';
const labels = ['CLIENT_CREATED', 'ENGINE_CONFIGURED', 'AUTOMATION_CONNECTED', 'SITE_ANALYZED', 'PROMPTS_PREPARED', 'BASELINE_STARTED', 'OPERATION_ACTIVE'];
const copy = ['Empresa criada', 'Ambiente preparado', 'Execução local conectada', 'Site analisado', 'Perguntas preparadas', 'Análise inicial de IA', 'Operação disponível'];
type ProgressEvent = { message: string; metadata?: { status?: string }; createdAt: string };
export default function Provisioning({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let finished = false;
      try {
        const r = await fetch(`/api/clients/${clientId}/progress`, { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!live) return;
        setEvents(data.events || []); setError('');
        finished = data.events?.some((e: ProgressEvent) => ['OPERATION_ACTIVE', 'PROVISIONING_FAILED'].includes(e.message));
      } catch { if (live) setError('Não foi possível atualizar o progresso. Tentaremos novamente.'); }
      if (live && !finished) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [clientId]);
  const failed = events.some(e => e.message === 'PROVISIONING_FAILED');
  const ready = events.findLast(e => e.message === 'OPERATION_ACTIVE');
  return <div className="panel wallpaper" style={{ maxWidth: 720 }}>
    <div className="eyebrow">PREPARO DO CLIENTE</div><h2 style={{ fontSize: 30, letterSpacing: '-.04em', margin: '0 0 9px' }}>Implementando CITÁVEL</h2>
    <p className="kicker">Acompanhe a criação do ambiente e o resultado de cada análise.</p>
    <div className="timeline" style={{ marginTop: 25 }}>{labels.map((label, i) => {
      const status = events.findLast(x => x.message === label)?.metadata?.status;
      const complete = status === 'SUCCESS';
      const partial = status === 'PARTIAL';
      const active = status === 'RUNNING' && !failed;
      return <div className="timeline-row" key={label}>
        <span className="status-dot" style={{ background: complete ? 'var(--green)' : partial || active ? 'var(--amber)' : '#444' }}>{complete ? <Check size={7} /> : partial ? <AlertTriangle size={7} /> : active ? <LoaderCircle size={7} /> : <Circle size={7} />}</span>
        <div><strong>{String(i + 1).padStart(2, '0')} · {copy[i]}</strong><small>{complete ? 'Concluído' : partial ? 'Concluído com pendências' : active ? 'Em andamento' : failed ? 'Interrompido' : 'Aguardando'}</small></div>
      </div>;
    })}</div>
    {error && <div className="notice" role="status">{error}</div>}
    {failed && <div className="notice" role="alert">O preparo foi interrompido. Verifique as integrações e o histórico da operação antes de retomar.</div>}
    {ready && <a className="button primary" href={`/clients/${clientId}`} style={{ marginTop: 20 }}>Abrir operação</a>}
    {failed && <a className="button" href="/admin/integrations" style={{ marginTop: 20 }}>Ver integrações</a>}
  </div>;
}
