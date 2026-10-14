import { crawl, fetchPublic } from './crawler.mjs';

/**
 * Brand & Identity Discovery (V2). Contract: docs/v2-cleanroom-report.md §1.
 * Everything extracted carries source_url / source_type / collected_at /
 * confidence. Absence becomes NOT_FOUND (null/[]), never an invented value.
 * No AI: deterministic extraction over the crawler's parsed pages.
 */
export const IDENTITY_STATUSES = Object.freeze(['AUTO_DISCOVERED', 'VERIFIED_BRAND_IDENTITY', 'IDENTITY_REJECTED', 'INCOMPLETE']);

const SOCIAL_PLATFORMS = {
  'linkedin.com': 'linkedin', 'instagram.com': 'instagram', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
  'facebook.com': 'facebook', 'fb.com': 'facebook', 'x.com': 'x', 'twitter.com': 'x', 'tiktok.com': 'tiktok',
};
const CONFIDENCE = {
  organization_jsonld: 0.95, header: 0.8, manifest: 0.7, favicon: 0.4, og_image: 0.3,
  theme_color: 0.8, css_variable: 0.85, inline_style: 0.4, stylesheet: 0.6,
  google_fonts: 0.8, font_face: 0.7,
};
const PALETTE_ROLES = ['primary', 'secondary', 'accent', 'background', 'surface', 'text_primary', 'text_secondary'];
const CORRECTABLE_FIELDS = Object.freeze(['brand_name', 'official_domain', 'tagline', 'description', 'alternate_names', 'logos', 'favicon', 'palette', 'fonts', 'social_profiles', 'contact', 'products_services', 'claims', 'cta']);

const now = () => new Date().toISOString();
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const hostOf = (value) => { try { return new URL(value).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
const mimeOf = (url) => /\.png(?:\?|$)/i.test(url) ? 'image/png' : /\.jpe?g(?:\?|$)/i.test(url) ? 'image/jpeg' : /\.svg(?:\?|$)/i.test(url) ? 'image/svg+xml' : /\.webp(?:\?|$)/i.test(url) ? 'image/webp' : /\.ico(?:\?|$)/i.test(url) ? 'image/x-icon' : null;

function normalizeHex(value) {
  const match = String(value ?? '').trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('');
  return '#' + hex.slice(0, 6);
}

/** Walks JSON-LD graphs looking for Organization (or LocalBusiness) nodes. */
function organizationNodes(pages) {
  const nodes = [];
  for (const page of pages) {
    const pending = [...(page.json_ld ?? [])];
    const seen = new Set();
    let visited = 0;
    while (pending.length && visited++ < 2000) {
      const node = pending.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (types.some((type) => typeof type === 'string' && /^(Organization|LocalBusiness|Corporation|Brand|Store|Restaurant|MedicalBusiness|LegalService|ProfessionalService)$/i.test(type))) {
        nodes.push({ node, page_url: page.url });
      }
      for (const child of Object.values(node)) if (child && typeof child === 'object') pending.push(child);
    }
  }
  return nodes;
}

function logoFromJsonLd(orgs) {
  for (const { node, page_url } of orgs) {
    const logo = node.logo;
    const url = typeof logo === 'string' ? logo : logo && typeof logo === 'object' ? logo.url ?? logo.contentUrl : null;
    if (url && /^https?:\/\//.test(url)) {
      return { asset_url: url, type: 'organization_jsonld', width: Number(logo?.width) || null, height: Number(logo?.height) || null, mime_type: mimeOf(url), source_page: page_url, confidence: CONFIDENCE.organization_jsonld };
    }
  }
  return null;
}

// Variáveis da paleta padrão do Tailwind/frameworks (ex.: --color-red-500) não são cores da marca.
const FRAMEWORK_VAR = /^(?:tw-|color-)?(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone|black|white)(?:-\d{2,3})?$/i;
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function hsl(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s: sat, l };
}
const distance = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return Math.sqrt(x.reduce((sum, v, i) => sum + (v - y[i]) ** 2, 0)); };
const isChromatic = (hex) => { const { s, l } = hsl(hex); return s >= 0.35 && l >= 0.12 && l <= 0.88; };

function extractPalette(home, extraCss) {
  const palette = [];
  const push = (role, hex, source, confidence, extra = {}) => {
    hex = normalizeHex(hex);
    if (!hex || !role || palette.some((entry) => entry.role === role) || palette.some((entry) => distance(entry.hex, hex) < 18)) return false;
    palette.push({ role, hex, source, confidence, ...extra });
    return true;
  };
  const visual = home?.identity?.visual;
  const colors = Array.isArray(visual?.colors) ? visual.colors : [];
  // 1) Estilos computados da página renderizada: o que o visitante efetivamente vê.
  if (visual?.body_background) push('background', visual.body_background, 'computed_style', 0.9);
  if (visual?.body_text) push('text_primary', visual.body_text, 'computed_style', 0.85);
  // 2) theme-color declarado pela marca.
  const themeColor = normalizeHex(home?.identity?.theme_color ?? '');
  if (themeColor) push('primary', themeColor, 'theme_color', CONFIDENCE.theme_color);
  // 3) Cores cromáticas mais presentes (botões, títulos, gradientes e gráficos pesam mais).
  const boost = { interactive: 3, heading: 2.5, gradient: 2, graphic: 2, border: 1, background: 1, text: 1 };
  const chromatic = new Map();
  for (const c of colors) if (c.hex && isChromatic(c.hex)) chromatic.set(c.hex, (chromatic.get(c.hex) ?? 0) + c.weight * (boost[c.kind] ?? 1));
  const ranked = [...chromatic.entries()].sort((x, y) => y[1] - x[1]).map(([hex]) => hex);
  for (const hex of ranked) for (const role of ['primary', 'accent', 'secondary']) if (push(role, hex, 'computed_style', 0.8)) break;
  // 4) Superfície e texto secundário: neutros mais presentes, distintos do fundo/texto.
  const neutralsBy = (kinds) => colors.filter((c) => kinds.includes(c.kind) && !isChromatic(c.hex)).sort((x, y) => y.weight - x.weight).map((c) => c.hex);
  for (const hex of neutralsBy(['background'])) if (push('surface', hex, 'computed_style', 0.7)) break;
  for (const hex of neutralsBy(['text'])) if (push('text_secondary', hex, 'computed_style', 0.7)) break;
  // 5) Variáveis CSS semânticas (nunca a paleta padrão do framework).
  const roleFor = (name) => {
    const n = name.toLowerCase();
    if (FRAMEWORK_VAR.test(n)) return null;
    if (/primary|brand|main/.test(n)) return 'primary';
    if (/secondary/.test(n)) return 'secondary';
    if (/accent|highlight/.test(n)) return 'accent';
    if (/background|^bg/.test(n)) return 'background';
    if (/surface|card/.test(n)) return 'surface';
    if (/muted|secondary-?text|subtle/.test(n)) return 'text_secondary';
    if (/text|foreground|^fg/.test(n)) return 'text_primary';
    return null;
  };
  const cssTexts = [
    { css: home?.identity?.style_blocks ?? '', source: 'css_variable' },
    ...extraCss.map((entry) => ({ css: entry.css, source: 'stylesheet' })),
  ];
  for (const { css, source } of cssTexts) {
    for (const match of css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
      push(roleFor(match[1]), match[2], source, source === 'css_variable' ? CONFIDENCE.css_variable : CONFIDENCE.stylesheet, { variable: '--' + match[1] });
    }
  }
  // 6) Cores inline como último recurso.
  for (const raw of home?.identity?.inline_colors ?? []) {
    const hex = normalizeHex(raw);
    if (hex && isChromatic(hex)) push(['primary', 'secondary', 'accent'].find((role) => !palette.some((entry) => entry.role === role)), hex, 'inline_style', CONFIDENCE.inline_style);
  }
  return PALETTE_ROLES.map((role) => palette.find((entry) => entry.role === role)).filter(Boolean);
}

const GENERIC_FONT = /^(?:inherit|initial|unset|revert|system-ui|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|cursive|fantasy|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|arial|helvetica|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji)$/i;
function fontName(raw) {
  const name = clean(String(raw ?? '').split(',')[0]).replace(/^['"]|['"]$/g, '').replace(/^__(.+?)_[0-9a-f]{4,}$/i, '$1').replace(/_/g, ' ');
  if (!name || /^var\(/i.test(name) || /fallback$/i.test(name) || GENERIC_FONT.test(name) || name.length > 60) return null;
  return name;
}

function extractFonts(home, extraCss) {
  const fonts = [];
  const seen = new Set();
  const push = (family, source, confidence, usage) => {
    const name = fontName(family);
    if (!name) return;
    const existing = fonts.find((font) => font.family.toLowerCase() === name.toLowerCase());
    if (existing) { if (usage && !existing.usage?.includes(usage)) existing.usage = [...(existing.usage ?? []), usage]; return; }
    seen.add(name.toLowerCase());
    fonts.push({ family: name, source, confidence, ...(usage ? { usage: [usage] } : {}) });
  };
  // Fontes efetivamente aplicadas (estilo computado) primeiro.
  const applied = home?.identity?.visual?.fonts ?? {};
  if (applied.h1) push(applied.h1, 'computed_style', 0.9, 'heading');
  if (applied.h2) push(applied.h2, 'computed_style', 0.85, 'heading');
  if (applied.body) push(applied.body, 'computed_style', 0.9, 'body');
  if (applied.button) push(applied.button, 'computed_style', 0.8, 'interface');
  for (const href of home?.identity?.font_links ?? []) {
    try {
      for (const family of new URL(href).searchParams.getAll('family')) {
        push(family.split(':')[0].replace(/\+/g, ' '), 'google_fonts', CONFIDENCE.google_fonts);
      }
    } catch { /* font_links are pre-normalized; malformed entries are ignored */ }
  }
  const css = [home?.identity?.style_blocks ?? '', ...extraCss.map((entry) => entry.css)].join('\n');
  for (const match of css.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*([^;}]+)/gi)) push(match[1], 'font_face', CONFIDENCE.font_face);
  for (const match of css.matchAll(/(?:^|[{;]\s*)font-family\s*:\s*([^;}]+)/gi)) push(match[1], 'stylesheet', CONFIDENCE.stylesheet);
  return fonts.slice(0, 8);
}

function extractSocial(pages) {
  const profiles = new Map();
  for (const page of pages) {
    const footerLinks = new Set(page.identity?.footer_links ?? []);
    for (const link of page.external_links ?? []) {
      const host = hostOf(link);
      const platform = Object.entries(SOCIAL_PLATFORMS).find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1];
      if (!platform || profiles.has(platform)) continue;
      // Confidence menor quando o único lugar onde o link aparece é o footer.
      const onlyFooter = footerLinks.has(link) && !(page.internal_links ?? []).includes(link);
      profiles.set(platform, { platform, url: link, confidence: onlyFooter ? 0.6 : page.page_class === 'HOME' ? 0.9 : 0.75 });
    }
  }
  return [...profiles.values()];
}

function extractContact(pages) {
  const whatsapp = [];
  const emails = [];
  const forms = [];
  const seen = new Set();
  for (const page of pages) {
    for (const href of page.identity?.contact_links ?? []) {
      const wa = href.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?.*phone=|whatsapp:\/\/send\?.*phone=)(\d{8,15})/i);
      if (wa && !seen.has('wa:' + wa[1])) { seen.add('wa:' + wa[1]); whatsapp.push({ number: wa[1], source_url: page.url }); }
      const mail = href.match(/^mailto:([^?\s]+)$/i);
      if (mail && !seen.has('mail:' + mail[1])) { seen.add('mail:' + mail[1]); emails.push({ address: mail[1], source_url: page.url }); }
    }
    if ((page.identity?.form_count ?? 0) > 0) forms.push({ page_url: page.url, confidence: 0.5 });
  }
  return { whatsapp: whatsapp.slice(0, 10), emails: emails.slice(0, 10), forms: forms.slice(0, 10) };
}

/** Pure, testable extraction over an existing crawl result. */
export function extractIdentity(crawlResult, config = {}, extras = {}) {
  const pages = (crawlResult?.pages ?? []).filter((page) => page.status_code >= 200 && page.status_code < 300 && page.is_html !== false);
  const collectedAt = crawlResult?.collected_at ?? now();
  const home = pages.find((page) => page.page_class === 'HOME') ?? pages[0] ?? null;
  const orgs = organizationNodes(pages);
  const org = orgs[0] ?? null;
  const sourceType = 'OWNED_WEBSITE';

  const logos = [];
  const jsonLdLogo = logoFromJsonLd(orgs);
  if (jsonLdLogo) logos.push(jsonLdLogo);
  const headerLogo = home?.identity?.logo_candidates?.[0];
  if (headerLogo && headerLogo.src !== jsonLdLogo?.asset_url) {
    logos.push({ asset_url: headerLogo.src, type: 'header', width: headerLogo.width, height: headerLogo.height, mime_type: mimeOf(headerLogo.src), source_page: home.url, confidence: CONFIDENCE.header });
  }
  for (const icon of extras.manifest_icons ?? []) {
    if (icon.src && !logos.some((logo) => logo.asset_url === icon.src)) {
      logos.push({ asset_url: icon.src, type: 'manifest', width: Number(icon.sizes?.split('x')[0]) || null, height: Number(icon.sizes?.split('x')[1]) || null, mime_type: icon.type ?? mimeOf(icon.src), source_page: extras.manifest_url ?? home?.url ?? null, confidence: CONFIDENCE.manifest });
    }
  }
  const iconLinks = [...new Map(pages.flatMap((page) => (page.identity?.icon_links ?? []).map((icon) => [icon.href, { icon, page }]))).values()];
  const favicon = iconLinks.length ? { asset_url: iconLinks[0].icon.href, source_page: iconLinks[0].page.url, confidence: 0.6 } : null;
  for (const { icon, page } of iconLinks) {
    if (!logos.some((logo) => logo.asset_url === icon.href)) logos.push({ asset_url: icon.href, type: 'favicon', width: Number(icon.sizes?.split('x')[0]) || null, height: Number(icon.sizes?.split('x')[1]) || null, mime_type: icon.type ?? mimeOf(icon.href), source_page: page.url, confidence: CONFIDENCE.favicon });
  }
  const ogImage = home?.identity?.og_image;
  if (ogImage && !logos.some((logo) => logo.asset_url === ogImage)) {
    logos.push({ asset_url: ogImage, type: 'og_image', mime_type: mimeOf(ogImage), source_page: home.url, confidence: CONFIDENCE.og_image });
  }

  const palette = extractPalette(home, extras.stylesheets ?? []);
  const fonts = extractFonts(home, extras.stylesheets ?? []);
  const social = extractSocial(pages);
  const contact = extractContact(pages);

  const alternateNames = [];
  for (const { node, page_url } of orgs) {
    for (const name of Array.isArray(node.alternateName) ? node.alternateName : [node.alternateName]) {
      if (typeof name === 'string' && clean(name)) alternateNames.push({ name: clean(name), source_url: page_url, confidence: 0.7 });
    }
    if (typeof node.name === 'string' && clean(node.name) && clean(node.name).toLowerCase() !== clean(config.brand ?? '').toLowerCase()) {
      alternateNames.push({ name: clean(node.name), source_url: page_url, confidence: 0.5 });
    }
  }
  const orgDescription = org && typeof org.node.description === 'string' ? clean(org.node.description) : null;
  const description = orgDescription
    ? { text: orgDescription, source_url: org.page_url, confidence: 0.8 }
    : home?.meta_description ? { text: home.meta_description, source_url: home.url, confidence: 0.6 } : null;
  const tagline = orgs.map(({ node }) => node.slogan).find((value) => typeof value === 'string' && clean(value)) ?? null;

  const productPages = pages.filter((page) => ['PRODUCT', 'SERVICE'].includes(page.page_class));
  const productsServices = productPages.slice(0, 10).map((page) => ({ name: clean(page.h1?.[0] ?? page.title ?? page.url), source_url: page.url, confidence: 0.6 }));
  const claims = [home, ...productPages].filter(Boolean).slice(0, 8)
    .map((page) => clean(page.h1?.[0] ?? ''))
    .filter((text) => text.length >= 8)
    .map((text, index) => ({ text, source_url: [home, ...productPages][index].url, first_party: true, confidence: 0.5 }));
  const cta = pages.flatMap((page) => (page.identity?.cta_links ?? []).map((link) => ({ text: link.text, href: link.href, source_url: page.url }))).slice(0, 10);

  const missing = [];
  if (!logos.length) missing.push('logos');
  if (!description) missing.push('description');
  if (!palette.length) missing.push('palette');
  if (!social.length) missing.push('social_profiles');

  return {
    status: missing.some((field) => ['logos', 'description', 'palette'].includes(field)) ? 'INCOMPLETE' : 'AUTO_DISCOVERED',
    brand_name: config.brand ?? '',
    official_domain: config.domain ?? '',
    alternate_names: alternateNames.slice(0, 10),
    tagline: tagline ? clean(tagline) : null,
    description,
    logos,
    favicon,
    palette,
    fonts,
    social_profiles: social,
    contact,
    products_services: productsServices,
    claims,
    cta,
    not_found: missing,
    site_status: crawlResult.site_status ?? null,
    collected_at: collectedAt,
    sources: pages.map((page) => page.url),
    provenance: { source_type: sourceType, collector: 'brand-discovery.v1', collected_at: collectedAt, ai_used: false },
  };
}

/**
 * Runs DISCOVER: bounded crawl via the shared crawler fetcher (SSRF/robots
 * defenses included), then manifest/stylesheet fetches only when referenced.
 * `options.fetch` is the fixture-only transport override.
 */
export async function discoverIdentity(config, options = {}) {
  const crawlResult = options.crawlResult ?? await crawl(config, {
    maxPages: Math.min(12, Math.max(1, options.maxPages ?? 5)),
    timeoutMs: 15000, delayMs: 300, fetch: options.fetch,
  });
  const extras = { stylesheets: [] };
  const pages = crawlResult.pages ?? [];
  const home = pages.find((page) => page.page_class === 'HOME' && page.identity) ?? pages.find((page) => page.identity) ?? null;
  if (home?.identity?.manifest_url) {
    try {
      const response = await fetchPublic(home.identity.manifest_url, { domain: config.domain, fetch: options.fetch, maxBytes: 512000 });
      if (response.status >= 200 && response.status < 300) {
        const manifest = JSON.parse(response.body);
        extras.manifest_url = response.url;
        extras.manifest_icons = (Array.isArray(manifest.icons) ? manifest.icons : [])
          .map((icon) => ({ ...icon, src: icon.src ? new URL(icon.src, response.url).href : null }))
          .filter((icon) => icon.src && hostOf(icon.src) === hostOf(config.domain));
      }
    } catch { /* Manifest ausente/inválido é NOT_FOUND honesto, nunca erro fatal. */ }
  }
  // CSS variables may live in same-domain stylesheets; bounded to 2 fetches.
  const hasVars = /--[a-zA-Z0-9-]+\s*:\s*#[0-9a-fA-F]{3,8}\b/.test(home?.identity?.style_blocks ?? '');
  if (!hasVars) {
    for (const href of (home?.identity?.stylesheet_links ?? []).filter((link) => hostOf(link) === hostOf(config.domain)).slice(0, 2)) {
      try {
        const response = await fetchPublic(href, { domain: config.domain, fetch: options.fetch, maxBytes: 1024000 });
        if (response.status >= 200 && response.status < 300) extras.stylesheets.push({ url: response.url, css: response.body });
      } catch { /* Stylesheet inacessível: paleta segue com as demais fontes ou vazia. */ }
    }
  }
  return { identity: extractIdentity(crawlResult, config, extras), crawl: crawlResult };
}

/**
 * Applies a human decision to state.brand_identity. CONFIRM applies manual
 * corrections (whitelisted fields) with corrected_by/at; REJECT marks the
 * identity as rejected. Idempotent: confirming an already-verified identity
 * only reapplies corrections.
 */
export function confirmIdentity(state, { actor, corrections, decision } = {}) {
  const identity = state.brand_identity;
  if (!identity) throw new Error('IDENTITY_NOT_FOUND');
  if (!clean(actor)) throw new Error('ACTOR_REQUIRED');
  const call = String(decision ?? 'CONFIRM').toUpperCase();
  if (!['CONFIRM', 'REJECT'].includes(call)) throw new Error('DECISION_INVALID');
  if (call === 'REJECT') {
    identity.status = 'IDENTITY_REJECTED';
    identity.rejected_by = actor;
    identity.rejected_at = now();
    return identity;
  }
  if (corrections && typeof corrections === 'object' && !Array.isArray(corrections)) {
    for (const [field, value] of Object.entries(corrections)) {
      if (!CORRECTABLE_FIELDS.includes(field)) throw new Error('CORRECTION_FIELD_INVALID:' + field);
      identity[field] = value;
      identity.corrections_log = identity.corrections_log ?? [];
      identity.corrections_log.push({ field, corrected_by: actor, corrected_at: now() });
    }
    identity.corrected_by = actor;
    identity.corrected_at = now();
  }
  identity.status = 'VERIFIED_BRAND_IDENTITY';
  identity.verified_by = actor;
  identity.verified_at = now();
  return identity;
}

/**
 * Config auto-fill after DISCOVER: only EMPTY fields are filled, always with
 * config_provenance.auto_filled_from = 'DISCOVER'. Manually filled fields are
 * never overwritten. Returns the list of filled fields.
 */
export function autoFillConfig(config, identity) {
  const filled = [];
  if (!identity) return filled;
  if (!clean(config.market) && identity.products_services?.length) {
    config.market = identity.products_services[0].name;
    filled.push('market');
  }
  if ((!Array.isArray(config.priority_services) || !config.priority_services.length) && identity.products_services?.length) {
    config.priority_services = identity.products_services.slice(0, 5).map((item) => item.name);
    filled.push('priority_services');
  }
  if (filled.length) {
    config.config_provenance = {
      ...(config.config_provenance ?? {}),
      auto_filled_from: 'DISCOVER',
      auto_filled_fields: [...new Set([...(config.config_provenance?.auto_filled_fields ?? []), ...filled])],
      collected_at: identity.collected_at ?? now(),
    };
  }
  return filled;
}
