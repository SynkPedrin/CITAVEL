import {classifyLead} from './google.mjs';
/** CITAVEL reports. Pure local rendering; no network requests or secret serialization. */
const AI_HOSTS = ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'];
const RATE_KEYS = ['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice', 'money_prompt_coverage', 'owned_citation_rate', 'third_party_citation_rate', 'top3_recommendation_rate'];
const LABELS = {
  recommendation_coverage: 'Cobertura de recomendação', mention_rate: 'Taxa de menção',
  citation_rate: 'Taxa de citação', share_of_voice: 'Share of voice',
  money_prompt_coverage: 'Cobertura de prompts comerciais', owned_citation_rate: 'Citação do site do cliente',
  third_party_citation_rate: 'Citação de terceiros', top3_recommendation_rate: 'Recomendação no top 3',
};
const rows = value => Array.isArray(value) ? value : (Array.isArray(value?.rows) ? value.rows : []);
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const bool = value => value === true || value === 'true' || value === 1 ? true : value === false || value === 'false' || value === 0 ? false : null;
const compact = value => value == null ? '' : Array.isArray(value) ? value.map(compact).join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
export const escapeHtml = value => compact(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const md = value => compact(value).replace(/[\r\n]+/g, ' ').replace(/[\\|\[\]!*`]/g, char => `\\${char}`).replace(/</g, '&lt;').replace(/>/g, '&gt;');
const count = value => value == null ? 'Pendente' : new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(value);
const percent = value => value == null ? 'Pendente' : `${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(value * 100)}%`;
const money = (value, config) => value == null ? 'Pendente' : new Intl.NumberFormat('pt-BR', {style: 'currency', currency: /^[A-Z]{3}$/.test(config.currency || '') ? config.currency : 'BRL', maximumFractionDigits: 0}).format(value);
const sumKnown = (items, field) => {
  const known = items.map(item => numeric(item[field])).filter(value => value !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
const listValue = value => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
    return value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  }
  return [];
};
function safeUrl(value) {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function link(value, label) {
  const href = typeof value==='string' && /^\/clients\/[a-z0-9-]+\/pages\/drafts\/[a-z0-9-]+\.html$/.test(value) ? value : safeUrl(value);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || value)}</a>` : escapeHtml(label || value || '—');
}
function host(value) {
  if (!value) return '';
  try { return new URL(String(value).includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
const isAiHost = value => AI_HOSTS.some(domain => host(value) === domain || host(value).endsWith(`.${domain}`));
const aiName = value => /\b(chatgpt|perplexity|gemini|copilot|claude|google ai mode|modo ia|inteligência artificial)\b/i.test(compact(value));

/** Direct evidence is required; a correlated trend never becomes attributed revenue. */
export {classifyLead} from './google.mjs';


function isoWeek(input) {
  const day = new Date(input);
  if (!Number.isFinite(day.getTime())) return null;
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
function validRuns(state, type) {
  const candidates = rows(state.ai_runs).filter(run => String(run.run_type || '').toUpperCase() === type);
  const unique = [...new Map(candidates.map((run, index) => [run.run_id || `unidentified-${index}`, run])).values()];
  return unique.filter(run => run.valid !== false && !run.error && !['ERROR', 'FAILED', 'PENDING', 'SKIPPED', 'CANCELLED', 'CANCELED'].includes(String(run.status || '').toUpperCase()));
}
function normalizedMetrics(raw, runs, prompts, config) {
  const metrics = Object.fromEntries(RATE_KEYS.map(key => [key, null]));
  metrics.run_count = runs.length || numeric(raw?.run_count ?? raw?.valid_runs ?? raw?.runs ?? raw?.total_runs ?? raw?.count) || 0;
  metrics.observed = metrics.run_count > 0;
  const promptById = new Map(prompts.map(prompt => [prompt.prompt_id, prompt]));
  if (runs.length) {
    const mentionKnown = runs.filter(run => bool(run.brand_mentioned) !== null);
    const commercial = runs.filter(run => Number(promptById.get(run.prompt_id)?.commercial_score ?? run.commercial_score) >= 4);
    const recKnown = commercial.filter(run => bool(run.brand_recommended) !== null);
    const citationKnown = runs.filter(run => run.citations !== undefined && run.citations !== null);
    const domain = host(config.domain);
    const ownedKnown = runs.filter(run => bool(run.owned_domain_cited ?? run.owned_site_cited) !== null || (domain && run.citations != null));
    const ownedCited = run => bool(run.owned_domain_cited ?? run.owned_site_cited) ?? listValue(run.citations).some(citation => {
      const citedHost = host(typeof citation === 'object' ? citation.url || citation.source_url : citation);
      return !!domain && (citedHost === domain || citedHost.endsWith(`.${domain}`));
    });
    const brandCount = mentionKnown.filter(run => bool(run.brand_mentioned)).length;
    const competitiveKnown = runs.filter(run => run.competitors != null && bool(run.brand_recommended) !== null && listValue(run.competitors).every(competitor => typeof competitor === 'object' && bool(competitor.recommended) !== null));
    const voiceBrand = competitiveKnown.filter(run => bool(run.brand_recommended)).length;
    const voiceCompetitors = competitiveKnown.reduce((total, run) => total + new Set(listValue(run.competitors).filter(competitor => typeof competitor === 'object' && bool(competitor.recommended) === true).map(competitor => competitor.name || competitor.domain).filter(Boolean)).size, 0);
    const eligibleIds = new Set(recKnown.map(run => run.prompt_id).filter(Boolean));
    const recommendedIds = new Set(recKnown.filter(run => bool(run.brand_recommended)).map(run => run.prompt_id).filter(Boolean));
    Object.assign(metrics, {
      mention_rate: ratio(brandCount, mentionKnown.length),
      recommendation_coverage: ratio(recKnown.filter(run => bool(run.brand_recommended)).length, recKnown.length),
      citation_rate: ratio(citationKnown.filter(run => listValue(run.citations).length > 0).length, citationKnown.length),
      owned_citation_rate: ratio(ownedKnown.filter(ownedCited).length, ownedKnown.length),
      third_party_citation_rate: domain ? ratio(citationKnown.filter(run => listValue(run.citations).some(citation => {
        const citedHost = host(typeof citation === 'object' ? citation.url || citation.source_url : citation);
        return citedHost && citedHost !== domain && !citedHost.endsWith(`.${domain}`);
      })).length, citationKnown.length) : null,
      share_of_voice: ratio(voiceBrand, voiceBrand + voiceCompetitors),
      money_prompt_coverage: ratio(recommendedIds.size, eligibleIds.size),
      top3_recommendation_rate: ratio(recKnown.filter(run => bool(run.brand_recommended) && numeric(run.approx_position) >= 1 && numeric(run.approx_position) <= 3).length, recKnown.length),
      eligible_commercial_runs: recKnown.length,
      evaluated_prompts: new Set(runs.map(run => run.prompt_id).filter(Boolean)).size,
      recommendation_numerator: recKnown.filter(run => bool(run.brand_recommended)).length,
    });
  }
  // Explicit metrics are accepted only when they describe actual observed runs.
  if (metrics.observed) {
    for (const key of RATE_KEYS) {
      const value = numeric(raw?.[key]);
      const scaled = raw?.rate_scale === 100 && value !== null ? value / 100 : value;
      if (Object.hasOwn(raw || {}, key)) metrics[key] = scaled !== null && scaled >= 0 && scaled <= 1 ? scaled : null;
    }
  }
  return metrics;
}

function businessMetrics(state, config) {
  const leads = rows(state.leads);
  const observed = leads.length > 0 || state.integration_status?.leads?.status === 'READY' || state.integration_status?.leads === 'READY';
  const sourced = leads.filter(lead => classifyLead(lead) === 'AI_SOURCED');
  const assisted = leads.filter(lead => classifyLead(lead) === 'AI_ASSISTED');
  const correlated = leads.filter(lead => classifyLead(lead) === 'AI_CORRELATED');
  const open = items => items.filter(lead => /^(open|new|qualified|contacted|proposal|negotiation|opportunity|lead|novo|aberto|qualificado|contatado|proposta|negocia[cç][aã]o|oportunidade)$/i.test(lead.status || ''));
  return {
    observed,
    ai_sourced_leads: observed ? sourced.length : null,
    ai_assisted_leads: observed ? assisted.length : null,
    ai_correlated_leads: observed ? correlated.length : null,
    total_leads: observed ? leads.length : null,
    pipeline: sumKnown(open(sourced), 'opportunity_value'),
    revenue: sumKnown(sourced, 'closed_value'),
    assisted_pipeline: sumKnown(open(assisted), 'opportunity_value'),
    assisted_revenue: sumKnown(assisted, 'closed_value'),
    currency: config.currency || 'BRL',
    period: 'Dados de leads importados; valores associados aos registros disponíveis.',
  };
}

function seoMetrics(state) {
  const seo = rows(state.seo);
  const gsc = rows(state.search_console);
  // HTTP 200, an indexable page, and a sitemap do not prove Google indexation.
  const inspected = gsc.filter(row => row.indexed != null || row.index_status != null || row.indexing_state != null || row.verdict != null);
  const indexedPages = inspected.length ? new Set(inspected.filter(row => bool(row.indexed) === true || /^(indexed|pass|submitted_and_indexed)$/i.test(row.index_status || row.indexing_state || row.verdict || '')).map(row => row.page || row.url).filter(Boolean)).size : null;
  return {
    indexed_pages: indexedPages,
    impressions: sumKnown(gsc, 'impressions'),
    clicks: sumKnown(gsc, 'clicks'),
    audited_pages: seo.length || null,
    technical_issues: seo.length ? seo.reduce((total, page) => total + listValue(page.issues).filter(issue => typeof issue !== 'object' || String(issue.severity || '').toUpperCase() !== 'OK').length, 0) : null,
    indexable_pages: seo.some(page => bool(page.indexable) !== null) ? seo.filter(page => bool(page.indexable)).length : null,
  };
}

function analyticsMetrics(state) {
  const analytics = rows(state.analytics);
  const ai = analytics.filter(row => row.channel === 'AI_REFERRAL' || row.classification === 'AI_REFERRAL' || row.source === 'AI_REFERRAL' || isAiHost(row.source));
  return {
    sessions: sumKnown(analytics, 'sessions'),
    ai_sessions: ai.length ? sumKnown(ai, 'sessions') : analytics.length && analytics.every(row => row.source && numeric(row.sessions) !== null) ? 0 : null,
    conversions: sumKnown(analytics, 'conversions'),
    observed: analytics.length > 0,
  };
}

function snapshotMetrics(report, kind) {
  return report?.metrics?.[kind] || report?.metrics?.visibility?.[kind] || (report?.run_type === kind ? report : null);
}
function comparison(current, prior) {
  return Object.fromEntries(RATE_KEYS.map(key => {
    const before = numeric(prior?.[key]);
    const now = numeric(current[key]);
    return [key, before !== null && now !== null ? {current: now, previous: before, delta: now - before} : null];
  }));
}
function priorityActions(state) {
  const order = {HIGH: 0, CRITICAL: 0, MEDIUM: 1, LOW: 2};
  return rows(state.actions).filter(action => !/^(DONE|COMPLETED|CANCELLED)$/i.test(action.status || '')).sort((a, b) => (order[String(a.priority).toUpperCase()] ?? 3) - (order[String(b.priority).toUpperCase()] ?? 3)).slice(0, 5);
}
// Action Engine §5: ações que atingiram APPROVED ou além dentro da semana do relatório.
const ACTION_RANK = {DETECTED: 0, OPEN: 1, PROPOSED: 1, WAITING_APPROVAL: 2, APPROVED: 3, EXECUTING: 4, VALIDATING: 5, READY_TO_PUBLISH: 6, PUBLISHING: 7, PUBLISHED: 8, MONITORING: 9, MEASURED: 10, DONE: 10, COMPLETED: 10};
function implementations(state, week) {
  const results = rows(state.action_results);
  const gaps = rows(state.gaps);
  return rows(state.actions).map(action => {
    const lifecycle = Array.isArray(action.lifecycle) && action.lifecycle.length ? action.lifecycle : [{status: action.status, at: action.completed_at || action.created_at}];
    const reached = lifecycle.filter(entry => (ACTION_RANK[String(entry?.status || '').toUpperCase()] ?? -1) >= ACTION_RANK.APPROVED && entry.at && isoWeek(entry.at) === week);
    if (!reached.length) return null;
    const gap = gaps.find(candidate => candidate.gap_id === action.gap_id);
    const latest = results.filter(result => result.action_id === action.action_id).sort((a, b) => String(b.measured_at).localeCompare(String(a.measured_at)))[0] || null;
    return {
      action_id: action.action_id, title: action.title || action.description || action.action_id,
      problem: gap ? (gap.description || gap.gap_id) : (action.gap_id || action.source_issue_id || 'a vincular'),
      decision: String(reached[0].status).toUpperCase(), url: action.deployment?.url || null,
      prompts: listValue(action.affected_prompts), result_status: latest?.result_status || 'Ainda não medido',
    };
  }).filter(Boolean);
}
function collect(state, config) {
  const generatedAt = config.report_date || state.report_date || new Date().toISOString();
  const validDate = Number.isFinite(new Date(generatedAt).getTime()) ? new Date(generatedAt).toISOString() : new Date().toISOString();
  const week = isoWeek(validDate);
  const priorDate = new Date(validDate); priorDate.setUTCDate(priorDate.getUTCDate() - 7);
  const previousWeek = isoWeek(priorDate);
  const reports = rows(state.reports).filter(report => report.week && report.week < week).sort((a, b) => a.week.localeCompare(b.week));
  const previous = reports.filter(report => report.week === previousWeek).at(-1) || null;
  const baseline = reports.find(report => report.is_baseline || report.report_type === 'BASELINE') || reports[0] || null;
  const metrics = {
    GOLDEN: normalizedMetrics(state.metrics?.GOLDEN, validRuns(state, 'GOLDEN'), rows(state.prompts), config),
    LAB: normalizedMetrics(state.metrics?.LAB, validRuns(state, 'LAB'), rows(state.prompts), config),
    business: businessMetrics(state, config), seo: seoMetrics(state), analytics: analyticsMetrics(state),
  };
  const comparisons = Object.fromEntries(['GOLDEN', 'LAB'].map(kind => [kind, {
    previous_week: comparison(metrics[kind], snapshotMetrics(previous, kind)),
    baseline: comparison(metrics[kind], snapshotMetrics(baseline, kind)),
  }]));
  const sourceKeys = sources => new Set(rows(sources).map(source => source.url || source.domain).filter(Boolean));
  const currentSources = sourceKeys(rows(state.sources).filter(source => source.run_type === 'GOLDEN'));
  const previousSources = metrics.GOLDEN.observed && previous?.source_snapshot_type === 'GOLDEN' && Array.isArray(previous.source_snapshot) ? new Set(previous.source_snapshot) : null;
  return {
    report_id: `report-${String(config.client_id || state.client?.client_id || 'client').replace(/[^a-zA-Z0-9_-]/g, '-')}-${week}`,
    week, generated_at: validDate, metrics, comparisons, baseline_week: baseline?.week || null,
    previous_week: previousWeek, has_previous_week: !!previous,
    source_snapshot: [...currentSources], source_snapshot_type: 'GOLDEN',
    lab_source_snapshot: [...sourceKeys(rows(state.sources).filter(source => source.run_type === 'LAB'))],
    new_sources: previousSources ? [...currentSources].filter(source => !previousSources.has(source)) : null,
    lost_sources: previousSources ? [...previousSources].filter(source => !currentSources.has(source)) : null,
    actions_completed: rows(state.actions).filter(action => /^(DONE|COMPLETED)$/i.test(action.status || '') && isoWeek(action.completed_at) === week).length,
    next_actions: priorityActions(state),
    metric_scope: 'Snapshot acumulado dos registros disponíveis. Comparações usam snapshots salvos da semana anterior e do baseline.',
  };
}

function textReport(report, state, config) {
  const {metrics: m} = report;
  const lines = [
    `# CITAVEL · ${md(config.brand || state.client?.brand || config.client_id || 'Cliente')}`,
    `Relatório ${report.week} · ${report.generated_at}`, '', report.metric_scope, '',
    '## BUSINESS IMPACT',
    `- AI Sourced Leads: ${count(m.business.ai_sourced_leads)}`,
    `- AI Assisted Leads: ${count(m.business.ai_assisted_leads)}`,
    `- Pipeline AI Sourced em aberto: ${money(m.business.pipeline, config)}`,
    `- Receita AI Sourced registrada: ${money(m.business.revenue, config)}`,
    `- Pipeline AI Assisted (separado): ${money(m.business.assisted_pipeline, config)}`,
    `- Receita AI Assisted (separada): ${money(m.business.assisted_revenue, config)}`,
    'Valores associados aos leads importados. AI_CORRELATED não é contado como receita atribuída; associação não comprova causalidade.', '',
    '## DEMAND · GOLDEN',
    `Testes reais importados: ${m.GOLDEN.run_count}. ${m.GOLDEN.observed ? 'Resultados limitados à amostra registrada.' : 'Aguardando coleta ou importação legítima dos mecanismos alvo.'}`,
    ...['recommendation_coverage', 'mention_rate', 'share_of_voice', 'money_prompt_coverage'].map(key => `- ${LABELS[key]}: ${percent(m.GOLDEN[key])}`), '',
    '## EVIDENCE · GOLDEN', `- Taxa de citação: ${percent(m.GOLDEN.citation_rate)}`,
    `- Novas fontes: ${report.new_sources == null ? 'Pendente: comparação anterior indisponível' : report.new_sources.length}`,
    `- Fontes perdidas: ${report.lost_sources == null ? 'Pendente: comparação anterior indisponível' : report.lost_sources.length}`, '',
    '## SEO', `- Páginas indexadas: ${count(m.seo.indexed_pages)}${m.seo.indexed_pages === null ? ' — exige evidência de inspeção do Search Console' : ''}`,
    `- Impressões: ${count(m.seo.impressions)}`, `- Cliques: ${count(m.seo.clicks)}`,
    `- Problemas técnicos registrados: ${count(m.seo.technical_issues)}`, '',
    '## ANALYTICS', `- Sessões com referência identificada de IA: ${count(m.analytics.ai_sessions)}`,
    'O referrer identifica somente parte das visitas; tráfego sem referência não é automaticamente atribuído à IA.', '',
    '## COMPARAÇÃO · GOLDEN', '| Métrica | Atual | Semana anterior | Δ anterior | Baseline | Δ baseline |', '|---|---:|---:|---:|---:|---:|',
  ];
  const delta = comparison => comparison ? `${comparison.delta > 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(comparison.delta * 100)} p.p.` : 'Pendente';
  for (const key of ['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice']) {
    const prev = report.comparisons.GOLDEN.previous_week[key]; const base = report.comparisons.GOLDEN.baseline[key];
    lines.push(`| ${LABELS[key]} | ${percent(m.GOLDEN[key])} | ${percent(prev?.previous)} | ${delta(prev)} | ${percent(base?.previous)} | ${delta(base)} |`);
  }
  lines.push('', '## EXPERIMENTS');
  if (!rows(state.experiments).length) lines.push('Sem experimento registrado. Ainda não há intervenção avaliada para concluir melhora ou ausência de melhora.');
  for (const experiment of rows(state.experiments)) lines.push(`- ${md(experiment.name || experiment.experiment_id)}: ${md(experiment.status || 'Pendente')}. Hipótese: ${md(experiment.hypothesis || 'Pendente')}. Conclusão registrada: ${md(experiment.conclusion || 'Ainda não avaliada')}.`);
  lines.push('Variações observadas não demonstram causalidade absoluta.', '', '## IMPLEMENTAÇÕES REALIZADAS');
  if (!report.implementations.length) lines.push('Nenhuma implementação no período.');
  for (const item of report.implementations) lines.push(`- ${md(item.title)} — problema: ${md(item.problem)}; decisão: ${md(item.decision)}; URL publicada: ${md(item.url || 'não publicada')}; prompts alvo: ${md(item.prompts.join(', ') || '—')}; resultado: ${md(item.result_status)}.`);
  lines.push('', '## NEXT ACTIONS');
  if (!report.next_actions.length) lines.push('Sem ação aberta registrada.');
  report.next_actions.forEach((action, index) => lines.push(`${index + 1}. [${md(action.priority || 'Pendente')}] ${md(action.title || action.description || action.action_id)} — origem: ${md(action.gap_id || action.source_reference || 'a vincular')}; sinal esperado: ${md(action.expected_signal || 'a definir')}.`));
  lines.push('', '## LAB · USO INTERNO', `Execuções de API/modelo local: ${m.LAB.run_count}. LAB não representa a experiência de ChatGPT Search ou outros mecanismos alvo.`, ...['recommendation_coverage', 'mention_rate', 'citation_rate'].map(key => `- ${LABELS[key]} LAB: ${percent(m.LAB[key])}`), '', '## METODOLOGIA',
    'Taxas em proporção 0–1. Menção = execuções com menção / execuções com resposta de menção conhecida. Recomendação = recomendações / execuções comerciais P4/P5 com classificação conhecida. Cobertura comercial = prompts P4/P5 recomendados / prompts P4/P5 observados. Citação = respostas com citações / respostas com campo de citações conhecido. Share of voice = recomendações da marca / recomendações da marca e dos concorrentes, contando cada entidade uma vez por resposta. Dados ausentes permanecem pendentes.');
  return lines.join('\n');
}

export function buildReport(state = {}, config = {}) {
  const report = collect(obj(state), obj(config));
  report.implementations = implementations(obj(state), report.week);
  report.summary = `${config.brand || state.client?.brand || config.client_id || 'Cliente'} · ${report.week}: ${report.metrics.GOLDEN.run_count} execuções GOLDEN e ${report.metrics.LAB.run_count} LAB; ${count(report.metrics.business.ai_sourced_leads)} leads AI Sourced; ${report.next_actions.length} ações no próximo ciclo. ${report.metrics.GOLDEN.observed ? 'Resultados descrevem a amostra registrada.' : 'GOLDEN aguarda dados reais.'}`;
  report.markdown = textReport(report, state, config);
  report.html = documentShell(`CITAVEL · Relatório ${report.week}`, `<main class="report-page"><div class="wordmark">CITAVEL<span>®</span></div><p class="eyebrow">RELATÓRIO SEMANAL · ${escapeHtml(report.week)}</p><h1>${escapeHtml(config.brand || state.client?.brand || 'Cliente')}</h1><p class="muted">${escapeHtml(report.summary)}</p>${reportSections(report, state, config)}<details><summary>Relatório completo e metodologia</summary><pre class="report-text">${escapeHtml(report.markdown)}</pre></details></main>`, '');
  // Sheets-compatible top-level values are explicitly GOLDEN, never blended with LAB.
  Object.assign(report, Object.fromEntries(['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice'].map(key => [key, report.metrics.GOLDEN[key]])), {
    ai_sessions: report.metrics.analytics.ai_sessions,
    ai_leads: report.metrics.business.ai_sourced_leads,
    pipeline: report.metrics.business.pipeline,
    prompts_gained: null, prompts_lost: null,
  });
  return report;
}

const styles = `
:root{--navy:#081d29;--navy-2:#153440;--lime:#d2ef63;--paper:#f3f5ef;--ink:#122b35;--muted:#64767b;--line:#dce4df;--white:#fff;--radius:18px}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,a,input{font:inherit}a{color:#16634e;overflow-wrap:anywhere}button{cursor:pointer}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(30px,4vw,47px);letter-spacing:-1.8px;line-height:1.12;margin-bottom:12px}h2{font-size:22px;letter-spacing:-.6px;margin-bottom:16px}h3{font-size:16px;margin-bottom:12px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}.sidebar{min-width:0;background:var(--navy);color:white;padding:30px 22px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}.wordmark{font-weight:850;font-size:30px;letter-spacing:-1.5px}.wordmark span{font-size:11px;vertical-align:top;line-height:2.5;letter-spacing:0;margin-left:3px}.sidebar .wordmark{color:var(--lime)}.sidebar .subtitle{color:#9aafb6;font-size:10px;letter-spacing:2px;margin:6px 0 38px}.client-chip{background:#153440;border:1px solid #2c4752;border-radius:12px;padding:13px;margin-bottom:25px}.client-chip strong{display:block}.client-chip small{color:#afc1c7}.nav{display:grid;gap:4px}.nav button{background:none;border:0;color:#aabdc4;text-align:left;border-radius:9px;padding:10px 12px;display:flex;justify-content:space-between}.nav button:hover,.nav button[aria-selected=true]{background:var(--lime);color:var(--navy)}.nav button small{opacity:.6}.sidebar-foot{margin-top:auto;padding-top:25px;color:#a0b6bf;font-size:11px}.main{padding:28px 36px 48px;max-width:1600px;min-width:0}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:30px}.breadcrumb{font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}.status-pill{background:#e7eccc;border:1px solid #d3ddaf;border-radius:20px;padding:4px 10px;font-size:10px;letter-spacing:.6px;white-space:nowrap}.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin:10px 0 28px}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:1.8px;font-weight:750;color:#537466;margin-bottom:10px}.muted{color:var(--muted)}.hero p{max-width:680px;margin-bottom:0}.button{border:1px solid var(--navy);background:var(--navy);color:white;border-radius:10px;padding:10px 16px;text-decoration:none;white-space:nowrap}.button.secondary{background:white;color:var(--navy)}.section{margin-top:28px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.section-heading h2{margin:0}.badge{display:inline-block;font-size:10px;letter-spacing:.7px;font-weight:700;padding:4px 8px;border-radius:6px;background:#edf1ec;color:#52635c;white-space:nowrap}.badge.golden{background:var(--lime);color:#183924}.badge.lab{background:#e8edf3;color:#526078}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{background:white;padding:20px;border:1px solid var(--line);border-radius:var(--radius);min-width:0}.card .label{font-size:12px;color:#5c7279;min-height:20px}.card .value{font-size:28px;font-weight:750;letter-spacing:-.8px;line-height:1.2;margin:12px 0 9px}.card .value.pending{font-size:21px;color:#8b9898;font-weight:550}.card .note{font-size:11px;color:var(--muted);line-height:1.5}.golden-panel{background:var(--navy);border-radius:20px;padding:24px;color:white}.golden-panel .section-heading .muted{color:#a5bbc0}.golden-panel .card{background:#17343f;border-color:#2c4b56}.golden-panel .label,.golden-panel .note{color:#b0c1c5}.golden-panel .value{color:var(--lime)}.golden-panel .value.pending{color:#bbc8c7}.golden-panel h2{color:white}.notice{padding:16px 18px;background:#eaf0dc;border:1px solid #d6e1c3;border-radius:12px;font-size:12px;margin:16px 0;color:#425945}.notice.neutral{background:#edf1f1;border-color:#dce4e4;color:#64777d}.golden-panel .notice{background:#24433c;border-color:#3c5d4d;color:#d3e3c3}.two-col{display:grid;grid-template-columns:1.15fr 1fr;gap:20px}.panel{background:white;border:1px solid var(--line);border-radius:var(--radius);padding:22px;min-width:0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:13px;background:white}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{padding:13px 15px;background:#edf1eb;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#637770;white-space:nowrap}td{padding:14px 15px;border-top:1px solid #e8ede8;vertical-align:top;max-width:440px;overflow-wrap:anywhere}td a{font-size:11px}tr:hover td{background:#fafcf7}.empty{padding:30px 20px;border:1px dashed #c4d2c8;border-radius:14px;background:#f7f9f3;color:#718177;text-align:center}.empty strong{display:block;color:#3d5950;margin-bottom:4px}.action{display:grid;grid-template-columns:26px 1fr;gap:10px;padding:14px 0;border-top:1px solid #e8ede8}.action:first-of-type{border:0}.action .number{font-size:11px;line-height:24px;width:24px;height:24px;background:#eef4db;text-align:center;border-radius:6px}.action p{font-size:12px;margin:4px 0 0;color:var(--muted)}.action strong{font-size:13px}.integration{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #e9eee8;font-size:12px}.integration:last-child{border:0}.flow{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.flow span{font-size:10px;background:#ecf1e6;padding:5px 9px;border-radius:5px;color:#4d695a}.footnote{font-size:11px;color:var(--muted);margin-top:16px}.tab-panel[hidden]{display:none!important}details{margin-top:22px;border:1px solid var(--line);border-radius:13px;padding:17px 19px;background:white}summary{cursor:pointer;font-weight:650}details .cards{margin-top:16px}.report-text{white-space:pre-wrap;font:12px/1.8 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;margin:20px 0}.report-page{max-width:1150px;margin:auto;padding:40px 30px}.report-page>.wordmark{margin-bottom:34px}.report-page h1{margin-bottom:20px}.pill-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}footer{margin-top:40px;border-top:1px solid var(--line);padding-top:16px;display:flex;justify-content:space-between;gap:12px;color:#7d8d83;font-size:10px}.integration-note{display:block;color:var(--muted);font-size:10px;margin-top:3px}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #7aa423;outline-offset:3px}@media(max-width:1150px){.main{padding:24px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.two-col{grid-template-columns:1fr}}@media(max-width:760px){.shell{grid-template-columns:1fr}.sidebar{min-width:0;position:static;height:auto;padding:18px}.sidebar .subtitle,.client-chip,.sidebar-foot{display:none}.sidebar .wordmark{font-size:25px}.nav{display:flex;overflow:auto;gap:6px;margin-top:16px}.nav button{padding:7px 12px;white-space:nowrap}.nav small{display:none}.main{padding:20px 16px}.hero{display:block}.hero .button{display:inline-block;margin-top:20px}.topbar{margin-bottom:22px}.cards{gap:10px}.card{padding:16px}.card .value{font-size:25px}.golden-panel{padding:18px}.section-heading{align-items:flex-start}.section-heading .muted{font-size:11px}.panel{padding:18px}h1{letter-spacing:-1px}.report-page{padding:25px 16px}}@media print{.sidebar,.topbar,.hero .button,.nav,.no-print{display:none!important}.shell{display:block}.main,.report-page{padding:0}.tab-panel{display:none}.tab-panel:not([hidden]){display:block}.card,.panel,.golden-panel{break-inside:avoid}body{background:white}.golden-panel{color:#122b35;background:#eef5dd}.golden-panel h2,.golden-panel .value{color:#122b35}.golden-panel .card{background:white}.golden-panel .label,.golden-panel .note{color:#566}.report-page details{display:block}.report-text{font-size:10px}footer{margin-top:20px}}
`;
function documentShell(title, content, script) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${content}${script ? `<script>${script}</script>` : ''}</body></html>`;
}
function card(label, value, note = '', pending = value === 'Pendente') {
  return `<article class="card"><div class="label">${escapeHtml(label)}</div><div class="value${pending ? ' pending' : ''}">${escapeHtml(value)}</div><div class="note">${escapeHtml(note)}</div></article>`;
}
function empty(title, description = '') { return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(description)}</div>`; }
function table(items, columns, emptyTitle = 'Dados ainda não disponíveis', emptyDescription = 'Os registros aparecerão aqui depois da coleta ou importação.') {
  if (!items.length) return empty(emptyTitle, emptyDescription);
  return `<div class="table-wrap"><table><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column[0])}</th>`).join('')}</tr></thead><tbody>${items.map(item => `<tr>${columns.map(column => `<td>${typeof column[1] === 'function' ? column[1](item) : escapeHtml(compact(item[column[1]]) || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const badge = (text, type = '') => `<span class="badge ${type}">${escapeHtml(text || 'PENDENTE')}</span>`;
const section = (title, content, extra = '') => `<section class="section"><div class="section-heading"><h2>${escapeHtml(title)}</h2>${extra}</div>${content}</section>`;
function goldenPanel(report) {
  const m = report.metrics.GOLDEN;
  return `<section class="golden-panel"><div class="section-heading"><div><p class="eyebrow" style="color:#d2ef63;margin-bottom:5px">VISIBILIDADE REAL</p><h2>Presença nos mecanismos de IA</h2></div>${badge('GOLDEN', 'golden')}</div><div class="cards">${['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice'].map(key => card(LABELS[key], percent(m[key]), m.observed ? `${m.run_count} execuções registradas` : 'Aguardando testes reais', m[key] === null)).join('')}</div>${!m.observed ? '<div class="notice">Aguardando testes GOLDEN. Importe respostas reais de ChatGPT, Gemini, Perplexity, Google AI Mode ou Copilot para medir a visibilidade do cliente.</div>' : '<p class="footnote" style="color:#b9cbc6">Resultados da amostra importada. Plataformas, prompts e datas podem afetar a comparação.</p>'}</section>`;
}
function businessCards(report, config) {
  const b = report.metrics.business;
  return `<div class="cards">${card('Leads · AI Sourced', count(b.ai_sourced_leads), 'Referência direta ou origem autodeclarada')}${card('Leads · AI Assisted', count(b.ai_assisted_leads), 'Participação declarada da IA')}${card('Pipeline · AI Sourced', money(b.pipeline, config), 'Oportunidades abertas com valor registrado')}${card('Receita · AI Sourced', money(b.revenue, config), 'Valor fechado informado nos leads')}</div><p class="footnote">Valores associados aos registros importados. AI_CORRELATED fica fora da receita atribuída. Dados ainda não coletados aparecem como pendentes.</p>`;
}
function comparisonTable(report) {
  const delta = item => item ? `${item.delta > 0 ? '+' : ''}${count(item.delta * 100)} p.p.` : 'Pendente';
  return table(['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice'].map(key => ({key})), [
    ['Métrica', row => escapeHtml(LABELS[row.key])], ['Atual', row => percent(report.metrics.GOLDEN[row.key])],
    ['Semana anterior', row => percent(report.comparisons.GOLDEN.previous_week[row.key]?.previous)],
    ['Variação', row => delta(report.comparisons.GOLDEN.previous_week[row.key])],
    ['Baseline', row => percent(report.comparisons.GOLDEN.baseline[row.key]?.previous)],
    ['Variação', row => delta(report.comparisons.GOLDEN.baseline[row.key])],
  ]);
}
function actionList(actions) {
  return actions.length ? actions.map((action, index) => `<article class="action"><span class="number">${index + 1}</span><div><strong>${escapeHtml(action.title || action.description || action.action_id)}</strong><p>${escapeHtml(action.priority || 'Pendente')} · ${escapeHtml(action.type || 'Ação')} · Origem: ${escapeHtml(action.gap_id || action.source_issue_id || 'a vincular')}</p><p>Sinal esperado: ${escapeHtml(action.expected_signal || 'a definir')}</p></div></article>`).join('') : empty('Sem ações abertas', 'O backlog será gerado a partir de gaps sustentados por dados.');
}
function integrations(state) {
  const source = obj(state.integration_status);
  const names = {google_sheets: 'Google Sheets', sheets: 'Google Sheets', gemini: 'Gemini', ollama: 'Ollama', search_console: 'Search Console', gsc: 'Search Console', ga4: 'GA4', gtm: 'GTM'};
  const keys = Object.keys(source).length ? Object.keys(source) : ['google_sheets', 'gemini', 'ollama', 'search_console', 'ga4', 'gtm'];
  return keys.map(key => {
    const data = source[key]; const status = typeof data === 'string' ? data : data?.status || 'PENDENTE';
    // Only display approved status fields, never serialize an integration object.
    return `<div class="integration"><div>${escapeHtml(names[key] || key)}${data?.note ? `<span class="integration-note">${escapeHtml(data.note)}</span>` : ''}</div>${badge(status)}</div>`;
  }).join('');
}
function labPanel(report) {
  return `<details><summary>${badge('LAB', 'lab')} Análises internas · ${report.metrics.LAB.run_count} execuções</summary><p class="muted" style="margin:14px 0 0">Testes via API ou modelo local apoiam o desenvolvimento e a análise. São medidos separadamente dos resultados reais dos mecanismos alvo.</p><div class="cards">${['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice'].map(key => card(`${LABELS[key]} · LAB`, percent(report.metrics.LAB[key]), 'Amostra interna; não equivale ao GOLDEN')).join('')}</div></details>`;
}
function reportSections(report, state, config) {
  const done = table(report.implementations, [
    ['Ação', row => escapeHtml(row.title)], ['Problema', row => escapeHtml(row.problem)],
    ['Decisão', row => badge(row.decision)], ['URL publicada', row => row.url ? link(row.url) : escapeHtml('não publicada')],
    ['Prompts alvo', row => escapeHtml(row.prompts.join(', ') || '—')], ['Resultado', row => badge(row.result_status)],
  ], 'Nenhuma implementação no período.', 'Ações aprovadas nesta semana aparecerão aqui com origem, URL e resultado medido.');
  return `${goldenPanel(report)}${section('Impacto no negócio', businessCards(report, config))}${section('Evolução · GOLDEN', comparisonTable(report))}${section('Implementações realizadas', done)}${section('Próximas ações', `<div class="panel">${actionList(report.next_actions)}</div>`)}${labPanel(report)}`;
}

export function renderDashboard(state = {}, config = {}) {
  state = obj(state); config = obj(config);
  const report = buildReport(state, config);
  const brand = config.brand || state.client?.brand || config.client_id || 'Cliente';
  const prompts = rows(state.prompts); const runs = rows(state.ai_runs); const pages = rows(state.pages);
  const commercialPrompts = prompts.filter(prompt => Number(prompt.commercial_score) >= 4);
  const clusterCounts = [...new Set(prompts.map(prompt => prompt.cluster || 'SEM CLUSTER'))].map(cluster => ({cluster, total: prompts.filter(prompt => (prompt.cluster || 'SEM CLUSTER') === cluster).length, commercial: prompts.filter(prompt => (prompt.cluster || 'SEM CLUSTER') === cluster && Number(prompt.commercial_score) >= 4).length}));
  const header = (eyebrow, title, description) => `<div class="hero"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(description)}</p></div></div>`;
  const overview = `${header('CLIENT ENGINE / VISÃO GERAL', `O próximo passo de ${brand}.`, 'Da demanda à evidência. Acompanhe o que foi observado, o que falta comprovar e quais ações têm prioridade.')}${goldenPanel(report)}${section('Impacto no negócio', businessCards(report, config))}<div class="two-col section"><section class="panel"><div class="section-heading"><h2>Próximo ciclo</h2>${badge(`${report.next_actions.length} AÇÕES`)}</div>${actionList(report.next_actions)}</section><section class="panel"><h2>Integrações</h2>${integrations(state)}<p class="footnote">Cada integração registra seu próprio estado. Pendências não são convertidas em resultados.</p></section></div>${labPanel(report)}<div class="flow">${['DEMANDA', 'BASELINE', 'FONTES', 'GAPS', 'AÇÕES', 'CONTEÚDO', 'RETESTE'].map(step => `<span>${step}</span>`).join('')}</div>`;
  const demand = `${header('DEMAND / OPORTUNIDADES', 'As perguntas que importam.', 'Perguntas comerciais orientam a medição e o backlog. A cobertura usa somente prompts com resultados observados.')}<div class="cards">${card('Prompts registrados', count(prompts.length), 'Universo configurado')}${card('Prompts comerciais P4/P5', count(commercialPrompts.length), 'Compra e recomendação direta')}${card('Cobertura comercial · GOLDEN', percent(report.metrics.GOLDEN.money_prompt_coverage), 'Prompts comerciais recomendados / observados')}${card('Recomendação top 3 · GOLDEN', percent(report.metrics.GOLDEN.top3_recommendation_rate), 'Execuções comerciais com posição explícita 1–3')}</div>${section('Clusters de demanda', table(clusterCounts, [['Cluster', 'cluster'], ['Prompts', 'total'], ['P4/P5', 'commercial']]))}${section('Evolução da visibilidade · GOLDEN', comparisonTable(report))}<p class="footnote">${escapeHtml(report.metric_scope)} Uma variação representa associação observada; não demonstra causalidade.</p>${labPanel(report)}`;
  const promptTab = `${header('PROMPTS / MONITORAMENTO', 'Uma base auditável.', 'Intenção, prioridade e resultado ficam ligados a cada pergunta. Resultados LAB e GOLDEN continuam separados.')}${table(prompts, [['ID', 'prompt_id'], ['Pergunta', 'prompt'], ['Cluster', 'cluster'], ['Score comercial', 'commercial_score'], ['Prioridade', 'priority'], ['Controle', row => bool(row.control_group) === true ? 'Sim' : bool(row.control_group) === false ? 'Não' : '—']])}${section('Execuções recentes', table([...runs].reverse().slice(0, 100), [['Tipo', row => badge(row.run_type || 'PENDENTE', row.run_type === 'GOLDEN' ? 'golden' : 'lab')], ['Data', 'timestamp'], ['Prompt', 'prompt_id'], ['Plataforma / modelo', row => escapeHtml([row.platform, row.model].filter(Boolean).join(' / '))], ['Menção', row => bool(row.brand_mentioned) === null ? 'Pendente' : bool(row.brand_mentioned) ? 'Sim' : 'Não'], ['Recomendação', row => bool(row.brand_recommended) === null ? 'Pendente' : bool(row.brand_recommended) ? 'Sim' : 'Não'], ['Status', 'status']]))}`;
  const competitors = `${header('COMPETITORS / CONTEXTO', 'Quem aparece nas respostas.', 'Entidades extraídas das respostas coletadas. Menções observadas não são participação de mercado.')}<div class="notice neutral">Consulte o tipo de execução para interpretar cada registro. Não combine concorrência LAB com resultados GOLDEN.</div>${table(rows(state.competitors), [['Concorrente', 'name'], ['Domínio', row => link(row.domain?.includes('://') ? row.domain : row.domain ? `https://${row.domain}` : '')], ['Tipo', row => badge(row.run_type || row.dataset || 'NÃO INFORMADO', row.run_type === 'GOLDEN' ? 'golden' : 'lab')], ['Menções', 'mentions'], ['Recomendações', 'recommendations'], ['Citações', 'citation_count'], ['Última observação', 'last_seen']])}`;
  const sources = `${header('SOURCES / EVIDÊNCIAS', 'As fontes por trás das respostas.', 'Citações conectam perguntas, concorrentes e oportunidades. Frequência de citação não confirma a veracidade de uma fonte.')}<div class="cards">${card('Fontes registradas', count(rows(state.sources).length), 'Registros no grafo de fontes')}${card('Novas fontes', report.new_sources == null ? 'Pendente' : count(report.new_sources.length), 'Em relação ao snapshot anterior')}${card('Fontes perdidas', report.lost_sources == null ? 'Pendente' : count(report.lost_sources.length), 'Em relação ao snapshot anterior')}${card('Citação própria · GOLDEN', percent(report.metrics.GOLDEN.owned_citation_rate), 'Respostas que citaram o domínio do cliente')}</div>${section('Source graph', table(rows(state.sources), [['Fonte', row => link(row.url || (row.domain ? `https://${row.domain}` : ''), row.domain || row.url)], ['Tipo de execução', row => badge(row.run_type || row.dataset || 'NÃO INFORMADO', row.run_type === 'GOLDEN' ? 'golden' : 'lab')], ['Citações', 'citation_count'], ['Prompts', 'prompt_count'], ['Cliente presente', row => bool(row.client_present) === null ? 'Pendente' : bool(row.client_present) ? 'Sim' : 'Não'], ['Oportunidade', 'opportunity_score']]))}${section('Evidence bank', table(rows(state.evidence), [['Afirmação', row => escapeHtml(row.claim || row.value || '—')], ['Categoria', 'category'], ['Fonte', row => link(row.source_url)], ['Verificação', row => bool(row.verified) === true ? badge('VERIFICADO') : badge('A VALIDAR')], ['Coleta', row => escapeHtml(row.created_at || row.updated_at || '—')]]))}`;
  const actions = `${header('ACTIONS / EXECUÇÃO', 'Prioridade com origem clara.', 'Cada ação deve responder a um gap observado e ter um sinal esperado. Conteúdo permanece em draft até aprovação.')}<div class="panel">${actionList(report.next_actions)}</div>${section('Backlog completo', table(rows(state.actions), [['Ação', row => escapeHtml(row.title || row.description || row.action_id)], ['Prioridade', 'priority'], ['Tipo', 'type'], ['Gap de origem', 'gap_id'], ['Status', 'status'], ['Sinal esperado', 'expected_signal']]))}${section('Gaps identificados', table(rows(state.gaps), [['Gap', 'gap_id'], ['Tipo', 'gap_type'], ['Descrição', row => escapeHtml(row.description || row.reason || '—')], ['Prompt', 'prompt_id'], ['Confiança', 'confidence'], ['Status', 'status']]))}${section('Páginas e ativos', table(pages, [['Título', row => escapeHtml(row.title || row.page_id)], ['URL / slug', row => row.url ? link(row.url) : escapeHtml(row.slug || '—')], ['Status', 'status'], ['Experimento', 'experiment_id']]))}`;
  const experiments = `${header('EXPERIMENTS / APRENDIZADO', 'Mudanças que podem ser avaliadas.', 'Hipótese, intervenção, controle e checkpoints D30 / D60 / D90 organizam a observação dos resultados.')}<div class="notice neutral">Uma melhora após a intervenção pode ser compatível com a hipótese. Só os dados registrados permitem avaliar essa associação; não há afirmação automática de causalidade.</div>${table(rows(state.experiments), [['Experimento', row => escapeHtml(row.name || row.experiment_id)], ['Hipótese', 'hypothesis'], ['Intervenção', 'intervention_prompts'], ['Controle', 'control_prompts'], ['Status', 'status'], ['Início', 'start_date'], ['Conclusão', row => escapeHtml(row.conclusion || 'Ainda não avaliada')]])}`;
  const seo = `${header('SEO / BASE TÉCNICA', 'Uma presença acessível e verificável.', 'O crawl identifica condições técnicas. A indexação só é confirmada por evidência específica do Search Console.')}<div class="cards">${card('Páginas auditadas', count(report.metrics.seo.audited_pages), 'Amostra analisada pelo crawler')}${card('Páginas indexadas', count(report.metrics.seo.indexed_pages), 'Requer inspeção do Search Console')}${card('Impressões', count(report.metrics.seo.impressions), 'Dados importados do Search Console')}${card('Cliques', count(report.metrics.seo.clicks), 'Dados importados do Search Console')}</div>${section('Auditoria técnica', table(rows(state.seo), [['Página', row => link(row.url)], ['HTTP', 'status_code'], ['Indexável', row => bool(row.indexable) === null ? 'Pendente' : bool(row.indexable) ? 'Sim' : 'Não'], ['Título', 'title'], ['Palavras', 'word_count'], ['Problemas', row => escapeHtml(listValue(row.issues).map(issue => typeof issue === 'string' ? issue : issue.message || issue.description || issue.type || issue.code).filter(Boolean).join('; ') || 'Nenhum problema registrado')]]))}<p class="footnote">Uma página indexável ou liberada para Googlebot / OAI-SearchBot não tem garantia de indexação, ranking ou recomendação.</p>${section('Search Console', table(rows(state.search_console), [['Data', 'date'], ['Consulta', 'query'], ['Página', row => link(row.page || row.url)], ['Cliques', 'clicks'], ['Impressões', 'impressions'], ['Posição', 'position']]))}`;
  const analytics = `${header('ANALYTICS / NEGÓCIO', 'Sinais de visita, lead e oportunidade.', 'Atribuição acompanha evidência direta ou declaração do lead. Correlação permanece identificada separadamente.')}${businessCards(report, config)}${section('Tráfego observado', `<div class="cards">${card('Sessões totais', count(report.metrics.analytics.sessions), 'Período dos registros importados')}${card('Sessões AI Referral', count(report.metrics.analytics.ai_sessions), 'Referência identificada dos mecanismos de IA')}${card('Conversões', count(report.metrics.analytics.conversions), 'Eventos importados; não equivalem automaticamente a leads')}${card('Leads AI Correlated', count(report.metrics.business.ai_correlated_leads), 'Excluídos da receita atribuída')}</div>`)}${section('Aquisição', table(rows(state.analytics), [['Data', 'date'], ['Origem', 'source'], ['Mídia', 'medium'], ['Landing page', row => link(row.landing_page)], ['Sessões', 'sessions'], ['Conversões', 'conversions']]))}${section('Leads', table(rows(state.leads), [['ID', 'lead_id'], ['Data', 'created_at'], ['Classificação', row => badge(classifyLead(row))], ['Origem', 'source'], ['Status', 'status'], ['Oportunidade', row => escapeHtml(money(numeric(row.opportunity_value), config))], ['Valor fechado', row => escapeHtml(money(numeric(row.closed_value), config))]]))}<p class="footnote">Uma pessoa pode conhecer a marca via IA sem produzir referrer. Ausência de referência não prova ausência de influência.</p>`;
  const reports = `${header('REPORTS / MEMÓRIA', 'Cada ciclo deixa uma evidência.', 'Relatórios preservam a evolução observada e as próximas ações. Sem baseline ou semana anterior, a comparação permanece pendente.')}<div class="pill-row"><button class="button" id="download-report" type="button">Baixar relatório .md</button><button class="button secondary" id="print-report" type="button">Imprimir / salvar PDF</button></div>${section(`Snapshot ${report.week}`, `<div class="panel"><p>${escapeHtml(report.summary)}</p><p class="footnote">${escapeHtml(report.metric_scope)}</p>${comparisonTable(report)}</div>`)}${section('Histórico salvo', table([...rows(state.reports)].reverse(), [['Semana', 'week'], ['Resumo', 'summary'], ['GOLDEN · recomendação', row => percent(snapshotMetrics(row, 'GOLDEN')?.recommendation_coverage)], ['Gerado em', 'generated_at']]))}<details><summary>Relatório completo</summary><pre class="report-text">${escapeHtml(report.markdown)}</pre></details><textarea id="report-export" hidden>${escapeHtml(report.markdown)}</textarea>`;
  const tabs = {Overview: overview, Demand: demand, Prompts: promptTab, Competitors: competitors, Sources: sources, Actions: actions, Experiments: experiments, SEO: seo, Analytics: analytics, Reports: reports};
  const nav = Object.keys(tabs).map((name, index) => `<button type="button" role="tab" id="nav-${name}" data-tab="${name}" aria-controls="tab-${name}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${name}<small>${String(index + 1).padStart(2, '0')}</small></button>`).join('');
  const body = `<div class="shell"><aside class="sidebar"><div class="wordmark">CITAVEL<span>®</span></div><div class="subtitle">CLIENT ENGINE V1</div><div class="client-chip"><strong>${escapeHtml(brand)}</strong><small>${escapeHtml(config.client_id || state.client?.client_id || 'CLIENTE')}</small></div><nav class="nav" role="tablist" aria-label="Seções do dashboard" aria-orientation="vertical">${nav}</nav><div class="sidebar-foot">Inteligência que vira presença.<br>Exportação local · dados auditáveis</div></aside><main class="main"><div class="topbar"><span class="breadcrumb">CITAVEL / ${escapeHtml(brand)} / <span id="current-tab">Overview</span></span><span class="status-pill">SNAPSHOT ${escapeHtml(report.week)}</span></div>${Object.entries(tabs).map(([name, content], index) => `<section class="tab-panel" role="tabpanel" id="tab-${name}" aria-labelledby="nav-${name}" tabindex="0"${index ? ' hidden' : ''}>${content}</section>`).join('')}<footer><span>CITAVEL CLIENT ENGINE · ${escapeHtml(brand)}</span><span>Atualizado em ${escapeHtml(report.generated_at.replace('T', ' ').slice(0, 16))} UTC</span></footer></main></div>`;
  const script = `const tabs=[...document.querySelectorAll('[data-tab]')];function selectTab(name,focus){if(!tabs.some(t=>t.dataset.tab===name))name='Overview';tabs.forEach(t=>{const active=t.dataset.tab===name;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;if(active&&focus)t.focus()});document.querySelectorAll('.tab-panel').forEach(p=>{p.hidden=p.id!=='tab-'+name});document.getElementById('current-tab').textContent=name;try{history.replaceState(null,'','#'+name)}catch{}}tabs.forEach((t,i)=>{t.addEventListener('click',()=>selectTab(t.dataset.tab));t.addEventListener('keydown',e=>{let j=i;if(['ArrowDown','ArrowRight'].includes(e.key))j=(i+1)%tabs.length;else if(['ArrowUp','ArrowLeft'].includes(e.key))j=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')j=0;else if(e.key==='End')j=tabs.length-1;else return;e.preventDefault();selectTab(tabs[j].dataset.tab,true)})});selectTab(location.hash.slice(1)||'Overview');document.getElementById('download-report').addEventListener('click',()=>{const blob=new Blob([document.getElementById('report-export').value],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='citavel-weekly-report.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)});document.getElementById('print-report').addEventListener('click',()=>window.print());`;
  return documentShell(`CITAVEL · ${brand}`, body, script);
}
