'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
// Copies text only. It never sends anything anywhere.
export function CopyButton({ text, label, ghost = false }: { text: string; label: string; ghost?: boolean }) {
  const [done, setDone] = useState(false); const [err, setErr] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setErr(false); setTimeout(() => setDone(false), 2500); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); setDone(ok); setErr(!ok); }
  }
  return <button type="button" className={`button ${ghost ? 'ghost' : ''}`} onClick={copy} aria-live="polite">{done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copiado' : err ? 'Não foi possível copiar' : label}</button>;
}
