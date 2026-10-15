// BRAND ASSET RESOLVER: finds a company's logo on its OFFICIAL domain only. Order: schema.org Organization/LocalBusiness
// logo → logo image in the site header → site icon. Nothing is taken from search results. HTML is parsed as text
// (never executed). Returned candidates are still validated by content before being stored.
import { safeFetch, FETCH_LIMITS, type Resolver } from './net';

export type Candidate = { url: string; via: 'JSON_LD' | 'HEADER_IMG' | 'ICON'; score: number };
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(Boolean) ?? null;
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function extractCandidates(html: string, baseUrl: string): { candidates: Candidate[]; names: string[] } {
  const abs = (u: string | null) => { if (!u) return null; try { const x = new URL(decode(u.trim()), baseUrl); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
  const out: Candidate[] = []; const names: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any; try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk);
      const types = ([] as string[]).concat(n['@type'] || []);
      if (types.some(t => /Organization|LocalBusiness|MedicalBusiness|MedicalClinic|Hospital|Corporation|Store|Dentist|Physician/i.test(t))) {
        if (typeof n.name === 'string') names.push(n.name);
        const logo = typeof n.logo === 'string' ? n.logo : n.logo?.url || n.logo?.contentUrl; const u = abs(typeof logo === 'string' ? logo : null);
        if (u) out.push({ url: u, via: 'JSON_LD', score: 100 });
      }
      for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
    };
    walk(data);
  }
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)\s*=\s*["'](?:og:site_name|application-name)["'][^>]*>/gi)) { const c = attr(m[0], 'content'); if (c) names.push(decode(c)); }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]; if (title) names.push(decode(title.replace(/\s+/g, ' ').trim()));
  const headerHtml = html.match(/<(header|nav)\b[\s\S]*?<\/\1>/gi)?.join(' ') || html.slice(0, 20000);
  for (const m of headerHtml.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]; const src = attr(tag, 'src') || attr(tag, 'data-src'); const hint = `${attr(tag, 'class') || ''} ${attr(tag, 'id') || ''} ${attr(tag, 'alt') || ''} ${src || ''}`;
    if (!src || !/logo|brand|marca/i.test(hint) || /^data:/i.test(src)) continue;
    const u = abs(src); if (u) out.push({ url: u, via: 'HEADER_IMG', score: 70 + (/logo/i.test(attr(tag, 'class') || '') ? 5 : 0) });
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase(); if (!/apple-touch-icon|(^|\s)icon($|\s)/.test(rel)) continue;
    const u = abs(attr(m[0], 'href')); if (u && !/\.ico(\?|$)/i.test(u)) out.push({ url: u, via: 'ICON', score: /apple/.test(rel) ? 40 : 30 });
  }
  const seen = new Set<string>();
  return { candidates: out.sort((a, b) => b.score - a.score).filter(c => !seen.has(c.url) && seen.add(c.url)), names };
}

/** Whether the page identifies itself as the expected brand (name tokens present). Used only to warn the reviewer. */
export function identityMatches(brand: string, names: string[]): boolean {
  const tokens = norm(brand).split(' ').filter(t => t.length > 2); if (!tokens.length) return false;
  const hay = names.map(norm).join(' | ');
  return tokens.every(t => hay.includes(t));
}

export type Resolved = { sourceUrl: string; via: Candidate['via']; bytes: Buffer; contentType: string; identityMatch: boolean };
export async function findLogo(domain: string, brandName: string, validate: (b: Buffer) => unknown, resolve?: Resolver): Promise<Resolved | null> {
  const home = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  const page = await safeFetch(home, FETCH_LIMITS.maxHtmlBytes, resolve);
  if (page.status >= 400 || !/html|xml/.test(page.contentType || 'text/html')) return null;
  const { candidates, names } = extractCandidates(page.body.toString('utf8'), page.url);
  for (const c of candidates.slice(0, 6)) {
    try {
      const img = await safeFetch(c.url, FETCH_LIMITS.maxImageBytes, resolve);
      if (img.status !== 200) continue;
      validate(img.body);
      return { sourceUrl: img.url, via: c.via, bytes: img.body, contentType: img.contentType, identityMatch: identityMatches(brandName, names) };
    } catch { /* try the next candidate */ }
  }
  return null;
}
