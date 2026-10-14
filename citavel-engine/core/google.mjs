/** Google payloads and read-only adapters. OAuth tokens are supplied at runtime only. */
const schema = (key, columns) => Object.freeze({key, columns: Object.freeze(columns.split(' '))});
export const SHEETS_SCHEMA = Object.freeze({
  '00_CLIENT': schema('client', 'client_id brand domain market locations priority_services created_at updated_at'),
  '01_EVIDENCE': schema('evidence', 'evidence_id category entity claim value source_type source_url verified confidence public_allowed created_at updated_at'),
  '02_PAGES': schema('pages', 'page_id url slug title page_type cluster target_prompts status indexable canonical published_at last_checked experiment_id'),
  '03_PROMPTS': schema('prompts', 'prompt_id cluster prompt intent commercial_score priority service location active control_group'),
  '04_AI_RUNS': schema('ai_runs', 'run_id timestamp platform model prompt_id response brand_mentioned brand_recommended approx_position sentiment citations competitors owned_domain_cited run_type'),
  '05_COMPETITORS': schema('competitors', 'competitor_id name domain mentions recommendations citation_count share_of_voice last_seen run_type'),
  '06_SOURCES': schema('sources', 'source_id domain url source_type citation_count prompt_count competitors_present client_present opportunity_score last_seen run_type'),
  '07_GAPS': schema('gaps', 'gap_id prompt_id gap_type description competitor supporting_sources severity confidence status run_type'),
  '08_ACTIONS': schema('actions', 'action_id gap_id type priority title description affected_prompts expected_signal status owner created_at completed_at run_type'),
  '09_EXPERIMENTS': schema('experiments', 'experiment_id name hypothesis intervention_prompts control_prompts actions baseline current_result start_date end_date status conclusion'),
  '10_SEO': schema('seo', 'timestamp url status_code indexable title meta_description canonical h1 word_count schema_types internal_links external_links issues seo_score'),
  '11_SEARCH_CONSOLE': schema('search_console', 'date query page clicks impressions ctr position'),
  '12_ANALYTICS': schema('analytics', 'date source medium landing_page sessions engaged_sessions conversions leads'),
  '13_LEADS': schema('leads', 'lead_id created_at source source_detail ai_platform landing_page self_reported_source status opportunity_value closed_value'),
  '14_WEEKLY_REPORT': schema('reports', 'week recommendation_coverage mention_rate citation_rate share_of_voice ai_sessions ai_leads pipeline actions_completed prompts_gained prompts_lost summary'),
  '15_SYSTEM_LOG': schema('logs', 'timestamp workflow level message payload_reference'),
});

const rows = value => Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const secretKey = /^(?:api_?key|client_?secret|access_?token|refresh_?token|password|authorization|credential(?:s)?|secret)$/i;
function scrubString(value) {
  return value.replace(/\bAIza[\w-]{20,}\b/g, '[REDACTED]')
    .replace(/\bAQ\.[\w-]+/g, '[REDACTED]')
    .replace(/\bGOCSPX-[\w-]+/g, '[REDACTED]')
    .replace(/\bya29\.[\w.-]+/g, '[REDACTED]')
    .replace(/\bBearer\s+[\w.+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:key|api_key|access_token|refresh_token|client_secret)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\u0000/g, '');
}
function scrub(value, seen = new WeakSet()) {
  if (typeof value === 'string') return scrubString(value);
  if (value == null || typeof value === 'boolean') return value ?? '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => scrub(item, seen)) : Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key, item]) => [key, scrub(item, seen)]));
  seen.delete(value);
  return result;
}
/** RAW never executes formulas; this prefix also protects subsequent CSV/Excel imports. */
export function sheetCell(value) {
  const safe = scrub(value);
  const cell = typeof safe === 'object' ? JSON.stringify(safe) : safe;
  if (typeof cell !== 'string') return cell;
  const limited = cell.slice(0, 49000);
  return /^[\s\uFEFF]*[=+@-]/u.test(limited) ? `'${limited}` : limited;
}
function projectedRows(state, config, key) {
  if (key === 'client') return [{...object(state.client), ...object(config)}];
  const records = rows(state[key] ?? (key === 'logs' ? state.system_log : undefined));
  return records.map(row => {
    row = object(row);
    if (key === 'ai_runs') return {...row, owned_domain_cited: row.owned_domain_cited ?? row.owned_site_cited};
    if (key === 'sources') return {...row, prompt_count: row.prompt_count ?? (Array.isArray(row.prompts) ? row.prompts.length : undefined)};
    if (key === 'logs') return {...row, level: row.level || (row.status === 'ERROR' ? 'ERROR' : 'INFO'), message: row.message ?? row.summary};
    if (key !== 'reports') return row;
    const golden = object(row.metrics?.GOLDEN);
    const business = object(row.metrics?.business);
    const analytics = object(row.metrics?.analytics);
    return {...row,
      recommendation_coverage: golden.recommendation_coverage ?? row.recommendation_coverage,
      mention_rate: golden.mention_rate ?? row.mention_rate, citation_rate: golden.citation_rate ?? row.citation_rate,
      share_of_voice: golden.share_of_voice ?? row.share_of_voice,
      ai_sessions: analytics.ai_sessions ?? row.ai_sessions,
      ai_leads: business.ai_sourced_leads ?? row.ai_leads,
      pipeline: business.pipeline ?? row.pipeline,
      summary: row.summary || `GOLDEN: ${golden.run_count ?? 0} execuções. LAB: ${row.metrics?.LAB?.run_count ?? 0} execuções. Métricas de visibilidade desta aba referem-se a GOLDEN.`,
    };
  });
}

/** Full snapshot, one range per tab. Replaces rows from A1; does not append duplicates. */
export function sheetsPayload(state = {}, config = {}) {
  return {valueInputOption: 'RAW', includeValuesInResponse: false,
    data: Object.entries(SHEETS_SCHEMA).map(([tab, {key, columns}]) => ({
      range: `'${tab}'!A1`, majorDimension: 'ROWS',
      values: [[...columns], ...projectedRows(state, config, key).map(row => columns.map(column => sheetCell(row[column])))],
    })),
  };
}
/** Clear dedicated export tabs before snapshot update, so removed records cannot linger. */
export function sheetsClearBody() { return {ranges: Object.keys(SHEETS_SCHEMA).map(tab => `'${tab}'!A:Z`)}; }
export function createSpreadsheetBody(config = {}) {
  const brand = String(config.brand || config.client_id || 'CLIENT').toUpperCase();
  return {properties: {title: scrubString(`CITAVEL — ${brand}`).slice(0, 200), locale: 'pt_BR', timeZone: 'America/Sao_Paulo'},
    sheets: Object.keys(SHEETS_SCHEMA).map((title, sheetId) => ({properties: {title, sheetId, gridProperties: {frozenRowCount: 1, rowCount: 1000, columnCount: 26}}})),
  };
}
export function sheetsCSV(state = {}, config = {}) {
  return Object.fromEntries(sheetsPayload(state, config).data.map(({range, values}) => [range.slice(1, range.indexOf("'!")),
    '\uFEFF' + values.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n']));
}

const AI_HOSTS = Object.freeze({'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'perplexity.ai': 'Perplexity', 'gemini.google.com': 'Gemini', 'copilot.microsoft.com': 'Copilot', 'claude.ai': 'Claude'});
export function referralPlatform(source) {
  if (typeof source !== 'string' || /[\s\\]/u.test(source)) return null;
  try {
    const url = new URL(source.includes('://') ? source : `https://${source}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return Object.entries(AI_HOSTS).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] || null;
  } catch { return null; }
}
export function classifyReferral(source) { return referralPlatform(source) ? 'AI_REFERRAL' : 'OTHER'; }
/** Declaration alone cannot manufacture AI-sourced or AI-assisted commercial evidence. */
export function classifyLead(lead = {}) {
  lead = object(lead);
  if ([lead.referrer, lead.source, lead.source_detail].some(referralPlatform)) return 'AI_SOURCED';
  const report = typeof lead.self_reported_source === 'string' ? lead.self_reported_source.trim() : '';
  const mentionsAI = /\b(chatgpt|perplexity|gemini|copilot|claude|google ai mode|modo ia|intelig[eê]ncia artificial|IA|AI)\b/iu.test(report);
  // Conservative guard: negative or uncertain statements need manual clarification.
  const negative = /\b(n[aã]o|nunca|jamais|sem|not|never|without|didn['’]?t|talvez|maybe|perhaps|n[aã]o sei)\b/iu.test(report);
  if (mentionsAI && !negative) {
    return /\b(ajudou|participou|auxiliou|assist|assisted|apoio|pesquisei|pesquisa|research|comparar|comparei)\b/iu.test(report) ? 'AI_ASSISTED' : 'AI_SOURCED';
  }
  if (lead.ai_assisted === true || lead.ai_assisted === 'true') return 'AI_ASSISTED';
  const declared = String(lead.attribution_class || lead.classification || lead.attribution || '').toUpperCase();
  return declared === 'AI_CORRELATED' || lead.ai_correlated === true ? 'AI_CORRELATED' : 'UNATTRIBUTED';
}

export function integrations(config = {}) {
  const google = object(config.google);
  const status = (required, mode, purpose) => {
    const missing = required.filter(key => !google[key]);
    return {status: missing.length ? 'CONFIG_REQUIRED' : 'CREDENTIAL_REQUIRED', mode,
      missing_config: missing, reason: missing.length ? `${purpose}: informar ${missing.join(', ')} e vincular OAuth.` : `${purpose}: IDs presentes; conectar e testar OAuth com os escopos necessários.`,
      authenticated: false};
  };
  return {
    google_sheets: status(['sheets_spreadsheet_id'], 'WRITE_DEDICATED_SPREADSHEET', 'Google Sheets'),
    search_console: status(['search_console_property'], 'READ_ONLY', 'Search Console'),
    ga4: status(['ga4_property_id'], 'READ_ONLY', 'GA4'),
    gtm: status(['gtm_account_id', 'gtm_container_id'], 'READ_ONLY', 'GTM'),
  };
}

const GOOGLE_HOSTS = new Set(['sheets.googleapis.com', 'analyticsdata.googleapis.com', 'www.googleapis.com', 'tagmanager.googleapis.com', 'searchconsole.googleapis.com']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = (message, code, status) => Object.assign(new Error(message), {code, ...(status ? {status} : {})});
/** No response body/header is exposed in errors. Redirects cannot forward OAuth tokens. */
export async function googleRequest(accessToken, endpoint, {method = 'GET', body, fetchImpl = globalThis.fetch, timeoutMs = 15000, retries = 2, sleep = pause} = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken)) throw fail('Google OAuth credential required', 'CREDENTIAL_REQUIRED');
  let url;
  try { url = new URL(endpoint); } catch { throw fail('Invalid Google endpoint', 'INVALID_ENDPOINT'); }
  if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443') || url.searchParams.has('access_token') || url.searchParams.has('key')) throw fail('Google endpoint not allowed', 'INVALID_ENDPOINT');
  const attempts = Math.min(2, Math.max(0, Number(retries) || 0)) + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url.href, {method, headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(Math.min(30000, Math.max(100, Number(timeoutMs) || 15000))), ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    } catch {
      if (attempt + 1 < attempts) { await sleep(250 * 2 ** attempt); continue; }
      throw fail('Google request failed or timed out', 'NETWORK_ERROR');
    }
    if (response.ok) {
      try { return await response.json(); } catch { throw fail('Google returned invalid JSON', 'INVALID_RESPONSE'); }
    }
    if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
      const retryAfter = Number(response.headers?.get('retry-after'));
      await sleep(Math.min(3000, Math.max(250 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
      continue;
    }
    throw fail(`Google API HTTP ${response.status}`, response.status === 401 || response.status === 403 ? 'CREDENTIAL_REQUIRED' : 'API_ERROR', response.status);
  }
}
const numeric = value => value != null && String(value).trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const numericId = (value, name) => { if (!/^\d+$/.test(String(value || ''))) throw fail(`${name} required (numeric ID)`, 'CONFIG_REQUIRED'); return String(value); };
function dates(startDate = '7daysAgo', endDate = 'yesterday', relative = true) {
  const valid = value => typeof value === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(value) || relative && /^(?:today|yesterday|\d+daysAgo)$/.test(value));
  if (!valid(startDate) || !valid(endDate)) throw fail('Invalid report date range', 'INVALID_DATE');
  return {startDate, endDate};
}
/** Counts keyEvents as conversions; leads remain unknown without an explicit lead event mapping. */
export async function runGA4Report(accessToken, config = {}, options = {}) {
  const property = numericId(config.google?.ga4_property_id, 'ga4_property_id');
  const dateRange = dates(options.startDate, options.endDate);
  const pageSize = 10000, maxPages = Math.min(10, Math.max(1, Number(options.maxPages) || 5));
  const result = [], metadata = [];
  let total = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await googleRequest(accessToken, `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {...options, method: 'POST', body: {
      dateRanges: [dateRange], dimensions: ['date', 'sessionSource', 'sessionMedium', 'landingPagePlusQueryString'].map(name => ({name})),
      metrics: ['sessions', 'engagedSessions', 'keyEvents'].map(name => ({name})), offset: String(page * pageSize), limit: String(pageSize),
      orderBys: ['date', 'sessionSource', 'sessionMedium', 'landingPagePlusQueryString'].map(dimensionName => ({dimension: {dimensionName}})),
    }});
    if (data.metadata) metadata.push(scrub(data.metadata));
    total = numeric(data.rowCount);
    const pageRows = rows(data.rows);
    for (const row of pageRows) {
      const d = rows(row.dimensionValues).map(item => item.value), m = rows(row.metricValues).map(item => numeric(item.value));
      result.push({date: /^\d{8}$/.test(d[0]) ? d[0].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : d[0], source: d[1], medium: d[2], landing_page: d[3], sessions: m[0], engaged_sessions: m[1], conversions: m[2], leads: null, channel: classifyReferral(d[1])});
    }
    if (pageRows.length < pageSize || total !== null && result.length >= total) return {status: 'READY', rows: result, metadata, truncated: false};
  }
  return {status: 'PARTIAL', rows: result, metadata, truncated: true};
}
export async function runSearchConsoleReport(accessToken, config = {}, options = {}) {
  const property = config.google?.search_console_property;
  if (typeof property !== 'string' || !/^(?:sc-domain:[a-zA-Z0-9.-]+|https?:\/\/[^\s]+)$/.test(property)) throw fail('search_console_property required', 'CONFIG_REQUIRED');
  const dateRange = dates(options.startDate, options.endDate, false);
  const pageSize = 25000, maxPages = Math.min(10, Math.max(1, Number(options.maxPages) || 5));
  const result = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await googleRequest(accessToken, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {...options, method: 'POST', body: {...dateRange, dimensions: ['date', 'query', 'page'], rowLimit: pageSize, startRow: page * pageSize, dataState: 'final'}});
    const pageRows = rows(data.rows);
    result.push(...pageRows.map(row => ({date: row.keys?.[0], query: row.keys?.[1], page: row.keys?.[2], clicks: numeric(row.clicks), impressions: numeric(row.impressions), ctr: numeric(row.ctr), position: numeric(row.position)})));
    if (pageRows.length < pageSize) return {status: 'READY', rows: result, truncated: false, limitation: 'Search Analytics returns available top rows; query-level data is not a complete traffic or indexation census.'};
  }
  return {status: 'PARTIAL', rows: result, truncated: true};
}
/** GTM fetches inventory only. There is no create/update/publish operation. */
export async function auditGTM(accessToken, config = {}, options = {}) {
  const account = numericId(config.google?.gtm_account_id, 'gtm_account_id');
  const container = numericId(config.google?.gtm_container_id, 'gtm_container_id');
  const base = `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${account}/containers/${container}`;
  const maxPages = Math.min(10, Math.max(1, Number(options.maxPages) || 5));
  async function list(endpoint, field) {
    const result = []; let pageToken = '';
    for (let page = 0; page < maxPages; page++) {
      const data = await googleRequest(accessToken, endpoint + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''), {...options, method: 'GET', body: undefined});
      result.push(...rows(data[field])); pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return {rows: result, truncated: !!pageToken};
  }
  const workspaces = await list(`${base}/workspaces`, 'workspace');
  const selectedId = config.google?.gtm_workspace_id;
  const workspace = selectedId ? workspaces.rows.find(row => String(row.workspaceId) === String(selectedId)) : workspaces.rows.length === 1 ? workspaces.rows[0] : null;
  if (!workspace) return {status: 'WORKSPACE_REQUIRED', mode: 'READ_ONLY', workspaces: workspaces.rows.map(({workspaceId, name}) => ({workspace_id: workspaceId, name})), truncated: workspaces.truncated};
  const workspaceId = numericId(workspace.workspaceId, 'gtm_workspace_id');
  const inventory = {};
  for (const [resource, field] of [['tags', 'tag'], ['triggers', 'trigger'], ['variables', 'variable']]) {
    const data = await list(`${base}/workspaces/${workspaceId}/${resource}`, field);
    // Parameter values may contain embedded tokens, so exported audit retains inventory metadata only.
    inventory[resource] = {rows: data.rows.map(row => ({id: row[`${field}Id`], name: row.name, type: row.type, paused: row.paused, firing_trigger_ids: row.firingTriggerId, blocking_trigger_ids: row.blockingTriggerId, parameter_count: rows(row.parameter).length})), truncated: data.truncated};
  }
  return {status: Object.values(inventory).some(item => item.truncated) || workspaces.truncated ? 'PARTIAL' : 'READY', mode: 'READ_ONLY', workspace_id: workspaceId, ...inventory};
}
