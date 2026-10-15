'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileUp, Pencil, Check, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { PROVIDERS, providerLabel, type Parsed, type Evidence } from '@/lib/ai-measurement/parse';

type Count = number | null;
type Platform = { provider: string; label: string; model: string | null; collectionMethod: string | null; promptCount: Count; observationCount: Count; mentionCount: Count; recommendationCount: Count; citationCount: Count; evidence: Record<string, Evidence> };
type Finding = { type: string; text: string; evidence: string | null };
type CMetric = { provider: string; observationCount: Count; mentionCount: Count; recommendationCount: Count; citationCount: Count };
type Competitive = { name: string; domain: string; metrics: CMetric[] };
export type Draft = {
  title: string; source: string; methodology: string; methodologyVersion: string; classification: 'LAB' | 'GOLDEN' | 'QUALITATIVE';
  periodStart: string; periodEnd: string; executedAt: string; rawText: string;
  platforms: Platform[]; competitors: { name: string; platform: string | null; evidence: string | null }[]; competitive: Competitive[];
  sources: { url: string; evidence: string | null }[]; findings: Finding[];
  warnings: Parsed['warnings']; suggestion: { value: string; reason: string } | null; metaEvidence: Record<string, Evidence>;
};
const COUNTS = [['promptCount', 'Prompts'], ['observationCount', 'Observações'], ['mentionCount', 'Menções'], ['recommendationCount', 'Recomendações'], ['citationCount', 'Citações']] as const;
const FINDING_LABEL: Record<string, string> = { STRENGTH: 'Pontos fortes', WEAKNESS: 'Pontos fracos', OPPORTUNITY: 'Oportunidades', CONCLUSION: 'Conclusões', LIMITATION: 'Limitações', EVIDENCE: 'Evidências (respostas originais)' };
const CLASS_LABEL: Record<string, string> = { LAB: 'LAB — testes automatizados (API/ambiente experimental)', GOLDEN: 'GOLDEN — respostas reais coletadas em plataformas de consumo, com evidências', QUALITATIVE: 'Qualitativa / não verificada' };
const today = () => new Date().toISOString().slice(0, 10);
const evText = (e: Evidence) => e ? (e.line ? `linha ${e.line}: ${e.text}` : e.text) : null;

function fromParsed(p: Parsed, form: { title: string; periodStart: string; periodEnd: string; executedAt: string; source: string; methodology: string; providers: string[] }, raw: string): Draft {
  const warnings = [...p.warnings];
  const pick = (typed: string, k: keyof Parsed['meta']) => { const ex = p.meta[k].value; if (typed && ex && typed !== ex) warnings.push({ code: 'FORM_TEXT_MISMATCH', message: `O formulário informa "${typed}" e o texto "${ex}" (${k}). Mantido o valor do formulário.` }); return typed || ex || ''; };
  const platforms: Platform[] = p.platforms.map(x => ({ provider: x.provider, label: x.label, model: x.model.value, collectionMethod: x.collectionMethod.value, promptCount: x.promptCount.value, observationCount: x.observationCount.value, mentionCount: x.mentionCount.value, recommendationCount: x.recommendationCount.value, citationCount: x.citationCount.value, evidence: Object.fromEntries(['model', 'collectionMethod', ...COUNTS.map(c => c[0])].map(f => [f, (x as any)[f].evidence])) }));
  for (const k of form.providers) if (!platforms.some(x => x.provider === k)) { platforms.push(emptyPlatform(k)); warnings.push({ code: 'DECLARED_NOT_FOUND', message: `${providerLabel(k)} foi marcada como avaliada, mas o texto não traz resultados dela.` }); }
  if (form.providers.length) for (const x of platforms) if (!form.providers.includes(x.provider)) warnings.push({ code: 'FOUND_NOT_DECLARED', message: `${x.label} aparece no texto mas não foi marcada como avaliada.` });
  return {
    title: form.title || (p.meta.client.value ? `Presença em IA — ${p.meta.client.value}` : `Medição de presença em IA ${pick(form.executedAt, 'executedAt') || today()}`),
    source: pick(form.source, 'source'), methodology: pick(form.methodology, 'methodology'), methodologyVersion: p.meta.methodologyVersion.value || '',
    classification: p.suggestedClassification, periodStart: pick(form.periodStart, 'periodStart'), periodEnd: pick(form.periodEnd, 'periodEnd'), executedAt: pick(form.executedAt, 'executedAt'),
    rawText: raw, platforms, competitors: p.competitors.map(c => ({ name: c.name, platform: c.platform, evidence: evText(c.evidence) })), competitive: (p.competitive || []).map(c => ({ name: c.name, domain: c.domain || '', metrics: c.metrics })), sources: p.sources.map(s => ({ url: s.url, evidence: evText(s.evidence) })),
    findings: p.findings.map(f => ({ type: f.type, text: f.text, evidence: evText(f.evidence) })), warnings, suggestion: { value: p.suggestedClassification, reason: p.classificationReason },
    metaEvidence: Object.fromEntries(Object.entries(p.meta).map(([k, v]) => [k, v.evidence])),
  };
}
const emptyPlatform = (k: string): Platform => ({ provider: k, label: providerLabel(k), model: null, collectionMethod: null, promptCount: null, observationCount: null, mentionCount: null, recommendationCount: null, citationCount: null, evidence: {} });

export function AiImport({ clientId, clientName, initial, measurementId }: { clientId: string; clientName: string; initial?: Draft; measurementId?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'input' | 'review'>(initial ? 'review' : 'input');
  const [editing, setEditing] = useState(Boolean(initial));
  const [form, setForm] = useState({ title: '', periodStart: '', periodEnd: '', executedAt: '', source: '', methodology: '', providers: [] as string[] });
  const [text, setText] = useState(''); const [file, setFile] = useState('');
  const [draft, setDraft] = useState<Draft | null>(initial || null);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [ack, setAck] = useState(false); const [note, setNote] = useState('');
  const sensitive = draft?.warnings.some(w => w.code === 'SENSITIVE_DATA');
  const call = async (url: string, method: string, body: unknown) => { const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha na operação.'); return d; };

  async function onFile(f: File | undefined) {
    setErr(''); if (!f) return;
    if (!/\.(txt|md|markdown|json)$/i.test(f.name) || (f.type && !/^(text\/|application\/json)/.test(f.type))) { setErr('Envie apenas arquivos .txt, .md ou .json.'); return; }
    if (f.size > 400_000) { setErr('Arquivo muito grande (máx. 400 KB).'); return; }
    setText(await f.text()); setFile(f.name);
  }
  async function analyze() {
    setBusy('analyze'); setErr('');
    try { const d = await call(`/api/clients/${clientId}/ai-measurements/analyze`, 'POST', { text }); setDraft(fromParsed(d.parsed, form, text)); setStep('review'); setEditing(false); window.scrollTo({ top: 0 }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }
  async function save() {
    if (!draft) return; setBusy('save'); setErr('');
    const nul = (s: string) => s.trim() || null;
    const body = { title: draft.title, source: draft.source, methodology: draft.methodology, methodologyVersion: nul(draft.methodologyVersion), classification: draft.classification, periodStart: nul(draft.periodStart), periodEnd: nul(draft.periodEnd), executedAt: nul(draft.executedAt), rawText: draft.rawText,
      platforms: draft.platforms.map(({ evidence, ...p }) => ({ ...p, model: p.model?.trim() || null, collectionMethod: p.collectionMethod?.trim() || null })), competitors: draft.competitors.filter(c => c.name.trim()), competitiveAnalysis: draft.competitive.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), domain: c.domain.trim() || null, metrics: c.metrics })), sources: draft.sources.filter(s => s.url.trim()), findings: draft.findings.filter(f => f.text.trim()),
      ...(sensitive ? { acknowledgeSensitive: ack } : {}), ...(measurementId && note ? { note } : {}) };
    try {
      const d = await call(measurementId ? `/api/clients/${clientId}/ai-measurements/${measurementId}` : `/api/clients/${clientId}/ai-measurements`, measurementId ? 'PATCH' : 'POST', body);
      router.push(`/clients/${clientId}/ia/${d.id}?salvo=1`); router.refresh();
    } catch (e) { setErr((e as Error).message); setBusy(''); }
  }

  if (step === 'input') return <div className="import-flow">
    <div className="steps"><span className="step active">1. Resultado</span><span className="step">2. Revisar</span><span className="step">3. Salvar</span></div>
    <section className="card form-panel">
      <div className="form-grid">
        <div className="field"><label>Cliente</label><input value={clientName} disabled /></div>
        <div className="field"><label htmlFor="ai-title">Título da medição <small className="kicker">(opcional)</small></label><input id="ai-title" placeholder="Ex.: Presença em IA — outubro" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field"><label>Período avaliado</label><div className="inline-2"><input type="date" aria-label="Início do período" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} /><input type="date" aria-label="Fim do período" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} /></div></div>
        <div className="field"><label htmlFor="ai-exec">Data de execução</label><input id="ai-exec" type="date" value={form.executedAt} onChange={e => setForm({ ...form, executedAt: e.target.value })} /></div>
        <div className="field"><label htmlFor="ai-src">Origem da medição</label><input id="ai-src" placeholder="Ex.: Agentes Endrigo" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></div>
        <div className="field"><label htmlFor="ai-met">Metodologia declarada</label><input id="ai-met" placeholder="Ex.: 20 prompts comerciais por plataforma" value={form.methodology} onChange={e => setForm({ ...form, methodology: e.target.value })} /></div>
        <fieldset className="field full provider-picks"><legend>Plataformas avaliadas <small className="kicker">(opcional — o texto também é analisado)</small></legend>{PROVIDERS.map(p => <label key={p.key} className={`chip ${form.providers.includes(p.key) ? 'active' : ''}`}><input type="checkbox" checked={form.providers.includes(p.key)} onChange={e => setForm({ ...form, providers: e.target.checked ? [...form.providers, p.key] : form.providers.filter(x => x !== p.key) })} />{p.label}</label>)}</fieldset>
        <div className="field full"><label htmlFor="ai-text">Resultado da medição</label>
          <textarea id="ai-text" className="big-text" rows={18} placeholder="Cole aqui o relatório produzido pelos agentes (texto, Markdown, tabelas ou JSON)." value={text} onChange={e => { setText(e.target.value); setFile(''); }} />
          <div className="text-tools"><label className="button ghost file-pick"><FileUp size={14} /> Carregar .txt, .md ou .json<input type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={e => onFile(e.target.files?.[0])} /></label>{file && <span className="kicker">{file}</span>}<span className="kicker">{text.length.toLocaleString('pt-BR')} caracteres</span></div>
        </div>
      </div>
      {err && <p className="notice warning" role="alert">{err}</p>}
      <div className="form-actions"><button className="button ghost" onClick={() => router.push(`/clients/${clientId}/ia`)}>Cancelar</button><button className="button primary" disabled={busy === 'analyze' || text.trim().length < 20} onClick={analyze}>{busy === 'analyze' ? 'Analisando…' : 'Analisar resultados'}</button></div>
      <p className="fine-print">A análise é feita por regras no próprio Manager: nenhuma IA é chamada, nada é enviado a serviços externos e nada é salvo antes da sua confirmação. Instruções contidas no texto são tratadas apenas como texto.</p>
    </section>
  </div>;

  const d = draft!; const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });
  const setPlat = (i: number, patch: Partial<Platform>) => set({ platforms: d.platforms.map((p, j) => j === i ? { ...p, ...patch } : p) });
  const num = (v: string): Count => v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))) || 0;
  const goldenOk = d.platforms.length > 0 && d.platforms.every(p => (p.collectionMethod || '').trim() && !/\bapi\b|automatiz/i.test(p.collectionMethod || '')) && d.findings.some(f => f.type === 'EVIDENCE');
  return <div className="import-flow">
    {!measurementId && <div className="steps"><span className="step done">1. Resultado</span><span className="step active">2. Revisar</span><span className="step">3. Salvar</span></div>}
    <div className="review-head"><div><h2 className="section-title">{measurementId ? 'Editar medição' : 'Revisar medição'}</h2><p className="kicker">{editing ? 'Corrija o que for necessário. Valores alterados ficam registrados como editados.' : 'Confira os dados extraídos e as evidências. Nada foi salvo ainda.'}</p></div>{!editing && <button className="button" onClick={() => setEditing(true)}><Pencil size={14} /> Corrigir dados</button>}</div>

    {d.warnings.length > 0 && <section className="card warn-list"><h3><AlertTriangle size={15} /> Avisos ({d.warnings.length})</h3><ul>{d.warnings.map((w, i) => <li key={i}>{w.message}{w.line ? <span className="kicker"> (linha {w.line})</span> : null}</li>)}</ul></section>}

    <section className="card">
      <h3 className="card-label">Identificação</h3>
      <div className="form-grid">
        <Field label="Cliente" value={clientName} />
        <Field label="Título" value={d.title} editing={editing} onChange={v => set({ title: v })} required />
        <Field label="Início do período" type="date" value={d.periodStart} editing={editing} onChange={v => set({ periodStart: v })} evidence={d.metaEvidence.periodStart} />
        <Field label="Fim do período" type="date" value={d.periodEnd} editing={editing} onChange={v => set({ periodEnd: v })} evidence={d.metaEvidence.periodEnd} />
        <Field label="Data de execução" type="date" value={d.executedAt} editing={editing} onChange={v => set({ executedAt: v })} evidence={d.metaEvidence.executedAt} />
        <Field label="Origem" value={d.source} editing={editing} onChange={v => set({ source: v })} evidence={d.metaEvidence.source} required />
        <Field label="Metodologia" value={d.methodology} editing={editing} onChange={v => set({ methodology: v })} evidence={d.metaEvidence.methodology} required />
        <Field label="Versão da metodologia" value={d.methodologyVersion} editing={editing} onChange={v => set({ methodologyVersion: v })} evidence={d.metaEvidence.methodologyVersion} />
        <div className="field full"><label>Classificação metodológica</label>
          {editing ? <select value={d.classification} onChange={e => set({ classification: e.target.value as Draft['classification'] })}>{(['QUALITATIVE', 'LAB', 'GOLDEN'] as const).map(c => <option key={c} value={c} disabled={c === 'GOLDEN' && !goldenOk}>{CLASS_LABEL[c]}{c === 'GOLDEN' && !goldenOk ? ' (requer evidências)' : ''}</option>)}</select> : <strong>{CLASS_LABEL[d.classification]}</strong>}
          {d.suggestion && <small className="kicker">Sugestão do analisador: {d.suggestion.value} — {d.suggestion.reason}</small>}
          <small className="kicker">GOLDEN exige método de coleta em interface de consumo para cada plataforma e ao menos uma evidência original. LAB e GOLDEN nunca são combinados.</small>
        </div>
      </div>
    </section>

    <section className="card">
      <h3 className="card-label">Plataformas e indicadores</h3>
      {d.platforms.length ? <div className="table-wrap"><table className="table review-table"><thead><tr><th>Plataforma</th><th>Modelo</th><th>Coleta</th>{COUNTS.map(([, l]) => <th key={l} className="n">{l}</th>)}{editing && <th />}</tr></thead><tbody>{d.platforms.map((p, i) => <tr key={p.provider}>
        <td><strong>{p.label}</strong></td>
        <td>{editing ? <input aria-label={`Modelo ${p.label}`} value={p.model || ''} onChange={e => setPlat(i, { model: e.target.value })} /> : <Cell v={p.model} e={p.evidence.model} />}</td>
        <td>{editing ? <input aria-label={`Método de coleta ${p.label}`} value={p.collectionMethod || ''} onChange={e => setPlat(i, { collectionMethod: e.target.value })} /> : <Cell v={p.collectionMethod} e={p.evidence.collectionMethod} />}</td>
        {COUNTS.map(([f, l]) => <td key={f} className="n">{editing ? <input aria-label={`${l} ${p.label}`} className="num" inputMode="numeric" value={p[f] ?? ''} onChange={e => setPlat(i, { [f]: num(e.target.value) } as any)} /> : <Cell v={p[f]} e={p.evidence[f]} />}</td>)}
        {editing && <td><button className="icon-button" aria-label={`Remover ${p.label}`} onClick={() => set({ platforms: d.platforms.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></td>}
      </tr>)}</tbody></table></div> : <p className="kicker">Nenhuma plataforma identificada no texto.</p>}
      {editing && <div className="add-row"><select aria-label="Adicionar plataforma" value="" onChange={e => e.target.value && set({ platforms: [...d.platforms, emptyPlatform(e.target.value)] })}><option value="">+ Adicionar plataforma</option>{PROVIDERS.filter(p => !d.platforms.some(x => x.provider === p.key)).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>}
      <p className="fine-print">Valores vazios ficam como “não informado” e nenhuma taxa é calculada sem numerador e total de observações.</p>
    </section>

    <div className="grid grid-2">
      <section className="card"><h3 className="card-label">Concorrentes ({d.competitors.length})</h3>
        {d.competitors.map((c, i) => <div key={i} className="list-edit">{editing ? <><input aria-label="Concorrente" value={c.name} onChange={e => set({ competitors: d.competitors.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /><button className="icon-button" aria-label="Remover" onClick={() => set({ competitors: d.competitors.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></> : <><strong>{c.name}</strong>{c.platform && <span className="kicker"> · {c.platform.split(',').map(providerLabel).join(', ')}</span>}{c.evidence && <small className="evidence">{c.evidence}</small>}</>}</div>)}
        {!d.competitors.length && <p className="kicker">Nenhum concorrente citado.</p>}
        {editing && <button className="button ghost" onClick={() => set({ competitors: [...d.competitors, { name: '', platform: null, evidence: null }] })}><Plus size={14} /> Adicionar</button>}
      </section>
      <section className="card"><h3 className="card-label">Fontes citadas ({d.sources.length})</h3>
        {d.sources.map((s, i) => <div key={i} className="list-edit">{editing ? <><input aria-label="URL" value={s.url} onChange={e => set({ sources: d.sources.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} /><button className="icon-button" aria-label="Remover" onClick={() => set({ sources: d.sources.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></> : <span className="url-cell">{s.url}</span>}</div>)}
        {!d.sources.length && <p className="kicker">Nenhuma URL de fonte no texto.</p>}
        {editing && <button className="button ghost" onClick={() => set({ sources: [...d.sources, { url: 'https://', evidence: null }] })}><Plus size={14} /> Adicionar</button>}
      </section>
    </div>

    {d.competitive.length > 0 && <section className="card"><h3 className="card-label">Análise competitiva ({d.competitive.length} {d.competitive.length === 1 ? 'concorrente' : 'concorrentes'})</h3>
      <p className="kicker">Contagens por concorrente e plataforma. Só são comparadas com o cliente quando o total de observações é o mesmo do cliente na plataforma.</p>
      <div className="table-wrap"><table className="table review-table"><thead><tr><th>Concorrente</th><th>Domínio</th><th>Plataforma</th><th className="n">Observações</th><th className="n">Menções</th><th className="n">Recomendações</th><th className="n">Citações</th></tr></thead><tbody>{d.competitive.flatMap((c, i) => (c.metrics.length ? c.metrics : [null]).map((m, j) => <tr key={`${i}-${j}`}>
        {j === 0 && <td rowSpan={Math.max(c.metrics.length, 1)}><strong>{c.name}</strong></td>}
        {j === 0 && <td rowSpan={Math.max(c.metrics.length, 1)}>{editing ? <input aria-label={`Domínio de ${c.name}`} value={c.domain} placeholder="empresa.com.br" onChange={e => set({ competitive: d.competitive.map((x, k) => k === i ? { ...x, domain: e.target.value } : x) })} /> : c.domain || <span className="muted-text">não informado</span>}</td>}
        {m ? <><td>{providerLabel(m.provider)}</td>{(['observationCount', 'mentionCount', 'recommendationCount', 'citationCount'] as const).map(f => <td key={f} className="n">{editing ? <input aria-label={`${f} ${c.name} ${m.provider}`} className="num" inputMode="numeric" value={m[f] ?? ''} onChange={e => set({ competitive: d.competitive.map((x, k) => k === i ? { ...x, metrics: x.metrics.map((y, l) => l === j ? { ...y, [f]: num(e.target.value) } : y) } : x) })} /> : m[f] ?? <span className="muted-text">—</span>}</td>)}</> : <td colSpan={5} className="muted-text">Sem contagens por plataforma.</td>}
      </tr>))}</tbody></table></div></section>}

    <section className="card"><h3 className="card-label">Descobertas</h3>
      <div className="grid grid-2">{Object.keys(FINDING_LABEL).map(t => { const items = d.findings.map((f, i) => ({ f, i })).filter(x => x.f.type === t); return <div key={t}><h4>{FINDING_LABEL[t]}</h4>
        {items.map(({ f, i }) => editing ? <div key={i} className="list-edit"><textarea rows={2} aria-label={FINDING_LABEL[t]} value={f.text} onChange={e => set({ findings: d.findings.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /><button className="icon-button" aria-label="Remover" onClick={() => set({ findings: d.findings.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></div> : <p key={i} className="finding">{f.text}</p>)}
        {!items.length && <p className="kicker">—</p>}
        {editing && <button className="button ghost" onClick={() => set({ findings: [...d.findings, { type: t, text: '', evidence: null }] })}><Plus size={14} /> Adicionar</button>}
      </div>; })}</div>
    </section>

    <details className="card raw-text"><summary>Texto original ({d.rawText.split('\n').length} linhas)</summary><ol>{d.rawText.split('\n').map((l, i) => <li key={i}>{l || ' '}</li>)}</ol></details>

    {sensitive && <label className="notice warning ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Revisei o texto: ele contém apenas dados institucionais de marketing, sem informações de pacientes.</label>}
    {measurementId && editing && <div className="field"><label htmlFor="rev-note">Motivo da alteração</label><input id="rev-note" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: correção do número de observações do Gemini" /></div>}
    {err && <p className="notice warning" role="alert">{err}</p>}
    <div className="form-actions sticky-actions">
      <button className="button ghost" onClick={() => measurementId ? router.push(`/clients/${clientId}/ia/${measurementId}`) : setStep('input')} disabled={!!busy}><ArrowLeft size={14} /> Voltar</button>
      {!editing && <button className="button" onClick={() => setEditing(true)} disabled={!!busy}><Pencil size={14} /> Corrigir dados</button>}
      <button className="button primary" onClick={save} disabled={!!busy || !d.title.trim() || !d.source.trim() || !d.methodology.trim() || (sensitive && !ack)}><Check size={14} /> {busy === 'save' ? 'Salvando…' : measurementId ? 'Salvar nova versão' : 'Confirmar e salvar'}</button>
    </div>
  </div>;
}

function Cell({ v, e }: { v: string | number | null; e?: Evidence }) {
  if (v == null || v === '') return <span className="muted-text" title="Não informado no texto">—</span>;
  return <span title={e ? (e.line ? `Linha ${e.line}: ${e.text}` : e.text) : 'Informado na revisão'} className={e ? 'with-evidence' : 'edited'}>{typeof v === 'number' ? v.toLocaleString('pt-BR') : v}</span>;
}
function Field({ label, value, editing = false, onChange, type = 'text', evidence, required }: { label: string; value: string; editing?: boolean; onChange?: (v: string) => void; type?: string; evidence?: Evidence; required?: boolean }) {
  return <div className="field"><label>{label}{required && editing ? ' *' : ''}</label>
    {editing && onChange ? <input type={type} value={value} onChange={e => onChange(e.target.value)} /> : <strong className={value ? '' : 'muted-text'}>{value ? (type === 'date' ? value.split('-').reverse().join('/') : value) : 'Não informado'}</strong>}
    {!editing && evidence && <small className="evidence">{evidence.line ? `Linha ${evidence.line}: ` : ''}{evidence.text}</small>}
  </div>;
}
