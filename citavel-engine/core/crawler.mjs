import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { load } from 'cheerio';

const USER_AGENT = 'CITAVELBot/1.0 (bounded client website audit)';
const TRACKING = /^(utm_.+|fbclid|gclid|dclid|msclkid)$/i;
const id = (prefix, ...values) => `${prefix}_${createHash('sha256').update(values.join('\n')).digest('hex').slice(0, 20)}`;
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hostname = (value) => new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
const internal = (url, domain) => hostname(url) === hostname(domain);
const integer = (value, fallback, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback));

/** Normalize identity without collapsing potentially distinct /path and /path/ pages. */
export function normalizeUrl(input, base) {
  try {
    if (typeof input !== 'string' || !input.trim()) return null;
    const url = new URL(input.trim(), base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

/** Fail closed on private, loopback, link-local, multicast, and reserved addresses. */
export function isPublicAddress(address) {
  const value = String(address).replace(/^\[|\]$/g, '').toLowerCase().split('%')[0];
  const family = isIP(value);
  if (family === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Only globally routable unicast; IPv4-mapped and 6to4/Teredo are excluded.
  if (family === 6) {
    const [first, second] = value.split(':').map((part) => parseInt(part || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff &&
      !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8));
  }
  return false;
}

export function assertPublicUrl(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      host === 'localhost' || /\.(?:localhost|local|internal|home|lan)$/.test(host) ||
      !host.includes('.') && !isIP(host) || (isIP(host) && !isPublicAddress(host))) {
    throw new Error('UNSAFE_URL: only public HTTP(S) targets are allowed');
  }
  return parsed;
}

async function networkRequest(url, { timeoutMs, maxBytes }) {
  const deadline = Date.now() + timeoutMs;
  const parsed = assertPublicUrl(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let timeout;
  const dnsTimeout = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs); });
  let addresses;
  try { addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([lookup(host, { all: true, verbatim: true }), dnsTimeout]); }
  finally { clearTimeout(timeout); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('UNSAFE_DNS: target resolves to a non-public address');
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error('REQUEST_TIMEOUT');
  const selected = addresses.find((item) => item.family === 4) ?? addresses[0];
  // Pin the validated result to the connection to prevent a second DNS lookup/rebinding.
  return new Promise((resolve, reject) => {
    const request = (parsed.protocol === 'https:' ? https : http).request(parsed, {
      method: 'GET', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) request.destroy(new Error('BODY_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    const timer = setTimeout(() => request.destroy(new Error('REQUEST_TIMEOUT')), remainingMs);
    request.once('error', reject);
    request.once('close', () => clearTimeout(timer));
    request.end();
  });
}

function header(headers, name) {
  if (headers?.get) return headers.get(name) ?? '';
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(found) ? found.join(', ') : String(found ?? '');
}

export function parseRobots(text, base) {
  const groups = [];
  const sitemaps = [];
  let group = null;
  let directivesStarted = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'sitemap') { const url = normalizeUrl(value, base); if (url) sitemaps.push(url); continue; }
    if (key === 'user-agent') {
      if (!group || directivesStarted) { group = { agents: [], rules: [], crawl_delay: null }; groups.push(group); directivesStarted = false; }
      if (value) group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow', 'crawl-delay'].includes(key)) {
      directivesStarted = true;
      if (key === 'crawl-delay') {
        if (/^\d+(?:\.\d+)?$/.test(value)) group.crawl_delay = Number(value);
      } else if (value) group.rules.push({ path: value, allow: key === 'allow' });
    }
  }
  return { groups, sitemaps: [...new Set(sitemaps)] };
}

function matchingGroups(parsed, agent) {
  const matches = parsed.groups.map((group) => ({ group, specificity: Math.max(-1, ...group.agents.map((name) => name === '*' ? 0 : agent.toLowerCase().includes(name) ? name.length : -1)) }));
  const best = Math.max(-1, ...matches.map(({ specificity }) => specificity));
  return matches.filter(({ specificity }) => specificity === best && best >= 0).map(({ group }) => group);
}

export function robotsAllowed(parsed, url, agent = 'CITAVELBot') {
  if (parsed.unavailable) return null;
  if (parsed.deny_all) return false;
  const target = new URL(url);
  const comparable = (value) => value.replace(/[^\x00-\x7f]/gu, (character) => encodeURIComponent(character)).replace(/%([0-9a-f]{2})/gi, (encoded, hex) => {
    const character = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/.test(character) ? character : encoded.toUpperCase();
  });
  const path = comparable(target.pathname + target.search);
  const rules = matchingGroups(parsed, agent).flatMap((group) => group.rules).filter((rule) => {
    const terminal = rule.path.endsWith('$');
    const plain = comparable(terminal ? rule.path.slice(0, -1) : rule.path);
    const expression = plain.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    try { return new RegExp(`^${expression}${terminal ? '$' : ''}`).test(path); } catch { return false; }
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}

function robotStatus(parsed, url) {
  return { citavel: robotsAllowed(parsed, url), googlebot: robotsAllowed(parsed, url, 'Googlebot'), oai_searchbot: robotsAllowed(parsed, url, 'OAI-SearchBot') };
}

/**
 * PUBLIC CONTENT MAP (V2): deterministic page class from path + title + h1.
 * No AI, no network: same input always yields the same class.
 */
export function classifyPage(page = {}) {
  let path = '';
  try { path = new URL(page.url).pathname.toLowerCase(); } catch { path = ''; }
  const text = `${page.title ?? ''} ${Array.isArray(page.h1) ? page.h1.join(' ') : page.h1 ?? ''}`.toLowerCase();
  const has = (patterns, value) => patterns.some((pattern) => pattern.test(value));
  const home = has([/^\/(?:index(?:\.html?)?)?$/], path);
  if (home) return 'HOME';
  const rules = [
    ['CONTACT', [/\/(contato|contact|fale-conosco|atendimento|orcamento|quote)(\/|\.|$)/], [/\b(contato|contact us|fale conosco)\b/]],
    ['ABOUT', [/\/(sobre|about|quem-somos|empresa|nossa-historia|team|equipe)(\/|\.|$)/], [/\b(sobre n[oó]s|quem somos|about us)\b/]],
    ['LEGAL', [/\/(privacidade|privacy|termos|terms|politica|cookies|lgpd|legal|disclaimer)(\/|\.|$)/], [/\b(pol[ií]tica de privacidade|termos de uso|privacy policy)\b/]],
    ['BLOG', [/\/(blog|artigos|articles|noticias|news|insights|posts?)(\/|\.|$)/, /\/\d{4}\/\d{2}\//], [/\b(blog|artigo|not[ií]cia)\b/]],
    ['CASE', [/\/(cases?|portfolio|portf[oó]lio|clientes|historias-de-sucesso|success-stories)(\/|\.|$)/], [/\b(case de sucesso|estudo de caso|success story)\b/]],
    ['USE_CASE', [/\/(casos-de-uso|use-cases?|aplicacoes|segmentos|industrias|solucoes-para)(\/|\.|$)/], [/\b(casos? de uso|use case)\b/]],
    ['PRODUCT', [/\/(produtos?|products?|catalogo|loja|shop|store|item|planos|pricing|precos)(\/|\.|$)/], [/\b(produto|cat[aá]logo|pre[cç]os?|planos)\b/]],
    ['SERVICE', [/\/(servicos?|services?|solucoes|solutions|consultoria|consulting)(\/|\.|$)/], [/\b(servi[cç]os?|solu[cç][oõ]es|consultoria)\b/]],
    ['FEATURE', [/\/(features?|funcionalidades|recursos|plataforma|platform|como-funciona)(\/|\.|$)/], [/\b(funcionalidades|features?|como funciona)\b/]],
  ];
  for (const [klass, pathPatterns, textPatterns] of rules) {
    if (has(pathPatterns, path) || has(textPatterns, text)) return klass;
  }
  return 'OTHER';
}

/** Pure extraction helper; no scripts, resources, or browser code are executed. */
export function parseHtml(html, url, config = {}, response = {}) {
  const $ = load(html);
  const baseHref = normalizeUrl($('base[href]').first().attr('href') ?? '', url) ?? url;
  const domain = config.domain ?? url;
  const textOf = (selector) => $(selector).map((_i, element) => clean($(element).text())).get().filter(Boolean);
  const canonicalRaw = $('link[rel]').filter((_i, el) => String($(el).attr('rel')).toLowerCase().split(/\s+/).includes('canonical')).map((_i, el) => $(el).attr('href') ?? '').get();
  const links = [...new Set($('a[href]').map((_i, element) => normalizeUrl($(element).attr('href'), baseHref)).get().filter(Boolean))];
  const directives = {};
  $('meta[name]').each((_i, element) => {
    const name = String($(element).attr('name')).toLowerCase();
    if (['robots', 'googlebot', 'oai-searchbot'].includes(name)) directives[name] = [...(directives[name] ?? []), $(element).attr('content') ?? ''];
  });
  let main = $('main').first();
  if (!main.length) main = $('article').first();
  if (!main.length) main = $('body').first();
  const content = main.clone();
  content.find('script,style,noscript,nav,footer,header,aside,form,svg').remove();
  content.find('br').replaceWith('\n');
  content.find('p,div,section,article,li,h1,h2,h3,h4,h5,h6').append('\n');
  const mainText = content.text().split(/\n+/).map(clean).filter(Boolean).join('\n');
  const jsonLd = [];
  const jsonLdErrors = [];
  $('script[type="application/ld+json"]').each((index, element) => {
    try { jsonLd.push(JSON.parse($(element).text())); }
    catch { jsonLdErrors.push({ script_index: index, error: 'INVALID_JSON' }); }
  });
  const schemaTypes = new Set();
  const pendingSchema = [...jsonLd];
  let visited = 0;
  while (pendingSchema.length && visited++ < 5000) {
    const value = pendingSchema.pop();
    if (!value || typeof value !== 'object') continue;
    const types = value['@type'];
    for (const type of Array.isArray(types) ? types : [types]) if (typeof type === 'string') schemaTypes.add(type);
    for (const child of Object.values(value)) if (child && typeof child === 'object') pendingSchema.push(child);
  }
  const xRobots = header(response.headers, 'x-robots-tag');
  let scopedAgent = '*';
  const headerDirectives = [];
  for (const entry of xRobots.split(',')) {
    const scoped = entry.trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (scoped) scopedAgent = scoped[1].toLowerCase();
    if (scopedAgent === '*' || scopedAgent === 'googlebot') headerDirectives.push(scoped ? scoped[2] : entry);
  }
  const indexDirectives = [...(directives.robots ?? []), ...(directives.googlebot ?? []), ...headerDirectives].join(',');
  const altTexts = $('img').map((_i, element) => ({ src: normalizeUrl($(element).attr('src') ?? '', baseHref), alt: $(element).attr('alt') ?? null })).get();
  // Brand-discovery fields (V2). Pure extraction; nothing is fetched or executed.
  const relLinks = (rel) => $('link[rel]').filter((_i, el) => String($(el).attr('rel')).toLowerCase().split(/\s+/).includes(rel)).map((_i, el) => ({ href: normalizeUrl($(el).attr('href') ?? '', baseHref), sizes: $(el).attr('sizes') ?? null, type: $(el).attr('type') ?? null })).get().filter((link) => link.href);
  const styleBlocks = $('style').map((_i, el) => $(el).text()).get().join('\n').slice(0, 200_000);
  const inlineColors = [...new Set($('[style]').map((_i, el) => String($(el).attr('style')).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).get().flat())].slice(0, 60);
  const contactLinks = [...new Set($('a[href]').map((_i, el) => String($(el).attr('href'))).get().filter((href) => /^(?:mailto:|tel:)|(?:wa\.me|api\.whatsapp\.com|whatsapp:\/\/)/i.test(href)))].slice(0, 40);
  const logoCandidates = $('header img, nav img, [class*="logo" i] img, img[class*="logo" i], img[id*="logo" i], img[alt*="logo" i]').map((_i, el) => ({ src: normalizeUrl($(el).attr('src') ?? '', baseHref), alt: $(el).attr('alt') ?? null, width: Number($(el).attr('width')) || null, height: Number($(el).attr('height')) || null })).get().filter((img) => img.src).slice(0, 10);
  const identity = {
    theme_color: $('meta[name="theme-color" i]').first().attr('content')?.trim() || null,
    og_image: normalizeUrl($('meta[property="og:image" i]').first().attr('content') ?? '', baseHref),
    manifest_url: relLinks('manifest')[0]?.href ?? null,
    icon_links: relLinks('icon').concat(relLinks('shortcut'), relLinks('apple-touch-icon')),
    stylesheet_links: relLinks('stylesheet').map((link) => link.href),
    font_links: [...new Set($('link[href]').map((_i, el) => String($(el).attr('href'))).get().filter((href) => /fonts\.(?:googleapis|gstatic)\.com/i.test(href)).map((href) => normalizeUrl(href, baseHref)).filter(Boolean))],
    style_blocks: styleBlocks,
    inline_colors: inlineColors,
    contact_links: contactLinks,
    form_count: $('form').length,
    logo_candidates: logoCandidates,
    footer_links: [...new Set($('footer a[href]').map((_i, el) => normalizeUrl($(el).attr('href'), baseHref)).get().filter(Boolean))].slice(0, 60),
    cta_links: $('a[class*="btn" i], a[class*="button" i], a[class*="cta" i], a[id*="cta" i]').map((_i, el) => ({ text: clean($(el).text()).slice(0, 80), href: normalizeUrl($(el).attr('href') ?? '', baseHref) })).get().filter((link) => link.text && link.href).slice(0, 10),
  };
  const statusCode = response.status ?? response.status_code ?? 200;
  return {
    page_id: id('page', config.client_id ?? '', url), url, status_code: statusCode,
    content_type: header(response.headers, 'content-type') || 'text/html',
    title: textOf('title')[0] ?? '', title_count: $('title').length,
    meta_description: $('meta[name="description" i]').first().attr('content')?.trim() ?? '',
    canonical: canonicalRaw.length ? normalizeUrl(canonicalRaw[0], baseHref) : null, canonical_raw: canonicalRaw,
    robots_meta: Object.entries(directives).map(([name, values]) => `${name}: ${values.join(', ')}`).join('; '),
    robots_directives: directives, x_robots_tag: xRobots, noindex: /\b(?:noindex|none)\b/i.test(indexDirectives),
    h1: textOf('h1'), h2: textOf('h2'), h3: textOf('h3'), main_text: mainText,
    word_count: mainText.match(/[\p{L}\p{N}]+(?:['’’-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
    json_ld: jsonLd, json_ld_errors: jsonLdErrors, schema_types: [...schemaTypes].sort(),
    internal_links: links.filter((link) => internal(link, domain)), external_links: links.filter((link) => !internal(link, domain)),
    image_count: altTexts.length, alt_texts: altTexts, missing_alt_count: altTexts.filter(({ alt }) => alt === null).length,
    last_modified: header(response.headers, 'last-modified') || $('meta[property="article:modified_time"]').attr('content') || null,
    response_time_ms: response.response_time_ms ?? null,
    indexable: statusCode >= 200 && statusCode < 300 && !/\b(?:noindex|none)\b/i.test(indexDirectives),
    identity,
  };
}

export async function crawl(config, options = {}) {
  const domain = normalizeUrl(config?.domain);
  if (!domain) throw new Error('Client domain must be an absolute HTTP(S) URL');
  assertPublicUrl(domain);
  const maxPages = integer(options.maxPages, 8, 1, 50);
  const timeoutMs = integer(options.timeoutMs, 15000, 250, 30000);
  const maxDurationMs = integer(options.maxDurationMs, 120000, 1000, 300000);
  let delayMs = integer(options.delayMs, 300, 0, 60000);
  const maxSitemaps = integer(options.maxSitemaps, 4, 1, 10);
  const maxUrls = integer(options.maxUrls, 300, maxPages, 2000);
  const collectedAt = new Date().toISOString();
  const deadline = Date.now() + maxDurationMs;
  const issues = [];
  let previousRequest = 0;
  const fetchOne = async (target, maxBytes) => {
    assertPublicUrl(target);
    if (!internal(target, domain)) throw new Error('EXTERNAL_TARGET: crawler is limited to the client hostname');
    const pause = Math.max(0, delayMs - (Date.now() - previousRequest));
    if (Date.now() + pause >= deadline) throw new Error('CRAWL_TIME_BUDGET_EXCEEDED');
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    previousRequest = Date.now();
    const budget = Math.min(timeoutMs, deadline - Date.now());
    // A transport override is exclusively for deterministic fixtures. Production uses pinned DNS.
    if (options.fetch) {
      const result = await options.fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(budget), headers: { 'user-agent': USER_AGENT } });
      const body = typeof result.body === 'string' ? result.body : await result.text();
      if (Buffer.byteLength(body) > maxBytes) throw new Error('BODY_TOO_LARGE');
      return { status: result.status, headers: result.headers, body };
    }
    return networkRequest(target, { timeoutMs: budget, maxBytes });
  };
  const fetchRedirects = async (start, maxBytes, policy = null) => {
    let current = start;
    const chain = [];
    const seen = new Set();
    const started = Date.now();
    for (let hop = 0; hop <= 5; hop++) {
      if (seen.has(current)) throw Object.assign(new Error('REDIRECT_LOOP'), { redirect_chain: chain });
      seen.add(current);
      if (policy && robotsAllowed(policy, current) !== true) throw Object.assign(new Error('ROBOTS_BLOCKED_REDIRECT'), { redirect_chain: chain });
      const response = await fetchOne(current, maxBytes);
      if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, url: current, redirect_chain: chain, response_time_ms: Date.now() - started };
      const next = normalizeUrl(header(response.headers, 'location'), current);
      chain.push({ url: current, status_code: response.status, location: next });
      if (!next) return { ...response, url: current, redirect_chain: chain, response_time_ms: Date.now() - started, redirect_error: 'INVALID_REDIRECT_LOCATION' };
      if (!internal(next, domain)) return { ...response, url: current, redirect_chain: chain, response_time_ms: Date.now() - started, redirect_error: 'EXTERNAL_REDIRECT_NOT_FOLLOWED' };
      current = next;
    }
    throw Object.assign(new Error('REDIRECT_LIMIT_EXCEEDED'), { redirect_chain: chain });
  };
  const robotsUrl = new URL('/robots.txt', domain).href;
  let robots = { url: robotsUrl, status_code: null, groups: [], sitemaps: [], collected_at: collectedAt };
  try {
    const response = await fetchRedirects(robotsUrl, 512000);
    robots.status_code = response.status;
    robots.url = response.url;
    robots.redirect_chain = response.redirect_chain;
    if (response.status >= 200 && response.status < 300) Object.assign(robots, parseRobots(response.body, response.url));
    else if (response.status === 401 || response.status === 403) robots.deny_all = true;
    else if (response.status >= 500 || response.status >= 300 && response.status < 400 || response.status === 429) robots.unavailable = true;
    if (response.status !== 200 && response.status !== 404 && response.status !== 410) issues.push({ code: 'ROBOTS_FETCH_STATUS', status_code: response.status, url: robotsUrl });
  } catch (error) {
    robots.unavailable = true;
    robots.error = error.message;
    issues.push({ code: 'ROBOTS_UNAVAILABLE', url: robotsUrl, error: error.message });
  }
  const crawlDelay = Math.max(0, ...matchingGroups(robots, 'CITAVELBot').map((group) => (group.crawl_delay ?? 0) * 1000));
  if (crawlDelay > maxDurationMs) { robots.unavailable = true; issues.push({ code: 'ROBOTS_DELAY_EXCEEDS_BUDGET', delay_ms: crawlDelay }); }
  else delayMs = Math.max(delayMs, crawlDelay);
  robots.agents = robotStatus(robots, domain);
  const sitemaps = [];
  const sitemapQueue = [...new Set([...robots.sitemaps, new URL('/sitemap.xml', domain).href])].slice(0, maxSitemaps);
  const sitemapSeen = new Set();
  const sitemapUrls = new Set();
  while (sitemapQueue.length && sitemaps.length < maxSitemaps && Date.now() < deadline) {
    const url = sitemapQueue.shift();
    if (sitemapSeen.has(url)) continue;
    sitemapSeen.add(url);
    if (!internal(url, domain)) { issues.push({ code: 'EXTERNAL_SITEMAP_SKIPPED', url }); continue; }
    if (robotsAllowed(robots, url) !== true) { sitemaps.push({ url, skipped: 'ROBOTS_NOT_ALLOWED', urls: [] }); continue; }
    try {
      const response = await fetchRedirects(url, 1024000, robots);
      const $ = load(response.body, { xmlMode: true });
      const isIndex = $('sitemapindex').length > 0;
      const isUrlset = $('urlset').length > 0;
      const locations = [...new Set($(isIndex ? 'sitemap > loc' : 'url > loc').map((_i, el) => normalizeUrl($(el).text(), response.url)).get().filter(Boolean))].slice(0, maxUrls);
      const record = { url: response.url, status_code: response.status, type: isIndex ? 'index' : 'urlset', urls: isIndex ? [] : locations, children: isIndex ? locations : [], redirect_chain: response.redirect_chain };
      if (response.status >= 200 && response.status < 300 && !isIndex && !isUrlset) record.error = 'INVALID_SITEMAP_DOCUMENT';
      sitemaps.push(record);
      if (response.status >= 200 && response.status < 300) {
        if (isIndex) sitemapQueue.push(...locations.slice(0, maxSitemaps - sitemaps.length));
        else for (const candidate of locations) {
          if (internal(candidate, domain) && sitemapUrls.size < maxUrls) sitemapUrls.add(candidate);
          else if (!internal(candidate, domain)) issues.push({ code: 'EXTERNAL_SITEMAP_URL', url: candidate, sitemap: url });
        }
      }
    } catch (error) { sitemaps.push({ url, urls: [], error: error.message }); }
  }
  const queue = [{ url: domain, via: 'seed' }, ...[...sitemapUrls].map((url) => ({ url, via: 'sitemap' }))];
  const queued = new Set(queue.map(({ url }) => url));
  const visited = new Set();
  const pages = [];
  let renderedCount = 0;
  const maxRendered = integer(options.maxRendered, 6, 0, 20);
  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const item = queue.shift();
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    const policy = robotStatus(robots, item.url);
    const base = { page_id: id('page', config.client_id, item.url), url: item.url, requested_url: item.url, discovered_by: item.via, in_sitemap: sitemapUrls.has(item.url), robots: policy, collected_at: collectedAt, last_checked: collectedAt };
    if (policy.citavel !== true) {
      pages.push({ ...base, status_code: null, indexable: false, skipped: policy.citavel === false ? 'ROBOTS_BLOCKED' : 'ROBOTS_UNAVAILABLE', internal_links: [], external_links: [] });
      continue;
    }
    try {
      const response = await fetchRedirects(item.url, 2 * 1024 * 1024, robots);
      const type = header(response.headers, 'content-type');
      const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(type) || !type && /^\s*(?:<!doctype\s+html|<html)/i.test(response.body);
      let page = isHtml ? parseHtml(response.body, response.url, config, response) : { url: response.url, status_code: response.status, content_type: type, indexable: false, internal_links: [], external_links: [], response_time_ms: response.response_time_ms };
      // Renderização JS: home sempre (mede identidade visual aplicada) e páginas com pouco texto no HTML estático
      // (sites Next.js/SPA). Produção usa Chromium; fixtures só renderizam com options.renderer explícito.
      const renderAllowed = options.renderer || (!options.fetch && options.render !== false);
      if (isHtml && renderAllowed && renderedCount < maxRendered && response.status >= 200 && response.status < 300 && (item.via === 'seed' || (page.word_count ?? 0) < 60 || !(page.internal_links ?? []).length)) {
        renderedCount++;
        const renderer = options.renderer ?? (await import('./render.mjs')).renderPage;
        const rendered = await renderer(response.url, { timeoutMs: Math.min(30000, Math.max(5000, deadline - Date.now())) }).catch((error) => ({ status: 'RENDER_UNAVAILABLE', note: error.message }));
        if (rendered?.status === 'RENDERED' && internal(rendered.url, domain)) {
          const staticWords = page.word_count ?? 0;
          const renderedPage = parseHtml(rendered.html, response.url, config, response);
          if ((renderedPage.word_count ?? 0) >= staticWords) page = { ...renderedPage, static_word_count: staticWords };
          page.rendered_with = 'chromium';
          page.identity = { ...page.identity, visual: rendered.visual ?? null };
        } else if (rendered) {
          page.render_status = rendered.status;
          if (rendered.status !== 'RENDERED') issues.push({ code: 'RENDER_' + rendered.status, url: response.url, note: rendered.note ?? null });
        }
      }
      page = { ...base, ...page, redirect_chain: response.redirect_chain, redirect_error: response.redirect_error ?? null, robots: robotStatus(robots, response.url), is_html: isHtml };
      page.indexable = page.indexable && page.robots.googlebot === true;
      visited.add(response.url);
      for (const redirect of response.redirect_chain) visited.add(redirect.url);
      const existingPage = pages.find((previous) => previous.url === response.url);
      if (existingPage) {
        existingPage.redirect_aliases = [...(existingPage.redirect_aliases ?? []), { requested_url: item.url, redirect_chain: response.redirect_chain, in_sitemap: base.in_sitemap }];
        continue;
      }
      pages.push(page);
      for (const link of page.internal_links) {
        if (queued.size >= maxUrls) break;
        if (!queued.has(link) && !visited.has(link) && !/\.(?:pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|css|js|woff2?|xml)(?:\?|$)/i.test(link)) {
          queue.push({ url: link, via: 'internal_link' }); queued.add(link);
        }
      }
    } catch (error) { pages.push({ ...base, status_code: null, indexable: false, fetch_error: error.message, redirect_chain: error.redirect_chain ?? [], internal_links: [], external_links: [] }); }
  }
  const limited = queue.length > 0 || Date.now() >= deadline;
  if (limited) issues.push({ code: 'BOUNDED_SAMPLE', remaining_queue: queue.length, note: 'Results describe a sample; unseen pages and links are unknown.' });
  // PUBLIC CONTENT MAP: every sampled page gets a deterministic class.
  const result = { pages: pages.map((page) => ({ page_class: classifyPage(page), ...page })), robots, sitemaps, issues, collected_at: collectedAt, scope: { max_pages: maxPages, sampled_pages: pages.length, discovered_urls: queued.size, bounded_sample: limited, javascript_rendered: renderedCount > 0, rendered_pages: pages.filter((page) => page.rendered_with).length } };
  result.site_status = assessSite(result);
  if (result.site_status.status !== 'OK') issues.push({ code: result.site_status.status, note: result.site_status.note, evidence: result.site_status.evidence });
  return result;
}

// Domínios estacionados/à venda: redirecionam para marketplaces de domínio. Lista conservadora, só hosts conhecidos.
const PARKING_HOSTS = /(^|\.)(forsale\.godaddy\.com|afternic\.com|sedo\.com|sedoparking\.com|dan\.com|hugedomains\.com|parkingcrew\.net|bodis\.com|undeveloped\.com|above\.com|domainmarket\.com|atom\.com|squadhelp\.com)$/i;
/**
 * Avalia se o domínio tem conteúdo público utilizável. Determinístico, sem IA.
 * PARKED_DOMAIN: algum redirect aponta para marketplace de domínios.
 * NO_PUBLIC_CONTENT: nenhuma página HTML 2xx com texto (>= 30 palavras) — site vazio ou só JavaScript.
 */
export function assessSite(crawlResult = {}) {
  const pages = crawlResult.pages ?? [];
  const parked = pages.flatMap((page) => page.redirect_chain ?? []).find((hop) => { try { return PARKING_HOSTS.test(new URL(hop.location).hostname); } catch { return false; } });
  if (parked) return { status: 'PARKED_DOMAIN', note: 'O domínio redireciona para um marketplace de domínios (à venda/estacionado). Confirme o domínio oficial da marca.', evidence: { url: parked.url, location: parked.location } };
  const content = pages.filter((page) => page.status_code >= 200 && page.status_code < 300 && page.is_html !== false && (page.word_count ?? 0) >= 30);
  if (!content.length) return { status: 'NO_PUBLIC_CONTENT', note: 'Nenhuma página HTML acessível com texto público. O site pode estar vazio ou depender de JavaScript; informe mercado/serviços manualmente.', evidence: { sampled_pages: pages.length } };
  return { status: 'OK', note: null, evidence: { content_pages: content.length } };
}

/** Observable issues only. Score is a transparent checklist heuristic, never a ranking forecast. */
export function audit(crawlResult, config = {}) {
  const pages = crawlResult?.pages ?? [];
  const titleCounts = new Map();
  const incoming = new Map();
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const resolvedLinks = new Map(pages.flatMap((page) => [page.requested_url, ...(page.redirect_aliases ?? []).map((alias) => alias.requested_url)].filter(Boolean).map((alias) => [alias, page.url])));
  for (const page of pages) {
    if (page.title) titleCounts.set(clean(page.title).toLowerCase(), (titleCounts.get(clean(page.title).toLowerCase()) ?? 0) + 1);
    for (const rawLink of new Set(page.internal_links ?? [])) {
      const link = resolvedLinks.get(rawLink) ?? rawLink;
      if (link !== page.url) incoming.set(link, (incoming.get(link) ?? 0) + 1);
    }
  }
  return pages.map((page) => {
    const issues = [];
    const add = (code, severity, description, evidence = {}) => issues.push({ code, severity, description, evidence: { url: page.url, ...evidence } });
    if (page === pages[0] && !crawlResult.robots?.unavailable) {
      const sitemaps = crawlResult.sitemaps ?? [];
      if (sitemaps.length && !sitemaps.some((sitemap) => sitemap.status_code === 200 && !sitemap.error && (sitemap.urls?.length || sitemap.children?.length))) add('SITEMAP_NOT_OBSERVED', 'OPPORTUNITY', 'Nenhum sitemap com URLs foi obtido nos endereços amostrados; outros endereços podem existir.', { checked_urls: sitemaps.map((sitemap) => sitemap.url) });
      for (const sitemap of sitemaps.filter((item) => item.error === 'INVALID_SITEMAP_DOCUMENT')) add('SITEMAP_INVALID', 'WARNING', 'O endereço de sitemap retornou conteúdo que não contém urlset nem sitemapindex.', { sitemap: sitemap.url });
    }
    if (page.fetch_error) add('FETCH_ERROR', 'CRITICAL', 'A coleta desta URL falhou; conteúdo e indexabilidade não foram verificados.', { error: page.fetch_error });
    if (page.status_code === 404) add('HTTP_404', 'CRITICAL', 'A URL respondeu HTTP 404.');
    else if (page.status_code >= 500) add('HTTP_5XX', 'CRITICAL', `A URL respondeu HTTP ${page.status_code}.`);
    else if (page.status_code >= 400) add('HTTP_4XX', 'WARNING', `A URL respondeu HTTP ${page.status_code}.`);
    if ((page.redirect_chain ?? []).length > 1) add('REDIRECT_CHAIN', 'WARNING', 'Mais de um redirecionamento observado.', { hops: page.redirect_chain.length });
    if (page.redirect_error) add('REDIRECT_UNRESOLVED', 'WARNING', 'O redirecionamento não foi seguido até uma página interna.', { reason: page.redirect_error });
    if (page.skipped === 'ROBOTS_UNAVAILABLE') add('ROBOTS_UNAVAILABLE', 'WARNING', 'Política robots indisponível; a coleta foi suspensa nesta URL.');
    if (page.robots?.citavel === false) add('CRAWLER_BLOCKED', 'WARNING', 'robots.txt bloqueia CITAVELBot nesta URL.');
    if (page.robots?.googlebot === false) add('GOOGLEBOT_BLOCKED', 'CRITICAL', 'robots.txt bloqueia Googlebot nesta URL.');
    if (page.robots?.oai_searchbot === false) add('OAI_SEARCHBOT_BLOCKED', 'WARNING', 'robots.txt bloqueia OAI-SearchBot nesta URL; permissão de rastreio não garante citação.');
    if (page.is_html !== false && !page.skipped && !page.fetch_error && page.status_code >= 200 && page.status_code < 300) {
      if (!page.title) add('TITLE_MISSING', 'WARNING', 'A página não possui title preenchido.');
      if (page.title && titleCounts.get(clean(page.title).toLowerCase()) > 1) add('TITLE_DUPLICATE', 'WARNING', 'Title repetido em páginas da amostra.');
      if (!page.meta_description) add('META_DESCRIPTION_MISSING', 'OPPORTUNITY', 'Meta description ausente.');
      if (!page.h1?.length) add('H1_MISSING', 'WARNING', 'Nenhum H1 preenchido foi encontrado.');
      if (page.noindex) add('NOINDEX', 'WARNING', 'Diretiva noindex observada; confirmar se é intencional.');
      if (!page.canonical) add(page.canonical_raw?.length ? 'CANONICAL_INVALID' : 'CANONICAL_MISSING', 'WARNING', 'Canonical ausente ou inválido.');
      if ((page.canonical_raw?.length ?? 0) > 1) add('CANONICAL_MULTIPLE', 'WARNING', 'Múltiplas declarações canonical observadas.');
      if (page.canonical && config.domain && !internal(page.canonical, config.domain)) add('CANONICAL_EXTERNAL', 'WARNING', 'Canonical aponta para outro domínio; validar a intenção.', { canonical: page.canonical });
      else if (page.canonical && page.canonical !== page.url) add('CANONICAL_DIFFERENT', 'OPPORTUNITY', 'Canonical aponta para outra URL; validar consolidação pretendida.', { canonical: page.canonical });
      const canonicalTarget = byUrl.get(page.canonical);
      if (canonicalTarget && (canonicalTarget.status_code >= 400 || canonicalTarget.noindex || canonicalTarget.robots?.googlebot === false)) add('CANONICAL_TARGET_UNAVAILABLE', 'CRITICAL', 'O destino canonical amostrado possui erro HTTP ou bloqueio de indexação.', { canonical: page.canonical });
      if (page.word_count < 80) add('THIN_CONTENT', 'OPPORTUNITY', 'Menos de 80 palavras no HTML principal coletado; renderização por JavaScript não foi avaliada.', { word_count: page.word_count });
      if (!page.schema_types?.length) add('SCHEMA_MISSING', 'OPPORTUNITY', 'Nenhum tipo JSON-LD foi extraído; adequação de schema depende do conteúdo.');
      if (page.json_ld_errors?.length) add('SCHEMA_INVALID_JSON', 'WARNING', 'Um ou mais blocos JSON-LD são JSON sintaticamente inválido.', { count: page.json_ld_errors.length });
      if ((page.internal_links ?? []).filter((link) => link !== page.url).length < 2) add('INTERNAL_LINKING_WEAK', 'OPPORTUNITY', 'Menos de dois destinos internos diferentes observados.');
      if (page.missing_alt_count) add('IMAGE_ALT_MISSING', 'OPPORTUNITY', 'Imagens sem atributo alt; verificar contexto e finalidade.', { count: page.missing_alt_count });
      if (page.in_sitemap && page.discovered_by === 'sitemap' && !(incoming.get(page.url) > 0) && page.url !== normalizeUrl(config.domain)) add('ORPHAN_CANDIDATE', 'OPPORTUNITY', 'URL descoberta no sitemap sem links recebidos na amostra; não comprova página órfã no site completo.');
      if (page.in_sitemap && !page.indexable) add('SITEMAP_NONINDEXABLE', 'WARNING', 'URL do sitemap apresenta restrição de indexação observada.');
      if (!page.in_sitemap && crawlResult.sitemaps?.some((sitemap) => sitemap.status_code === 200 && sitemap.urls?.length)) add('NOT_IN_SAMPLED_SITEMAPS', 'OPPORTUNITY', 'URL não encontrada nos sitemaps amostrados; outros sitemaps podem existir.');
    }
    if (page.in_sitemap && page.status_code >= 400) add('SITEMAP_HTTP_ERROR', 'WARNING', 'URL listada no sitemap respondeu com erro HTTP.');
    if (page.in_sitemap && page.redirect_chain?.length) add('SITEMAP_REDIRECT', 'WARNING', 'URL listada no sitemap redirecionou.');
    const weights = { CRITICAL: 25, WARNING: 10, OPPORTUNITY: 3 };
    const measurable = page.status_code != null && !page.skipped && !page.fetch_error;
    const severity = ['CRITICAL', 'WARNING', 'OPPORTUNITY'].find((level) => issues.some((issue) => issue.severity === level)) ?? 'OK';
    return { timestamp: crawlResult.collected_at, url: page.url, status_code: page.status_code ?? null, indexable: measurable ? page.indexable : null, title: page.title ?? '', meta_description: page.meta_description ?? '', canonical: page.canonical ?? null, h1: (page.h1 ?? []).join(' | '), word_count: page.word_count ?? null, schema_types: page.schema_types ?? [], internal_links: page.internal_links?.length ?? 0, external_links: page.external_links?.length ?? 0, issues, severity, seo_score: measurable ? Math.max(0, 100 - issues.reduce((total, issue) => total + weights[issue.severity], 0)) : null, score_method: 'checklist_v1: 100 - 25/CRITICAL - 10/WARNING - 3/OPPORTUNITY; not a ranking metric' };
  });
}

/** Site statements are sourced evidence pending human verification, never approved facts. */
export function extractEvidence(crawlResult, config = {}) {
  const evidence = [];
  const seen = new Set();
  for (const page of crawlResult?.pages ?? []) {
    if (page.status_code < 200 || page.status_code >= 300 || !page.main_text) continue;
    const candidates = [
      { text: page.title, field: 'title' }, { text: page.meta_description, field: 'meta_description' },
      ...(page.h1 ?? []).map((text) => ({ text, field: 'h1' })),
      ...page.main_text.split('\n').filter((line) => line.length >= 35).slice(0, 6).map((text) => ({ text, field: 'main_text_excerpt' })),
    ];
    for (const candidate of candidates) {
      const value = clean(candidate.text).slice(0, 1000);
      if (!value || value.length < 5) continue;
      const key = `${page.url}\n${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ evidence_id: id('evidence', config.client_id ?? '', page.url, value.toLowerCase()), category: 'WEBSITE_STATEMENT', entity: config.brand ?? '', claim: value, value, source_type: 'OWNED_WEBSITE', source_url: page.url, source_field: candidate.field, verified: false, verification_status: 'SOURCE_PRESENT_UNVERIFIED', confidence: null, public_allowed: false, created_at: crawlResult.collected_at, updated_at: crawlResult.collected_at, provenance: { page_id: page.page_id, collected_at: page.collected_at ?? crawlResult.collected_at, source_present: true, independently_verified: false } });
    }
  }
  return evidence;
}

/**
 * Bounded same-site fetch for referenced assets (web manifest, favicon) used
 * by brand discovery. Reuses the SSRF defenses of this module; the robots
 * policy is enforced by the caller's crawl run. `options.fetch` is the
 * fixture-only transport override, same convention as crawl().
 */
export async function fetchPublic(url, options = {}) {
  const target = normalizeUrl(url);
  if (!target) throw new Error('INVALID_URL');
  assertPublicUrl(target);
  if (options.domain && !internal(target, options.domain)) throw new Error('EXTERNAL_TARGET: fetch is limited to the client hostname');
  const timeoutMs = integer(options.timeoutMs, 15000, 250, 30000);
  const maxBytes = integer(options.maxBytes, 1024000, 1024, 4 * 1024 * 1024);
  if (options.fetch) {
    const result = await options.fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const body = typeof result.body === 'string' ? result.body : await result.text();
    if (Buffer.byteLength(body) > maxBytes) throw new Error('BODY_TOO_LARGE');
    return { status: result.status, headers: result.headers ?? {}, body, url: target };
  }
  return { ...(await networkRequest(target, { timeoutMs, maxBytes })), url: target };
}
