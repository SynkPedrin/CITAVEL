import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, clientDir, atomicWrite, stableId, upsert } from './store.mjs';
import { escapeHtml } from './reports.mjs';
import { renderPdf } from './pdf.mjs';

/**
 * Report Engine (V2, contrato §2). REPORT SNAPSHOT imutável → HTML executivo
 * com identidade CITÁVEL → PDF quando houver renderer. Zero números
 * hardcoded: tudo deriva do state; dado ausente vira "Pendente". LAB e GOLDEN
 * nunca se misturam; data_sources declara a origem de cada número.
 */
const CHARTREUSE = '#C6FF00';
const RATE_LABELS = {
  recommendation_coverage: 'Cobertura de recomendação', mention_rate: 'Taxa de menção',
  citation_rate: 'Taxa de citação', share_of_voice: 'Share of voice',
  money_prompt_coverage: 'Cobertura de prompts comerciais', owned_citation_rate: 'Citação do site do cliente',
  third_party_citation_rate: 'Citação de terceiros', top3_recommendation_rate: 'Recomendação no top 3',
};
const ACTION_RANK = { DETECTED: 0, OPEN: 1, PROPOSED: 1, WAITING_APPROVAL: 2, APPROVED: 3, EXECUTING: 4, VALIDATING: 5, READY_TO_PUBLISH: 6, PUBLISHING: 7, PUBLISHED: 8, MONITORING: 9, MEASURED: 10 };

const rows = (value) => Array.isArray(value) ? value : [];
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = (value) => value == null ? 'Pendente' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const pct = (value) => value == null ? 'Pendente' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
const now = () => new Date().toISOString();
const isoDay = (date) => date.toISOString().slice(0, 10);

function weeklyPeriod(at) {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { type: 'WEEKLY', start: isoDay(start), end: isoDay(end) };
}

function validRuns(state, type) {
  return rows(state.ai_runs).filter((run) => String(run.run_type || '').toUpperCase() === type && run.valid !== false && !run.error);
}

function dataSources(state, config) {
  const manual = rows(state.evidence).some((item) => String(item.source_type || '').toUpperCase() === 'MANUAL');
  const source = (records, configured) => records ? 'READY' : configured ? 'NO_DATA' : 'NOT_CONFIGURED';
  return [
    { type: 'ENGINE', status: 'READY' },
    { type: 'LAB', status: validRuns(state, 'LAB').length ? 'READY' : 'NO_DATA' },
    { type: 'GOLDEN', status: validRuns(state, 'GOLDEN').length ? 'READY' : 'NO_DATA' },
    { type: 'GA4', status: source(rows(state.analytics).length > 0, !!config.google?.ga4_property_id) },
    { type: 'SEARCH_CONSOLE', status: source(rows(state.search_console).length > 0, !!config.google?.search_console_property) },
    { type: 'MANUAL', status: manual ? 'READY' : 'NO_DATA' },
  ];
}

/**
 * Constrói o snapshot imutável do período. snapshot_id determinístico por
 * (client, period, dia): re-gerar no mesmo dia substitui; dias anteriores
 * ficam intactos.
 */
export function buildSnapshot(state, config, options = {}) {
  const at = options.at ? new Date(options.at) : new Date();
  const period = options.period ?? weeklyPeriod(at);
  const prompts = rows(state.prompts);
  const promptIds = prompts.map((prompt) => prompt.prompt_id).filter(Boolean);
  const previous = rows(state.report_snapshots)
    .filter((snapshot) => snapshot.snapshot_id && snapshot.created_at < at.toISOString())
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  const previousIds = new Set(rows(previous?.prompt_ids));
  const promptDiff = previous ? {
    gained: promptIds.filter((id) => !previousIds.has(id)).length,
    lost: [...previousIds].filter((id) => !promptIds.includes(id)).length,
    stable: promptIds.filter((id) => previousIds.has(id)).length,
  } : { gained: null, lost: null, stable: null };
  const reports = rows(state.reports);
  const baselineReport = reports.find((report) => report.is_baseline || report.report_type === 'BASELINE') ?? reports[0] ?? null;
  const seoIssues = rows(state.seo).flatMap((page) => rows(page.issues));
  const severityCount = (level) => seoIssues.filter((issue) => String(issue.severity || '').toUpperCase() === level).length;
  const openActions = rows(state.actions).filter((action) => !/^(REJECTED|ROLLED_BACK)$/i.test(action.status || ''));
  const implementations = options.report?.implementations ?? openActions
    .filter((action) => (ACTION_RANK[String(action.status).toUpperCase()] ?? -1) >= ACTION_RANK.APPROVED)
    .map((action) => ({
      action_id: action.action_id, title: action.title || action.action_id,
      status: action.status, url: action.deployment?.url ?? null,
    }));
  return {
    snapshot_id: stableId('snap', [config.client_id, period.type, period.start, isoDay(at)]),
    client_id: config.client_id,
    period,
    created_at: at.toISOString(),
    baseline: baselineReport ? { week: baselineReport.week ?? null, generated_at: baselineReport.generated_at ?? null } : null,
    current_metrics: {
      LAB: state.metrics?.LAB ?? {},
      GOLDEN: state.metrics?.GOLDEN ?? {},
    },
    prompts: {
      total: prompts.length,
      money: prompts.filter((prompt) => Number(prompt.commercial_score) >= 4).length,
      ...promptDiff,
    },
    prompt_ids: promptIds,
    competitors: rows(state.competitors).map((competitor) => ({
      name: competitor.name ?? null, domain: competitor.domain ?? null, run_type: competitor.run_type ?? null,
      mentions: numeric(competitor.mentions), recommendations: numeric(competitor.recommendations),
    })),
    sources: rows(state.sources).map((source) => ({
      url: source.url ?? null, domain: source.domain ?? null, run_type: source.run_type ?? null,
      citation_count: numeric(source.citation_count),
    })),
    gaps: rows(state.gaps).map((gap) => ({ gap_id: gap.gap_id, gap_type: gap.gap_type ?? null, description: gap.description ?? null, status: gap.status ?? null })),
    actions: openActions.map((action) => ({ action_id: action.action_id, title: action.title || action.action_id, status: action.status, url: action.deployment?.url ?? null })),
    published_assets: rows(state.pages).filter((page) => String(page.status || '').toUpperCase() === 'PUBLISHED')
      .map((page) => ({ url: page.url ?? null, action_id: page.action_id ?? null, published_at: page.published_at ?? null })),
    seo: { critical: severityCount('CRITICAL'), warnings: severityCount('WARNING'), opportunities: severityCount('OPPORTUNITY') },
    demand: {
      prompts_total: prompts.length,
      clusters: new Set(prompts.map((prompt) => prompt.cluster).filter(Boolean)).size,
    },
    experiments: rows(state.experiments).map((experiment) => ({
      experiment_id: experiment.experiment_id, name: experiment.name ?? null,
      status: experiment.status ?? null, conclusion: experiment.conclusion ?? null,
    })),
    next_actions: openActions
      .filter((action) => ['PROPOSED', 'WAITING_APPROVAL', 'DETECTED', 'OPEN'].includes(String(action.status).toUpperCase()))
      .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0)).slice(0, 5)
      .map((action) => ({ action_id: action.action_id, title: action.title || action.action_id, priority: action.priority ?? null })),
    implementations,
    data_sources: dataSources(state, config),
  };
}

const styles = `
:root{--black:#0a0a0a;--white:#ffffff;--chartreuse:${CHARTREUSE};--ink:#141414;--muted:#6b6b6b;--line:#e4e4e0;--paper:#f7f7f2}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:inherit}a[href]{text-decoration-color:var(--chartreuse);text-decoration-thickness:2px}
.cover{background:var(--black);color:var(--white);padding:72px 56px;min-height:70vh;display:flex;flex-direction:column;justify-content:space-between}
.cover .brandmark{display:flex;align-items:center;gap:18px}
.cover .brandmark img{height:44px;width:auto}
.cover .wordmark{font-size:34px;font-weight:850;letter-spacing:2px;color:var(--chartreuse)}
.cover h1{font-size:44px;letter-spacing:-1.5px;line-height:1.1;margin:48px 0 16px;max-width:640px}
.cover .client{font-size:22px;color:var(--chartreuse);font-weight:700}
.cover .period{color:#b9b9b2;font-size:13px;letter-spacing:1.5px;text-transform:uppercase}
.cover .foot{color:#8d8d86;font-size:11px;letter-spacing:1px}
.page{max-width:860px;margin:0 auto;padding:40px 48px}
h2{font-size:21px;letter-spacing:-.4px;border-left:5px solid var(--chartreuse);padding-left:12px;margin:44px 0 16px}
h2 .num{color:var(--muted);font-weight:500;margin-right:8px}
table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}
th{background:var(--black);color:var(--white);text-align:left;padding:9px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.8px}
td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}
.card{background:var(--white);border:1px solid var(--line);border-top:4px solid var(--chartreuse);padding:14px}
.card .label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.card .value{font-size:24px;font-weight:800;margin-top:6px}
.card .value.pending{font-size:15px;color:var(--muted);font-weight:600}
.badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.6px;padding:3px 8px;border-radius:4px;background:#ececec;color:#444;white-space:nowrap}
.badge.golden{background:var(--chartreuse);color:var(--black)}
.badge.lab{background:#e3e8f0;color:#3d4a5c}
.badge.ok{background:#ddf3d0;color:#2c5b18}.badge.warn{background:#fdeecb;color:#7a5510}.badge.crit{background:#fbdbdb;color:#8f1d1d}
.notice{background:#fff;border:1px dashed #c9c9c0;padding:12px 16px;font-size:11px;color:var(--muted);margin:12px 0}
.section{break-inside:avoid}.cover{break-after:page}
footer{max-width:860px;margin:0 auto;padding:24px 48px 48px;color:var(--muted);font-size:10px;display:flex;justify-content:space-between;border-top:1px solid var(--line)}
@media print{body{background:#fff}.page{padding:24px 0}}
`;

const card = (label, value) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value${value == null ? ' pending' : ''}">${value == null ? 'Pendente' : escapeHtml(value)}</div></div>`;
const section = (num, title, content) => `<section class="section"><h2><span class="num">${String(num).padStart(2, '0')}</span>${escapeHtml(title)}</h2>${content}</section>`;
const empty = (text) => `<div class="notice">${escapeHtml(text)}</div>`;
const link = (url, label) => {
  try { const href = new URL(String(url)); if (['http:', 'https:'].includes(href.protocol)) return `<a href="${escapeHtml(href.href)}">${escapeHtml(label || href.hostname)}</a>`; } catch {}
  return escapeHtml(label || '—');
};
function table(items, columns, emptyText) {
  if (!items.length) return empty(emptyText);
  return `<table><thead><tr>${columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${items.map((item) => `<tr>${columns.map(([, render]) => `<td>${render(item)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const metricBadge = (type) => `<span class="badge ${type === 'GOLDEN' ? 'golden' : 'lab'}">${type}</span>`;

function metricCards(metrics, keys) {
  return `<div class="cards">${keys.map((key) => card(RATE_LABELS[key] ?? key, metrics?.[key] == null ? null : pct(metrics[key]))).join('')}</div>`;
}

/** HTML executivo com identidade CITÁVEL. Todos os números vêm do snapshot. */
export function renderExecutiveHtml(snapshot, config, assets = {}) {
  const golden = snapshot.current_metrics?.GOLDEN ?? {};
  const lab = snapshot.current_metrics?.LAB ?? {};
  const logo = assets.logo ? `<img src="${escapeHtml(assets.logo)}" alt="CITÁVEL">` : '<span class="wordmark">CITÁVEL</span>';
  const rateKeys = ['recommendation_coverage', 'mention_rate', 'citation_rate', 'share_of_voice'];
  const sourcesByType = Object.fromEntries(snapshot.data_sources.map((source) => [source.type, source.status]));
  const sections = [
    section(1, 'Resumo Executivo', `<p>Período ${escapeHtml(snapshot.period.start)} a ${escapeHtml(snapshot.period.end)} (${escapeHtml(snapshot.period.type)}). ${escapeHtml(snapshot.prompts.total)} prompts monitorados, ${escapeHtml(snapshot.actions.length)} ações registradas, ${escapeHtml(snapshot.published_assets.length)} ativos publicados.</p><div class="cards">${card('Prompts monitorados', snapshot.prompts.total)}${card('Prompts comerciais', snapshot.prompts.money)}${card('Ações registradas', snapshot.actions.length)}${card('Ativos publicados', snapshot.published_assets.length)}</div>${snapshot.baseline ? `<p>Baseline: semana ${escapeHtml(snapshot.baseline.week ?? '—')}.</p>` : empty('Baseline ainda não registrado; comparações ficam pendentes.')}`),
    section(2, `Presença e Visibilidade em IA ${metricBadge('GOLDEN')}`, metricCards(golden, rateKeys) + (sourcesByType.GOLDEN !== 'READY' ? empty('GOLDEN aguarda testes reais importados; métricas permanecem pendentes.') : '')),
    section(3, 'Demanda Monitorada', `<div class="cards">${card('Prompts totais', snapshot.prompts.total)}${card('Clusters', snapshot.demand.clusters)}${card('Ganhos no período', snapshot.prompts.gained)}${card('Perdidos no período', snapshot.prompts.lost)}</div>${snapshot.prompts.gained == null ? empty('Sem snapshot anterior: variação de prompts pendente.') : ''}`),
    section(4, 'Fontes e Citações', `<div class="cards">${card('Fontes registradas', snapshot.sources.length)}${card('Citação do site do cliente', golden.owned_citation_rate == null ? null : pct(golden.owned_citation_rate))}${card('Citação de terceiros', golden.third_party_citation_rate == null ? null : pct(golden.third_party_citation_rate))}</div>` + table(snapshot.sources.slice(0, 20), [['Fonte', (row) => row.url ? link(row.url, row.domain || row.url) : escapeHtml(row.domain || '—')], ['Tipo', (row) => metricBadge(row.run_type || 'LAB')], ['Citações', (row) => escapeHtml(fmt(row.citation_count))]], 'Nenhuma fonte registrada no período.')),
    section(5, 'Concorrentes', table(snapshot.competitors.slice(0, 20), [['Concorrente', (row) => escapeHtml(row.name || '—')], ['Domínio', (row) => row.domain ? link(row.domain.includes('://') ? row.domain : 'https://' + row.domain) : escapeHtml('—')], ['Tipo', (row) => metricBadge(row.run_type || 'LAB')], ['Menções', (row) => escapeHtml(fmt(row.mentions))], ['Recomendações', (row) => escapeHtml(fmt(row.recommendations))]], 'Nenhum concorrente observado nas respostas coletadas.')),
    section(6, 'Gaps e Oportunidades', table(snapshot.gaps.slice(0, 20), [['Gap', (row) => escapeHtml(row.gap_id)], ['Tipo', (row) => escapeHtml(row.gap_type || '—')], ['Descrição', (row) => escapeHtml(row.description || '—')], ['Status', (row) => `<span class="badge">${escapeHtml(row.status || 'PENDENTE')}</span>`]], 'Nenhum gap registrado.')),
    section(7, 'Ações e Implementações', table(snapshot.implementations, [['Ação', (row) => escapeHtml(row.title)], ['Status', (row) => `<span class="badge">${escapeHtml(row.status || row.decision || '—')}</span>`], ['URL', (row) => row.url ? link(row.url) : escapeHtml('não publicada')]], 'Nenhuma implementação no período.')),
    section(8, 'Ativos Publicados', table(snapshot.published_assets, [['URL', (row) => row.url ? link(row.url) : escapeHtml('—')], ['Ação', (row) => escapeHtml(row.action_id || '—')], ['Publicado em', (row) => escapeHtml(row.published_at || '—')]], 'Nenhum ativo publicado.')),
    section(9, 'SEO Técnico', `<div class="cards">${card('Problemas críticos', snapshot.seo.critical)}${card('Avisos', snapshot.seo.warnings)}${card('Oportunidades', snapshot.seo.opportunities)}</div>`),
    section(10, 'Experimentos', table(snapshot.experiments, [['Experimento', (row) => escapeHtml(row.name || row.experiment_id)], ['Status', (row) => `<span class="badge">${escapeHtml(row.status || 'PENDENTE')}</span>`], ['Conclusão', (row) => escapeHtml(row.conclusion || 'Ainda não avaliada')]], 'Nenhum experimento registrado.')),
    section(11, 'Próximas Ações', table(snapshot.next_actions, [['Ação', (row) => escapeHtml(row.title)], ['Prioridade', (row) => `<span class="badge">${escapeHtml(row.priority || '—')}</span>`]], 'Sem ação aberta registrada.')),
    section(12, `Análises Internas ${metricBadge('LAB')}`, `<div class="notice">LAB é medido separadamente e nunca combinado com GOLDEN; não representa a experiência dos mecanismos alvo.</div>` + metricCards(lab, rateKeys)),
    section(13, 'Metodologia', `<p>Taxas em proporção 0–1 sobre as execuções válidas registradas. GOLDEN = testes reais importados; LAB = execuções internas de API/modelo local. Este relatório é gerado de um snapshot imutável (${escapeHtml(snapshot.snapshot_id)}) criado em ${escapeHtml(snapshot.created_at)}.</p>` + table(snapshot.data_sources, [['Fonte de dados', (row) => escapeHtml(row.type)], ['Status', (row) => `<span class="badge ${row.status === 'READY' ? 'ok' : row.status === 'NO_DATA' ? 'warn' : 'crit'}">${escapeHtml(row.status)}</span>`]], 'Fontes não declaradas.') + `<div class="notice">Dados ausentes permanecem "Pendente"; nenhum valor é estimado ou inventado.</div>`),
  ];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>CITÁVEL · Relatório Executivo · ${escapeHtml(config.brand || snapshot.client_id)}</title><style>${styles}</style></head><body><div class="cover"><div><div class="brandmark">${logo}</div><h1>Relatório de Presença e Demanda em IA</h1><p class="client">${escapeHtml(config.brand || snapshot.client_id)}</p><p class="period">${escapeHtml(snapshot.period.type)} · ${escapeHtml(snapshot.period.start)} → ${escapeHtml(snapshot.period.end)}</p></div><p class="foot">CITÁVEL · Inteligência que vira presença · snapshot ${escapeHtml(snapshot.snapshot_id)}</p></div><main class="page">${sections.join('')}</main><footer><span>CITÁVEL · Relatório executivo</span><span>Gerado em ${escapeHtml(snapshot.created_at)}</span></footer></body></html>`;
}

/**
 * Copia a identidade CITÁVEL para dentro do cliente (nunca referencia paths
 * fora de clients/<id>/), grava o HTML executivo em reports/private/ e tenta
 * o PDF. Sem renderer, registra PDF_UNAVAILABLE de forma honesta.
 */
export async function writeExecutiveReport(clientId, state, snapshot, options = {}) {
  const reportsDir = path.join(clientDir(clientId), 'reports');
  const privateDir = path.join(reportsDir, 'private');
  const assetsDir = path.join(reportsDir, 'assets');
  const assetsSource = options.assetsDir ?? process.env.CITAVEL_ASSETS ?? path.resolve(ROOT, '..', 'ASSETS');
  const copied = {};
  for (const [source, target, key] of [['LOGO CITAVEL.png', 'logo-citavel.png', 'logo'], ['ICONE CITAVEL.png', 'icone-citavel.png', 'icon']]) {
    try {
      await fs.copyFile(path.join(assetsSource, source), path.join(assetsDir, target));
      copied[key] = 'assets/' + target;
    } catch { copied[key] = null; /* Sem asset, o template usa o wordmark em texto. */ }
  }
  const html = renderExecutiveHtml(snapshot, state.client, copied);
  const htmlPath = path.join(privateDir, snapshot.snapshot_id + '.html');
  await atomicWrite(htmlPath, html);
  await atomicWrite(path.join(privateDir, 'latest.html'), html);
  const pdf = options.renderPdf === false
    ? { status: 'PDF_UNAVAILABLE', note: 'Renderização de PDF não solicitada nesta execução.' }
    : await (options.renderPdfImpl ?? renderPdf)(html, path.join(privateDir, snapshot.snapshot_id + '.pdf'), options.pdfOptions);
  if (pdf.status === 'PDF_RENDERED') await fs.copyFile(pdf.path, path.join(privateDir, 'latest.pdf'));
  snapshot.artifacts = {
    html: 'reports/private/' + snapshot.snapshot_id + '.html',
    pdf: pdf.status === 'PDF_RENDERED' ? 'reports/private/' + snapshot.snapshot_id + '.pdf' : null,
    pdf_status: pdf.status,
    pdf_note: pdf.note ?? null,
  };
  return { snapshot, html_path: htmlPath, pdf };
}

/** Upsert por snapshot_id: mesmo dia substitui, períodos passados intactos. */
export function saveSnapshot(state, snapshot) {
  state.report_snapshots = upsert(rows(state.report_snapshots), [snapshot], 'snapshot_id');
  return snapshot;
}
