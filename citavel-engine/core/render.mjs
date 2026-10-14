import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress, assertPublicUrl } from './crawler.mjs';
import { redactError } from './store.mjs';

/**
 * Renderização com Chromium (playwright-core) para sites que montam o conteúdo via JavaScript
 * (Next.js client components, SPAs). Mesma postura de segurança do crawler: toda requisição do
 * navegador passa por um filtro que só permite HTTP(S) para hosts que resolvem a endereços públicos.
 * Sem Chromium disponível → {status:'RENDER_UNAVAILABLE'} honesto; o crawl segue com o HTML estático.
 */
const dnsCache = new Map();
async function publicHost(url) {
  try {
    const parsed = assertPublicUrl(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return isPublicAddress(host);
    if (!dnsCache.has(host)) dnsCache.set(host, lookup(host, { all: true, verbatim: true }).then((list) => list.length > 0 && list.every(({ address }) => isPublicAddress(address))).catch(() => false));
    return await dnsCache.get(host);
  } catch { return false; }
}

let browserPromise = null;
async function browser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core');
      const executablePath = process.env.CHROMIUM_PATH || null;
      return chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : { channel: 'chrome' });
    })().catch((error) => { browserPromise = null; throw error; });
  }
  return browserPromise;
}
export async function closeRenderer() { if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close().catch(() => {}); } }

// Executado dentro da página: mede a identidade visual efetivamente aplicada (estilos computados).
function measureVisualIdentity() {
  const toHex = (value) => {
    const m = String(value).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!m) return null;
    let alpha = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha < 0.5) return null;
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  };
  const weights = new Map();
  const add = (hex, kind, weight) => { if (!hex || !weight) return; const key = hex + '|' + kind; weights.set(key, (weights.get(key) || 0) + weight); };
  const vw = window.innerWidth, vh = Math.max(window.innerHeight, document.documentElement.scrollHeight);
  let scanned = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (scanned++ > 4000) break;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue;
    const area = Math.min(r.width * r.height, vw * 1200);
    add(toHex(cs.backgroundColor), 'background', area);
    for (const c of (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || [])) add(toHex(c), 'gradient', area / 4);
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
    if (ownText) add(toHex(cs.color), /^(A|BUTTON)$/.test(el.tagName) ? 'interactive' : /^H[1-3]$/.test(el.tagName) ? 'heading' : 'text', ownText.length * parseFloat(cs.fontSize || 16));
    if (/^(A|BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'button') add(toHex(cs.backgroundColor), 'interactive', area);
    if (parseFloat(cs.borderTopWidth) > 0) add(toHex(cs.borderTopColor), 'border', r.width);
    if (el.tagName === 'svg' || el.closest('svg')) { add(toHex(cs.fill), 'graphic', area / 2); add(toHex(cs.stroke), 'graphic', area / 4); }
  }
  const colors = [...weights.entries()].map(([key, weight]) => { const [hex, kind] = key.split('|'); return { hex, kind, weight: Math.round(weight) }; }).sort((a, b) => b.weight - a.weight).slice(0, 40);
  const fontOf = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : null; };
  const body = getComputedStyle(document.body);
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  return {
    body_background: toHex(body.backgroundColor) || toHex(htmlBg),
    body_text: toHex(body.color),
    fonts: { body: body.fontFamily, h1: fontOf('h1'), h2: fontOf('h2'), button: fontOf('button, a[class*="btn" i], a[class*="button" i]') },
    colors,
    viewport: { width: vw, height: window.innerHeight },
  };
}

/** Renderiza uma URL pública. options: {timeoutMs, screenshotPath, settleMs}. */
export async function renderPage(url, options = {}) {
  if (!(await publicHost(url))) return { status: 'RENDER_BLOCKED', note: 'URL não pública.' };
  let context = null;
  try {
    const b = await browser();
    context = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (compatible; CITAVELBot/1.0; +bounded client website audit) Chrome', javaScriptEnabled: true, serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (!/^https?:/i.test(req.url()) || ['media', 'websocket', 'eventsource'].includes(req.resourceType())) return route.abort();
      return (await publicHost(req.url())) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const timeout = options.timeoutMs ?? 30000;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) }).catch(() => {});
    // Preloaders/animações: espera o texto estabilizar.
    let last = -1;
    for (let i = 0; i < 8; i++) { const len = await page.evaluate(() => document.body?.innerText.length || 0); if (len === last && len > 0) break; last = len; await page.waitForTimeout(options.settleMs ?? 800); }
    // Rola a página para disparar conteúdo lazy (IntersectionObserver).
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); }).catch(() => {});
    await page.waitForTimeout(600);
    const finalUrl = page.url();
    if (!(await publicHost(finalUrl))) return { status: 'RENDER_BLOCKED', note: 'Redirecionamento para destino não público.' };
    const html = await page.content();
    const visual = await page.evaluate(measureVisualIdentity).catch((error) => ({ error: redactError(error) }));
    if (options.screenshotPath) await page.screenshot({ path: options.screenshotPath, fullPage: false }).catch(() => {});
    return { status: 'RENDERED', url: finalUrl, status_code: response?.status() ?? 200, html, visual };
  } catch (error) {
    return { status: 'RENDER_UNAVAILABLE', note: redactError(error) };
  } finally {
    await context?.close().catch(() => {});
  }
}
