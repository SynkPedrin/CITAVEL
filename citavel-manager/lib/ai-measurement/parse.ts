// Deterministic interpreter for AI-presence reports produced by external agents. No LLM, no network.
// The input is untrusted external data: it is only read, never executed or obeyed. Every extracted value
// carries the original line that supports it; anything ambiguous becomes null with a warning for human review.
export const PARSER_VERSION = 'ai-import-v1';

export type Evidence = { line: number; text: string } | null;
export type Field<T> = { value: T | null; evidence: Evidence };
export const COUNT_FIELDS = ['promptCount', 'observationCount', 'mentionCount', 'recommendationCount', 'citationCount'] as const;
export type CountField = (typeof COUNT_FIELDS)[number];
export type ParsedPlatform = {
  provider: string; label: string; evidence: Evidence;
  model: Field<string>; collectionMethod: Field<string>;
  promptCount: Field<number>; observationCount: Field<number>; mentionCount: Field<number>; recommendationCount: Field<number>; citationCount: Field<number>;
  declaredRates: { field: CountField; percent: number; evidence: Evidence }[];
};
export type CompetitiveMetric = { provider: string; observationCount: number | null; mentionCount: number | null; recommendationCount: number | null; citationCount: number | null };
export type ParsedCompetitive = { name: string; domain: string | null; metrics: CompetitiveMetric[]; evidence: Evidence };
export type FindingType = 'STRENGTH' | 'WEAKNESS' | 'OPPORTUNITY' | 'CONCLUSION' | 'LIMITATION' | 'EVIDENCE';
export type Warning = { code: string; message: string; line?: number };
export type Classification = 'LAB' | 'GOLDEN' | 'QUALITATIVE';
export type Parsed = {
  parserVersion: string; format: 'JSON' | 'TEMPLATE' | 'TABLE' | 'FREE_TEXT';
  meta: { client: Field<string>; domain: Field<string>; periodStart: Field<string>; periodEnd: Field<string>; executedAt: Field<string>; source: Field<string>; methodology: Field<string>; methodologyVersion: Field<string>; declaredClassification: Field<string> };
  platforms: ParsedPlatform[];
  competitors: { name: string; platform: string | null; evidence: Evidence }[];
  competitive: ParsedCompetitive[];
  sources: { url: string; evidence: Evidence }[];
  findings: { type: FindingType; text: string; evidence: Evidence }[];
  warnings: Warning[];
  suggestedClassification: Classification; classificationReason: string;
};

// ---- vocabulary ----
export const PROVIDERS: { key: string; label: string; re: RegExp }[] = [
  { key: 'OPENAI', label: 'OpenAI / ChatGPT', re: /\b(openai|chat\s?gpt|gpt[-\s]?\d[\w.-]*|searchgpt)\b/i },
  { key: 'GEMINI', label: 'Google Gemini', re: /\b(gemini|bard)\b/i },
  { key: 'GOOGLE_AI', label: 'Google AI Mode / AI Overviews', re: /\b(ai\s?mode|ai\s?overviews?|modo\s+ia|sge)\b/i },
  { key: 'CLAUDE', label: 'Anthropic Claude', re: /\b(claude|anthropic)\b/i },
  { key: 'COPILOT', label: 'Microsoft Copilot', re: /\b(copilot|bing\s+chat)\b/i },
  { key: 'PERPLEXITY', label: 'Perplexity', re: /\bperplexity\b/i },
  { key: 'GROK', label: 'xAI Grok', re: /\bgrok\b/i },
  { key: 'DEEPSEEK', label: 'DeepSeek', re: /\bdeepseek\b/i },
  { key: 'META_AI', label: 'Meta AI', re: /\b(meta\s?ai|llama)\b/i },
  { key: 'MISTRAL', label: 'Mistral / Le Chat', re: /\b(mistral|le\s?chat)\b/i },
];
export const providerLabel = (key: string) => PROVIDERS.find(p => p.key === key)?.label || key;
export function detectProvider(text: string): string | null { const hits = PROVIDERS.filter(p => p.re.test(text)); return hits.length === 1 ? hits[0].key : null; }
export const detectProviders = (text: string) => PROVIDERS.filter(p => p.re.test(text)).map(p => p.key);

export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const META_KEYS: Record<string, keyof Parsed['meta']> = {
  'cliente': 'client', 'client': 'client', 'empresa': 'client', 'dominio': 'domain', 'domain': 'domain', 'site': 'domain',
  'periodo': 'periodStart', 'period': 'periodStart', 'periodo avaliado': 'periodStart',
  'data da execucao': 'executedAt', 'data de execucao': 'executedAt', 'data da coleta': 'executedAt', 'data': 'executedAt', 'executado em': 'executedAt', 'executed at': 'executedAt',
  'origem': 'source', 'source': 'source', 'fonte da medicao': 'source',
  'metodologia': 'methodology', 'methodology': 'methodology', 'metodo': 'methodology',
  'versao': 'methodologyVersion', 'versao da metodologia': 'methodologyVersion', 'version': 'methodologyVersion',
  'classificacao': 'declaredClassification', 'tipo de medicao': 'declaredClassification', 'tipo': 'declaredClassification',
};
const PLATFORM_FIELDS: Record<string, 'model' | 'collectionMethod' | CountField> = {
  'modelo': 'model', 'model': 'model', 'modelos': 'model',
  'metodo de coleta': 'collectionMethod', 'coleta': 'collectionMethod', 'collection method': 'collectionMethod', 'metodo': 'collectionMethod', 'interface': 'collectionMethod',
  'prompts': 'promptCount', 'perguntas': 'promptCount', 'quantidade de prompts': 'promptCount',
  'observacoes': 'observationCount', 'observations': 'observationCount', 'respostas': 'observationCount', 'amostra': 'observationCount', 'execucoes': 'observationCount',
  'mencoes': 'mentionCount', 'mentions': 'mentionCount', 'mencoes da marca': 'mentionCount',
  'recomendacoes': 'recommendationCount', 'recommendations': 'recommendationCount', 'recomendacoes da marca': 'recommendationCount',
  'citacoes': 'citationCount', 'citations': 'citationCount', 'citacoes do site': 'citationCount',
};
const SECTIONS: Record<string, FindingType | 'PLATFORMS' | 'COMPETITORS' | 'SOURCES'> = {
  'plataformas': 'PLATFORMS', 'platforms': 'PLATFORMS', 'resultados por plataforma': 'PLATFORMS',
  'concorrentes': 'COMPETITORS', 'competitors': 'COMPETITORS', 'concorrentes mencionados': 'COMPETITORS', 'concorrentes identificados': 'COMPETITORS',
  'fontes': 'SOURCES', 'sources': 'SOURCES', 'fontes citadas': 'SOURCES', 'urls': 'SOURCES',
  'pontos fortes': 'STRENGTH', 'strengths': 'STRENGTH', 'pontos fracos': 'WEAKNESS', 'weaknesses': 'WEAKNESS',
  'oportunidades': 'OPPORTUNITY', 'opportunities': 'OPPORTUNITY', 'conclusao': 'CONCLUSION', 'conclusoes': 'CONCLUSION', 'conclusion': 'CONCLUSION', 'conclusions': 'CONCLUSION',
  'evidencias': 'EVIDENCE', 'evidence': 'EVIDENCE', 'respostas originais': 'EVIDENCE', 'limitacoes': 'LIMITATION', 'limitations': 'LIMITATION',
};
const EMPTY = /^(n\/?a|nao informad[oa]s?|nao se aplica|nenhum[a]?|sem dados|-+|—|–|\?|null|desconhecido|not reported|unknown)$/i;

// ---- helpers ----
const field = <T>(value: T | null = null, evidence: Evidence = null): Field<T> => ({ value, evidence });
const ev = (i: number, line: string): Evidence => ({ line: i + 1, text: line.trim().slice(0, 400) });
export function parseDay(s: string): string | null {
  const t = s.trim(); let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number) { const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null; }
function periodOf(s: string): [string | null, string | null] {
  const days = [...s.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g)].map(m => parseDay(m[0]));
  return [days[0] ?? null, days[1] ?? days[0] ?? null];
}
/** Reads a count. "8", "8 de 20", "8/20" → 8 (+denominator). Percentages are NOT counts. */
export function parseCount(raw: string): { count: number | null; denominator: number | null; percent: number | null; empty: boolean } {
  const s = raw.trim(); if (!s || EMPTY.test(norm(s))) return { count: null, denominator: null, percent: null, empty: true };
  const pm = s.match(/^~?\s*(\d+(?:[.,]\d+)?)\s*%/); if (pm) return { count: null, denominator: null, percent: Number(pm[1].replace(',', '.')), empty: false };
  const fm = s.match(/^(\d{1,6})\s*(?:\/|de|of|em|das|dos)\s*(\d{1,6})\b/i); if (fm) return { count: +fm[1], denominator: +fm[2], percent: null, empty: false };
  const nm = s.match(/^(\d{1,6})\b(?!\s*[.,]\d)/); if (nm) return { count: +nm[1], denominator: null, percent: null, empty: false };
  return { count: null, denominator: null, percent: null, empty: false };
}
function keyValue(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*(?:[-*•]\s*|#{1,6}\s*|\*\*)?([^:|]{2,48}?)(?:\*\*)?\s*:\s*(.*)$/);
  if (!m || /https?$/i.test(m[1].trim())) return null;
  return { key: norm(m[1].replace(/\*\*/g, '')), value: m[2].replace(/\*\*/g, '').trim() };
}
function newPlatform(key: string, e: Evidence): ParsedPlatform {
  return { provider: key, label: providerLabel(key), evidence: e, model: field(), collectionMethod: field(), promptCount: field(), observationCount: field(), mentionCount: field(), recommendationCount: field(), citationCount: field(), declaredRates: [] };
}

export function parseMeasurement(input: string): Parsed {
  const text = input.replace(/\r\n?/g, '\n').slice(0, 400_000);
  const lines = text.split('\n');
  const out: Parsed = {
    parserVersion: PARSER_VERSION, format: 'FREE_TEXT',
    meta: { client: field(), domain: field(), periodStart: field(), periodEnd: field(), executedAt: field(), source: field(), methodology: field(), methodologyVersion: field(), declaredClassification: field() },
    platforms: [], competitors: [], competitive: [], sources: [], findings: [], warnings: [], suggestedClassification: 'QUALITATIVE', classificationReason: '',
  };
  const warn = (code: string, message: string, line?: number) => { if (!out.warnings.some(w => w.code === code && w.line === line && w.message === message)) out.warnings.push({ code, message, line }); };
  safetyScan(lines, warn);

  const json = tryJson(text);
  if (json) { out.format = 'JSON'; fromJson(json, out, warn); }
  else {
    const usedTemplate = fromTemplate(lines, out, warn);
    const usedTable = fromTables(lines, out, warn);
    out.format = usedTemplate ? 'TEMPLATE' : usedTable ? 'TABLE' : 'FREE_TEXT';
    if (out.format === 'FREE_TEXT') fromFreeText(lines, out, warn);
  }
  finalize(out, warn);
  return out;
}

function safetyScan(lines: string[], warn: (c: string, m: string, l?: number) => void) {
  lines.forEach((l, i) => {
    if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(l)) warn('SENSITIVE_DATA', 'Possível CPF no texto. Remova dados pessoais antes de salvar.', i + 1);
    if (/\b(paciente|prontu[aá]rio|laudo|resultado (?:do|de) exame|data de nascimento|CID[- ]?\w\d)/i.test(l)) warn('SENSITIVE_DATA', 'Possível informação de paciente/saúde. O Manager trabalha apenas com dados institucionais de marketing.', i + 1);
    if (/(?:\+?55\s?)?\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/.test(l)) warn('SENSITIVE_DATA', 'Possível telefone pessoal no texto.', i + 1);
    if (/(ignore|desconsidere|esque[cç]a)\s+(all|todas?|as|previous|anteriores|the)\b.*(instru|instruction|regra|rule)|system prompt|you are now|voc[eê] agora [eé]|aprove automaticamente|delete|drop table/i.test(l)) warn('UNTRUSTED_INSTRUCTION', 'O texto contém instruções. Elas foram tratadas apenas como texto e não alteram o sistema.', i + 1);
  });
}

function tryJson(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  for (const candidate of [fenced?.[1], text.trim()]) {
    if (!candidate || !/^[[{]/.test(candidate.trim())) continue;
    try { const v = JSON.parse(candidate); if (v && typeof v === 'object') return v; } catch { /* not JSON */ }
  }
  return null;
}

function fromJson(j: any, out: Parsed, warn: (c: string, m: string, l?: number) => void) {
  const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== '') return o[k]; return undefined; };
  const jev = (path: string, v: unknown): Evidence => ({ line: 0, text: `JSON ${path} = ${JSON.stringify(v).slice(0, 300)}` });
  const setMeta = (k: keyof Parsed['meta'], v: unknown, path: string) => { if (typeof v === 'string' || typeof v === 'number') out.meta[k] = field(String(v), jev(path, v)); };
  setMeta('client', pick(j, 'client', 'cliente', 'empresa'), 'client');
  setMeta('domain', pick(j, 'domain', 'dominio', 'domínio', 'site'), 'domain');
  setMeta('source', pick(j, 'source', 'origem'), 'source');
  setMeta('methodology', pick(j, 'methodology', 'metodologia'), 'methodology');
  setMeta('methodologyVersion', pick(j, 'methodology_version', 'methodologyVersion', 'versao', 'versão', 'version'), 'methodology_version');
  setMeta('declaredClassification', pick(j, 'classification', 'classificacao', 'classificação', 'type'), 'classification');
  const exec = pick(j, 'executed_at', 'executedAt', 'data_execucao', 'data_da_execucao', 'date');
  if (exec) { const d = parseDay(String(exec)); if (d) out.meta.executedAt = field(d, jev('executed_at', exec)); else warn('INVALID_DATE', `Data de execução não reconhecida: ${String(exec).slice(0, 40)}`); }
  const period = pick(j, 'period', 'periodo', 'período');
  if (period) {
    const [a, b] = typeof period === 'object' ? [parseDay(String(period.start ?? period.inicio ?? '')), parseDay(String(period.end ?? period.fim ?? ''))] : periodOf(String(period));
    if (a) out.meta.periodStart = field(a, jev('period', period)); if (b) out.meta.periodEnd = field(b, jev('period', period));
    if (!a) warn('INVALID_DATE', 'Período não reconhecido no JSON.');
  }
  let plats = pick(j, 'platforms', 'plataformas');
  if (plats && !Array.isArray(plats) && typeof plats === 'object') plats = Object.entries(plats).map(([k, v]: any) => ({ provider: k, ...v }));
  (Array.isArray(plats) ? plats : []).forEach((p: any, i: number) => {
    const name = String(pick(p, 'provider', 'platform', 'plataforma', 'name', 'nome') ?? '');
    const key = detectProvider(name) || (name ? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) : null);
    if (!key) { warn('PLATFORM_UNKNOWN', `Plataforma sem nome no item ${i + 1}; ignorada.`); return; }
    const pl = newPlatform(key, jev(`platforms[${i}]`, name)); if (!detectProvider(name)) pl.label = name;
    const m = pick(p, 'model', 'modelo'); if (m) pl.model = field(String(m), jev(`platforms[${i}].model`, m));
    const c = pick(p, 'collection_method', 'collectionMethod', 'metodo_de_coleta', 'método_de_coleta', 'method'); if (c) pl.collectionMethod = field(String(c), jev(`platforms[${i}].collection_method`, c));
    const map: [CountField, string[]][] = [['promptCount', ['prompts', 'prompt_count', 'promptCount']], ['observationCount', ['observations', 'observation_count', 'observationCount', 'observacoes', 'observações', 'responses']], ['mentionCount', ['mentions', 'mention_count', 'mentionCount', 'mencoes', 'menções']], ['recommendationCount', ['recommendations', 'recommendation_count', 'recommendationCount', 'recomendacoes', 'recomendações']], ['citationCount', ['citations', 'citation_count', 'citationCount', 'citacoes', 'citações']]];
    for (const [f, keys] of map) { const v = pick(p, ...keys); if (v === undefined) continue; applyCount(pl, f, String(v), jev(`platforms[${i}].${keys[0]}`, v), warn); }
    out.platforms.push(pl);
  });
  const list = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);
  list(pick(j, 'competitors', 'concorrentes')).forEach((c: any, i: number) => { const name = typeof c === 'string' ? c : c?.name ?? c?.nome; if (name) out.competitors.push({ name: String(name).slice(0, 120), platform: typeof c === 'object' && c?.platform ? detectProvider(String(c.platform)) || String(c.platform) : null, evidence: jev(`competitors[${i}]`, c) }); });
  readCompetitive(j, out, warn, jev, pick);
  list(pick(j, 'sources', 'fontes')).forEach((s: any, i: number) => { const url = typeof s === 'string' ? s : s?.url; if (url && /^https?:\/\//i.test(url)) out.sources.push({ url: String(url).slice(0, 500), evidence: jev(`sources[${i}]`, s) }); });
  const fmap: [FindingType, string[]][] = [['STRENGTH', ['strengths', 'pontos_fortes']], ['WEAKNESS', ['weaknesses', 'pontos_fracos']], ['OPPORTUNITY', ['opportunities', 'oportunidades']], ['CONCLUSION', ['conclusion', 'conclusions', 'conclusao', 'conclusão', 'conclusoes']], ['LIMITATION', ['limitations', 'limitacoes', 'limitações']], ['EVIDENCE', ['evidence', 'evidences', 'evidencias', 'evidências', 'responses_original', 'respostas_originais']]];
  for (const [t, keys] of fmap) list(pick(j, ...keys)).forEach((v: any, i: number) => { const s = typeof v === 'string' ? v : JSON.stringify(v); if (s.trim()) out.findings.push({ type: t, text: s.slice(0, 2000), evidence: jev(`${keys[0]}[${i}]`, v) }); });
}

/** Per-competitor counts (JSON `competitive_analysis`, or platform counts inside `competitors[]`). Same rules as the
 * client's own platforms: a count needs a total; impossible or percent-only values are dropped with a warning. */
function readCompetitive(j: any, out: Parsed, warn: (c: string, m: string, l?: number) => void, jev: (p: string, v: unknown) => Evidence, pick: (o: any, ...k: string[]) => any) {
  const ca = pick(j, 'competitive_analysis', 'analise_competitiva', 'análise_competitiva');
  const fromCa = Array.isArray(ca) ? ca : Array.isArray(ca?.competitors) ? ca.competitors : Array.isArray(ca?.concorrentes) ? ca.concorrentes : [];
  const fromList = (Array.isArray(pick(j, 'competitors', 'concorrentes')) ? pick(j, 'competitors', 'concorrentes') : []).filter((c: any) => c && typeof c === 'object' && pick(c, 'platforms', 'plataformas', 'metrics', 'metricas', 'métricas'));
  const entries = [...fromCa.map((c: any, i: number) => ({ c, path: `competitive_analysis.competitors[${i}]` })), ...fromList.map((c: any, i: number) => ({ c, path: `competitors[${i}]` }))];
  const seen = new Set<string>();
  for (const { c, path } of entries) {
    const name = String(pick(c, 'name', 'nome', 'company', 'empresa') ?? '').trim().slice(0, 120); if (!name || typeof c !== 'object') continue;
    const key = norm(name); if (seen.has(key)) { warn('DUPLICATE_COMPETITOR', `Concorrente repetido na análise competitiva: ${name}. Mantida a primeira ocorrência.`); continue; } seen.add(key);
    const rawDomain = pick(c, 'domain', 'dominio', 'domínio', 'site', 'website'); const domain = typeof rawDomain === 'string' ? normalizeDomain(rawDomain) : null;
    if (typeof rawDomain === 'string' && !domain) warn('INVALID_DOMAIN', `Domínio inválido para ${name}: "${rawDomain.slice(0, 60)}". Ignorado.`);
    let plats = pick(c, 'platforms', 'plataformas', 'metrics', 'metricas', 'métricas');
    if (plats && !Array.isArray(plats) && typeof plats === 'object') plats = Object.entries(plats).map(([k, v]: any) => ({ platform: k, ...v }));
    const metrics: CompetitiveMetric[] = [];
    for (const [i, p] of (Array.isArray(plats) ? plats : []).entries()) {
      const pname = String(pick(p, 'provider', 'platform', 'plataforma', 'name', 'nome') ?? ''); const provider = detectProvider(pname) || (pname ? pname.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30) : null);
      if (!provider) { warn('PLATFORM_UNKNOWN', `${name}: plataforma sem nome no item ${i + 1}; ignorada.`); continue; }
      const rd = (keys: string[], label: string): number | null => { const v = pick(p, ...keys); if (v === undefined) return null; const r = parseCount(String(v)); if (r.empty) return null; if (r.percent != null) { warn('PERCENT_WITHOUT_COUNT', `${name} · ${providerLabel(provider)}: percentual declarado em ${label} sem contagem; ignorado.`); return null; } if (r.count == null) { warn('UNREADABLE_NUMBER', `${name} · ${providerLabel(provider)}: valor não numérico em ${label}.`); return null; } return r.count; };
      const m: CompetitiveMetric = { provider, observationCount: rd(['observations', 'observation_count', 'observationCount', 'observacoes', 'observações', 'responses'], 'observações'), mentionCount: rd(['mentions', 'mention_count', 'mentionCount', 'mencoes', 'menções'], 'menções'), recommendationCount: rd(['recommendations', 'recommendation_count', 'recommendationCount', 'recomendacoes', 'recomendações'], 'recomendações'), citationCount: rd(['citations', 'citation_count', 'citationCount', 'citacoes', 'citações'], 'citações') };
      for (const f of ['mentionCount', 'recommendationCount', 'citationCount'] as const) {
        if (m[f] != null && m.observationCount == null) warn('MISSING_DENOMINATOR', `${name} · ${providerLabel(provider)}: ${m[f]} ${label(f)} sem total de observações; a taxa não será calculada.`);
        else if (m[f] != null && m[f]! > m.observationCount!) { warn('IMPOSSIBLE_VALUE', `${name} · ${providerLabel(provider)}: ${label(f)} (${m[f]}) maior que observações (${m.observationCount}). Corrija na revisão.`); m[f] = null; }
      }
      if (metrics.some(x => x.provider === provider)) { warn('DUPLICATE_PLATFORM', `${name}: plataforma repetida (${providerLabel(provider)}); mantida a primeira.`); continue; }
      metrics.push(m);
    }
    out.competitive.push({ name, domain, metrics, evidence: jev(path, { name, domain }) });
    if (!out.competitors.some(x => norm(x.name) === key)) out.competitors.push({ name, platform: metrics.map(m => m.provider).join(',') || null, evidence: jev(path, name) });
  }
}
export function normalizeDomain(raw: string): string | null {
  try { const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); const h = u.hostname.toLowerCase().replace(/^www\./, ''); return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null; } catch { return null; }
}

function applyCount(pl: ParsedPlatform, f: CountField, raw: string, e: Evidence, warn: (c: string, m: string, l?: number) => void) {
  const r = parseCount(raw);
  if (r.empty) return;
  if (r.percent != null) { pl.declaredRates.push({ field: f, percent: r.percent, evidence: e }); warn('PERCENT_WITHOUT_COUNT', `${pl.label}: percentual declarado (${r.percent}%) sem contagem; não convertido em número de respostas.`, e?.line); return; }
  if (r.count == null) { warn('UNREADABLE_NUMBER', `${pl.label}: valor não numérico em ${f} ("${raw.slice(0, 40)}").`, e?.line); return; }
  const prev = pl[f].value;
  if (prev != null && prev !== r.count) { pl[f] = field<number>(null, null); warn('CONFLICTING_VALUES', `${pl.label}: valores conflitantes para ${f} (${prev} e ${r.count}). Informe o valor correto na revisão.`, e?.line); (pl as any)[`_conflict_${f}`] = true; return; }
  if ((pl as any)[`_conflict_${f}`]) return;
  pl[f] = field(r.count, e);
  if (r.denominator != null && f !== 'observationCount' && f !== 'promptCount') {
    if (pl.observationCount.value == null) { pl.observationCount = field(r.denominator, e); warn('DENOMINATOR_AS_OBSERVATIONS', `${pl.label}: total de observações lido de "${r.count} de ${r.denominator}". Confirme na revisão.`, e?.line); }
    else if (pl.observationCount.value !== r.denominator) warn('CONFLICTING_VALUES', `${pl.label}: "${r.count} de ${r.denominator}" não bate com ${pl.observationCount.value} observações.`, e?.line);
  }
}

function fromTemplate(lines: string[], out: Parsed, warn: (c: string, m: string, l?: number) => void): boolean {
  let section: string | null = null; let current: ParsedPlatform | null = null; let hits = 0;
  const platformByKey = new Map<string, ParsedPlatform>();
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t/g, ' ');
    if (!line.trim()) return;
    if (/^\s*\|/.test(line)) return; // tables handled separately
    const kv = keyValue(line);
    const headingOnly = !kv && line.trim().replace(/^#+\s*/, '').replace(/[*:]/g, '').trim();
    const sectionKey = kv ? kv.key : headingOnly ? norm(headingOnly) : '';
    if (sectionKey && SECTIONS[sectionKey] && (!kv || !kv.value || SECTIONS[sectionKey] !== 'PLATFORMS')) {
      section = SECTIONS[sectionKey]; current = null; hits++;
      if (kv?.value) pushItem(section, kv.value, i, raw);
      return;
    }
    if (kv && META_KEYS[kv.key] && !current) {
      const k = META_KEYS[kv.key]; hits++;
      if (!kv.value || EMPTY.test(norm(kv.value))) return;
      if (k === 'periodStart') { const [a, b] = periodOf(kv.value); if (a) out.meta.periodStart = field(a, ev(i, raw)); if (b) out.meta.periodEnd = field(b, ev(i, raw)); if (!a) warn('INVALID_DATE', `Período não reconhecido: "${kv.value.slice(0, 60)}". Use dd/mm/aaaa a dd/mm/aaaa.`, i + 1); }
      else if (k === 'executedAt') { const d = parseDay(kv.value); if (d) out.meta.executedAt = field(d, ev(i, raw)); else warn('INVALID_DATE', `Data de execução não reconhecida: "${kv.value.slice(0, 40)}".`, i + 1); }
      else out.meta[k] = field(kv.value.slice(0, 300), ev(i, raw));
      section = null; return;
    }
    // Platform header: "OPENAI:" / "## Gemini" / "GEMINI (gemini-2.5-pro):"
    const headerText = kv ? (kv.value && !PLATFORM_FIELDS[kv.key] ? '' : kv.key) : headingOnly ? norm(headingOnly) : '';
    const prov = headerText && headerText.length <= 40 && !PLATFORM_FIELDS[headerText] ? detectProvider(headerText) : null;
    if (prov && (section === 'PLATFORMS' || section === null)) {
      section = 'PLATFORMS'; hits++;
      current = platformByKey.get(prov) || newPlatform(prov, ev(i, raw));
      if (!platformByKey.has(prov)) { platformByKey.set(prov, current); out.platforms.push(current); }
      return;
    }
    if (kv && current && PLATFORM_FIELDS[kv.key]) {
      const f = PLATFORM_FIELDS[kv.key]; hits++;
      if (f === 'model' || f === 'collectionMethod') { if (kv.value && !EMPTY.test(norm(kv.value))) current[f] = field(kv.value.slice(0, 200), ev(i, raw)); }
      else applyCount(current, f, kv.value, ev(i, raw), warn);
      return;
    }
    if (section && section !== 'PLATFORMS') pushItem(section, line, i, raw);
  });
  function pushItem(sec: string, value: string, i: number, raw: string) {
    const item = value.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!item || EMPTY.test(norm(item))) return;
    if (sec === 'COMPETITORS') {
      const name = item.split(/\s+[—–-]\s+|\s*\(|:/)[0].replace(/\*\*/g, '').trim();
      if (name.length >= 2 && name.length <= 120) out.competitors.push({ name, platform: detectProviders(item.slice(name.length)).join(',') || null, evidence: ev(i, raw) });
    } else if (sec === 'SOURCES') {
      const urls = item.match(/https?:\/\/[^\s)>\]"']+/g);
      if (urls) urls.forEach(u => out.sources.push({ url: u.replace(/[.,;]+$/, ''), evidence: ev(i, raw) }));
      else warn('SOURCE_WITHOUT_URL', `Fonte sem URL: "${item.slice(0, 60)}". Mantida apenas no texto original.`, i + 1);
    } else out.findings.push({ type: sec as FindingType, text: item.slice(0, 2000), evidence: ev(i, raw) });
  }
  return hits >= 3;
}

function fromTables(lines: string[], out: Parsed, warn: (c: string, m: string, l?: number) => void): boolean {
  let used = false;
  for (let i = 0; i < lines.length - 2; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const head = cells(lines[i]).map(norm);
    const pcol = head.findIndex(h => /plataforma|platform|modelo|ia\b|provedor|provider/.test(h));
    if (pcol < 0) continue;
    const col = (re: RegExp) => head.findIndex(h => re.test(h));
    const cols: [CountField | 'model', number][] = [['promptCount', col(/prompt|pergunta/)], ['observationCount', col(/observ|respost|amostra|execu/)], ['mentionCount', col(/menc|mention/)], ['recommendationCount', col(/recom/)], ['citationCount', col(/cita|citation/)], ['model', head.findIndex((h, k) => k !== pcol && /^modelo|^model/.test(h))]];
    for (let r = i + 2; r < lines.length && /^\s*\|/.test(lines[r]); r++) {
      const c = cells(lines[r]); const prov = detectProvider(c[pcol] || '');
      if (!prov) { if ((c[pcol] || '').trim()) warn('PLATFORM_UNKNOWN', `Linha de tabela sem plataforma reconhecida: "${(c[pcol] || '').slice(0, 40)}".`, r + 1); continue; }
      used = true;
      let pl = out.platforms.find(p => p.provider === prov); if (!pl) { pl = newPlatform(prov, ev(r, lines[r])); out.platforms.push(pl); }
      for (const [f, k] of cols) { if (k < 0 || c[k] == null) continue; if (f === 'model') { if (c[k].trim() && !EMPTY.test(norm(c[k]))) pl.model = field(c[k].trim(), ev(r, lines[r])); } else applyCount(pl, f, c[k], ev(r, lines[r]), warn); }
    }
  }
  return used;
}
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());

function fromFreeText(lines: string[], out: Parsed, warn: (c: string, m: string, l?: number) => void) {
  // Only explicit "N de M" statements tied to exactly one platform and one metric keyword become numbers.
  lines.forEach((raw, i) => raw.split(/(?<=[.!?;])\s+/).forEach(sentence => {
    const l = sentence.trim(); if (!l) return;
    for (const k of detectProviders(l)) if (!out.platforms.some(p => p.provider === k)) out.platforms.push(newPlatform(k, ev(i, raw)));
    const prov = detectProvider(l);
    const metric: CountField | null = /recomend/i.test(l) ? 'recommendationCount' : /cita[cç]|citou|citad/i.test(l) ? 'citationCount' : /menciona|menç|mention/i.test(l) ? 'mentionCount' : null;
    const frac = l.match(/\b(\d{1,5})\s*(?:de|\/|em|das|dos|of)\s*(\d{1,5})\b/i);
    if (!frac || !metric) return;
    if (!prov) { warn('NUMBER_WITHOUT_PLATFORM', `Número encontrado sem plataforma identificável: "${l.slice(0, 80)}".`, i + 1); return; }
    applyCount(out.platforms.find(p => p.provider === prov)!, metric, `${frac[1]} de ${frac[2]}`, { line: i + 1, text: l.slice(0, 400) }, warn);
  }));
  if (out.platforms.length && out.platforms.every(p => COUNT_FIELDS.every(f => p[f].value == null))) warn('QUALITATIVE_ONLY', 'Texto sem contagens explícitas. Será salvo como análise qualitativa, sem percentuais.');
}

function finalize(out: Parsed, warn: (c: string, m: string, l?: number) => void) {
  for (const p of out.platforms) {
    const obs = p.observationCount.value;
    for (const f of ['mentionCount', 'recommendationCount', 'citationCount'] as const) {
      const v = p[f].value; if (v == null) continue;
      if (obs == null) warn('MISSING_DENOMINATOR', `${p.label}: ${v} ${label(f)} sem total de observações; a taxa não será calculada.`, p[f].evidence?.line);
      else if (v > obs) { warn('IMPOSSIBLE_VALUE', `${p.label}: ${label(f)} (${v}) maior que observações (${obs}). Corrija na revisão.`, p[f].evidence?.line); p[f] = field<number>(null, p[f].evidence); }
    }
    if (p.recommendationCount.value != null && p.mentionCount.value != null && p.recommendationCount.value > p.mentionCount.value) warn('CHECK_VALUES', `${p.label}: mais recomendações que menções. Confira (uma recomendação normalmente é também uma menção).`, p.recommendationCount.evidence?.line);
    for (const k of Object.keys(p)) if (k.startsWith('_conflict_')) delete (p as any)[k];
  }
  const missing = (['client', 'methodology', 'executedAt', 'periodStart'] as const).filter(k => out.meta[k].value == null);
  if (missing.length) warn('MISSING_FIELDS', `Não encontrado no texto: ${missing.map(k => ({ client: 'cliente', methodology: 'metodologia', executedAt: 'data de execução', periodStart: 'período' }[k])).join(', ')}. Preencha na revisão.`);
  if (!out.platforms.length) warn('NO_PLATFORMS', 'Nenhuma plataforma identificada. Adicione manualmente se o relatório tiver resultados por plataforma.');
  const c = suggestClassification(out); out.suggestedClassification = c.value; out.classificationReason = c.reason;
}
const label = (f: CountField) => ({ promptCount: 'prompts', observationCount: 'observações', mentionCount: 'menções', recommendationCount: 'recomendações', citationCount: 'citações' }[f]);

/** Conservative: GOLDEN only with declared consumer collection + per-platform method + original evidence. */
export function suggestClassification(p: Pick<Parsed, 'meta' | 'platforms' | 'findings' | 'sources'>): { value: Classification; reason: string } {
  const declared = norm([p.meta.declaredClassification.value, p.meta.source.value, p.meta.methodology.value].filter(Boolean).join(' '));
  const methods = p.platforms.map(x => norm(x.collectionMethod.value || ''));
  const hasNumbers = p.platforms.some(x => COUNT_FIELDS.some(f => x[f].value != null));
  const evidence = p.findings.filter(f => f.type === 'EVIDENCE').length;
  if (/\blab\b|\bapi\b|automatiz|experimental|playground/.test(declared) || methods.some(m => /\bapi\b|automatiz/.test(m))) return { value: 'LAB', reason: 'Declarada como execução por API/ambiente automatizado.' };
  if (!hasNumbers) return { value: 'QUALITATIVE', reason: 'Sem contagens explícitas: apenas análise qualitativa.' };
  const consumer = /golden|interface|aplicativo|\bapp\b|navegador|browser|manual|consumo|consumer/.test(declared) || methods.some(m => /interface|aplicativo|\bapp\b|navegador|browser|manual|web/.test(m));
  const allMethods = p.platforms.length > 0 && methods.every(Boolean);
  if (consumer && allMethods && evidence > 0) return { value: 'GOLDEN', reason: 'Coleta em plataformas de consumo declarada por plataforma, com evidências originais.' };
  if (consumer || /golden/.test(declared)) return { value: 'QUALITATIVE', reason: 'Declarada como coleta real, mas sem método por plataforma e evidências originais suficientes para GOLDEN.' };
  return { value: 'QUALITATIVE', reason: 'Procedência da coleta não comprovada no texto.' };
}
