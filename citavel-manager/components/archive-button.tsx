'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function ArchiveButton({ clientId, measurementId, archived }: { clientId: string; measurementId: string; archived: boolean }) {
  const [busy, setBusy] = useState(false); const router = useRouter();
  return <button className="button ghost" disabled={busy} onClick={async () => { if (!archived && !confirm('Arquivar esta medição? Ela deixa de aparecer no painel e nos novos relatórios, mas continua preservada.')) return; setBusy(true); const r = await fetch(`/api/clients/${clientId}/ai-measurements/${measurementId}/archive`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ archived: !archived }) }); setBusy(false); if (r.ok) router.refresh(); else alert((await r.json()).error); }}>{archived ? 'Restaurar' : 'Arquivar'}</button>;
}
