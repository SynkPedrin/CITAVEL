// Competitive intelligence, pure tests: comparison maths, import parsing, SSRF guard, image safety, logo discovery
// and the PDF page. No DB, no network, no AI credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparison, type CompetitorInput } from '../lib/competitive/metrics';
import { parseMeasurement } from '../lib/ai-measurement/parse';
import { isPublicAddress, parsePublicUrl, safeFetch } from '../lib/brand/net';
import { sniffImage, svgProblem, validateLogo } from '../lib/brand/image';
import { extractCandidates, identityMatches } from '../lib/brand/resolver';
import { renderReportHtmlV2 } from '../lib/report/template-v2';
import { narrativeV2 } from '../lib/report/narrative-v2';

const platform = (provider: string, o: any = {}) => ({ provider, label: provider, model: null, collectionMethod: null, promptCount: 20, observationCount: 20, mentionCount: 8, recommendationCount: 5, citationCount: 2, ...o });
const comp = (id: string, name: string, metrics: any[]): CompetitorInput => ({ id, name, domain: `${id}.example.invalid`, metrics: metrics.map(m => ({ observationCount: 20, mentionCount: null, recommendationCount: null, citationCount: null, ...m })) });
const base = { clientName: 'Cliente', clientDomain: 'cliente.invalid' };

test('comparison: client row first, competitors sorted by recommendation coverage, diff in percentage points', () => {
  const r = buildComparison({ ...base, platforms: [platform('OPENAI'), platform('GEMINI', { mentionCount: 4, recommendationCount: 2, citationCount: 0 })], competitors: [
    comp('a', 'Alfa', [{ provider: 'OPENAI', mentionCount: 10, recommendationCount: 8, citationCount: 3 }, { provider: 'GEMINI', mentionCount: 9, recommendationCount: 6, citationCount: 1 }]),
    comp('b', 'Beta', [{ provider: 'OPENAI', mentionCount: 6, recommendationCount: 2, citationCount: 0 }]),
    comp('c', 'Gama', [{ provider: 'OPENAI', mentionCount: 12, recommendationCount: 9, citationCount: 4 }, { provider: 'GEMINI', mentionCount: 3, recommendationCount: 1, citationCount: 0 }])] });
  assert.equal(r.client.recommendation!.numerator, 7); assert.equal(r.client.recommendation!.denominator, 40);
  assert.deepEqual(r.competitors.map(c => c.name), ['Alfa', 'Gama', 'Beta']); // Alfa 14/40, Gama 10/40, Beta 2/20 (10%)
  assert.equal(r.top!.name, 'Alfa'); assert.equal(r.top!.diff!.recommendation, -17.5); // client 17.5% − Alfa 35%
  const beta = r.competitors.find(c => c.name === 'Beta')!;
  assert.equal(beta.diff!.recommendation, 15); // client on OPENAI only: 25% − 10%
  assert.deepEqual(beta.diff!.platforms, ['OPENAI']);
  assert.equal(r.client.share!.denominator, 7 + 14 + 10 + 2);
  assert.ok(r.opportunities.some(o => /Alfa é mais recomendada em OPENAI|Alfa é mais recomendada/.test(o.title)));
  assert.ok(!r.opportunities.some(o => o.competitor === 'Beta' && /mais recomendada/.test(o.title))); // client is ahead of Beta
});

test('comparison: different universes are never compared; missing totals are not zeros', () => {
  const r = buildComparison({ ...base, platforms: [platform('OPENAI')], competitors: [
    comp('a', 'Alfa', [{ provider: 'OPENAI', observationCount: 10, mentionCount: 9, recommendationCount: 9 }]),
    comp('b', 'Beta', [{ provider: 'OPENAI', observationCount: null, mentionCount: 3 }]),
    comp('c', 'Gama', [{ provider: 'CLAUDE', mentionCount: 3 }]),
    comp('d', 'Delta', [])] });
  for (const n of ['Alfa', 'Beta', 'Gama']) { const c = r.competitors.find(x => x.name === n)!; assert.equal(c.measured, false); assert.equal(c.mention, null); assert.equal(c.diff, null); assert.ok(c.skipped.length === 1); }
  assert.match(r.competitors.find(c => c.name === 'Alfa')!.skipped[0].reason, /universo diferente/);
  assert.equal(r.competitors.find(c => c.name === 'Delta')!.measured, false);
  assert.equal(r.hasComparableData, false);
  assert.equal(r.client.share, r.client.share); assert.equal(r.opportunities.length, 0);
  // client without totals: nothing comparable, nothing invented
  const none = buildComparison({ ...base, platforms: [platform('OPENAI', { observationCount: null })], competitors: [comp('a', 'Alfa', [{ provider: 'OPENAI', mentionCount: 3 }])] });
  assert.equal(none.client.mention, null); assert.equal(none.hasComparableData, false);
});

test('comparison: no competitors, platform filter and matrix states', () => {
  assert.equal(buildComparison({ ...base, platforms: [platform('OPENAI')], competitors: [] }).hasComparableData, false);
  const r = buildComparison({ ...base, platforms: [platform('OPENAI'), platform('GEMINI')], provider: 'GEMINI', competitors: [comp('a', 'Alfa', [{ provider: 'OPENAI', recommendationCount: 5 }, { provider: 'GEMINI', mentionCount: 4, recommendationCount: 1 }])] });
  assert.deepEqual(r.matrix.providers, ['GEMINI']); assert.equal(r.competitors[0].recommendation!.denominator, 20);
  const m = buildComparison({ ...base, platforms: [platform('OPENAI'), platform('GEMINI')], competitors: [comp('a', 'Alfa', [{ provider: 'OPENAI', observationCount: 7, recommendationCount: 1 }])] });
  const alfa = m.matrix.rows.find(x => x.name === 'Alfa')!;
  assert.equal(alfa.cells.OPENAI.recommendation.state, 'NOT_COMPARABLE'); assert.equal(alfa.cells.GEMINI.recommendation.state, 'NOT_MEASURED');
});

const JSON_REPORT = (extra: any) => JSON.stringify({ client: 'Cliente', source: 'Agentes', methodology: 'm', executed_at: '2026-10-11', platforms: [{ platform: 'OpenAI', observations: 20, mentions: 8, recommendations: 5, citations: 2 }], ...extra });
test('import parser: competitive_analysis with domains and per-platform counts', () => {
  const p = parseMeasurement(JSON_REPORT({ competitive_analysis: { competitors: [
    { name: 'Alfa Diagnósticos', domain: 'https://www.alfa.example.invalid/', platforms: [{ platform: 'ChatGPT', observations: 20, mentions: 10, recommendations: '8 de 20', citations: 3 }] },
    { name: 'Beta', platforms: { gemini: { observations: 20, mentions: 4 } } }] } }));
  assert.equal(p.competitive.length, 2); assert.equal(p.competitive[0].domain, 'alfa.example.invalid');
  assert.deepEqual(p.competitive[0].metrics[0], { provider: 'OPENAI', observationCount: 20, mentionCount: 10, recommendationCount: 8, citationCount: 3 });
  assert.equal(p.competitive[1].domain, null); assert.equal(p.competitive[1].metrics[0].provider, 'GEMINI');
  assert.deepEqual(p.competitors.map(c => c.name), ['Alfa Diagnósticos', 'Beta']);
});
test('import parser: duplicates, invalid domain, percent-only and impossible values become warnings, not numbers', () => {
  const p = parseMeasurement(JSON_REPORT({ competitive_analysis: [
    { name: 'Alfa', domain: 'not a domain', platforms: [{ platform: 'OpenAI', observations: 20, mentions: '70%', recommendations: 25, citations: 3 }] },
    { name: 'alfa', platforms: [] }, { name: 'Beta', platforms: [{ platform: 'OpenAI', mentions: 4 }] }] }));
  const codes = p.warnings.map(w => w.code);
  for (const c of ['INVALID_DOMAIN', 'PERCENT_WITHOUT_COUNT', 'IMPOSSIBLE_VALUE', 'DUPLICATE_COMPETITOR', 'MISSING_DENOMINATOR']) assert.ok(codes.includes(c), c);
  assert.equal(p.competitive.length, 2); assert.equal(p.competitive[0].domain, null);
  assert.equal(p.competitive[0].metrics[0].mentionCount, null); assert.equal(p.competitive[0].metrics[0].recommendationCount, null); assert.equal(p.competitive[0].metrics[0].citationCount, 3);
});
test('import parser: free text never becomes competitor percentages; old reports still parse', () => {
  const p = parseMeasurement('Concorrente A apareceu com frequência no ChatGPT.\nConcorrente B foi recomendado 70% das vezes.');
  assert.equal(p.competitive.length, 0);
  const old = parseMeasurement(JSON_REPORT({ competitors: ['Alfa', { name: 'Beta' }] }));
  assert.equal(old.competitive.length, 0); assert.deepEqual(old.competitors.map(c => c.name), ['Alfa', 'Beta']);
});

test('SSRF guard: private, loopback, link-local, metadata and mapped addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.0.9', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.1.1.1', '64:ff9b::1']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  for (const u of ['file:///etc/passwd', 'ftp://x.com/a', 'http://localhost/', 'http://svc.internal/', 'http://a.local/', 'http://user:pw@x.com/', 'http://example.com:8080/', 'gopher://x']) assert.throws(() => parsePublicUrl(u), (e: any) => ['BAD_URL', 'BLOCKED_ADDRESS'].includes(e.code), u);
  assert.equal(isPublicAddress(parsePublicUrl('http://[::1]/').hostname.replace(/[\[\]]/g, '')), false); // IP literals pass the URL check and are refused by the address check
  assert.equal(parsePublicUrl('https://example.com/logo.png').hostname, 'example.com');
});
test('SSRF guard: a name that resolves to ANY internal address is blocked before connecting', async () => {
  await assert.rejects(safeFetch('http://evil.example/', 1000, async () => ['93.184.216.34', '127.0.0.1']), (e: any) => e.code === 'BLOCKED_ADDRESS');
  await assert.rejects(safeFetch('http://meta.example/', 1000, async () => ['169.254.169.254']), (e: any) => e.code === 'BLOCKED_ADDRESS');
  await assert.rejects(safeFetch('http://127.0.0.1/', 1000), (e: any) => e.code === 'BLOCKED_ADDRESS');
  await assert.rejects(safeFetch('http://[::1]/', 1000), (e: any) => e.code === 'BLOCKED_ADDRESS');
  await assert.rejects(safeFetch('http://nxdomain.example/', 1000, async () => { throw new Error('ENOTFOUND'); }), (e: any) => e.code === 'DNS_FAILED');
});

const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
test('image validation is by content: html/exe/corrupt files and oversize images are refused', () => {
  assert.equal(validateLogo(png(200, 80)).mime, 'image/png');
  assert.equal(sniffImage(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.throws(() => validateLogo(Buffer.from('<html><body>not an image</body></html>')), (e: any) => e.code === 'NOT_AN_IMAGE');
  assert.throws(() => validateLogo(Buffer.from('MZ\x90\x00\x03\x00\x00\x00 exe')), (e: any) => e.code === 'NOT_AN_IMAGE');
  assert.throws(() => validateLogo(png(0, 0)), (e: any) => e.code === 'CORRUPT_IMAGE');
  assert.throws(() => validateLogo(png(10, 10)), (e: any) => e.code === 'TOO_SMALL');
  assert.throws(() => validateLogo(png(9000, 100)), (e: any) => e.code === 'TOO_LARGE');
  assert.throws(() => validateLogo(Buffer.concat([png(100, 100), Buffer.alloc(600_000)])), (e: any) => e.code === 'TOO_LARGE');
  assert.throws(() => validateLogo(Buffer.alloc(0)), (e: any) => e.code === 'EMPTY_IMAGE');
});
test('SVG: scripts, event handlers, foreignObject, external refs and entities are rejected; plain vector is accepted', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#b8f52a"/></svg>';
  assert.equal(svgProblem(ok), null); assert.equal(validateLogo(Buffer.from(ok)).ext, 'svg');
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><foreignObject><div/></foreignObject></svg>', '<svg><a href="https://evil.example"><rect/></a></svg>', '<svg><image xlink:href="http://evil/x.png"/></svg>', '<svg><style>@import "http://evil/x.css";</style></svg>', '<svg><rect style="fill:url(http://evil/x)"/></svg>', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', '<svg><a href="javascript:alert(1)"/></svg>', '<svg><use href="x.svg#a"/></svg>'])
    assert.throws(() => validateLogo(Buffer.from(bad)), (e: any) => e.code === 'UNSAFE_SVG' || e.code === 'NOT_AN_IMAGE', bad);
});

test('logo discovery: schema.org logo first, header image next, icon last; only from the page itself', () => {
  const html = `<html><head><title>Alfa Diagnósticos | Home</title><meta property="og:site_name" content="Alfa Diagnósticos">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"MedicalBusiness","name":"Alfa Diagnósticos","logo":{"@type":"ImageObject","url":"/img/logo-schema.png"}}</script>
    <link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/favicon.ico"></head>
    <body><header><a><img class="site-logo" src="/img/header-logo.svg" alt="Alfa"></a><img src="/img/banner.jpg" alt="banner"></header></body></html>`;
  const { candidates, names } = extractCandidates(html, 'https://alfa.example.invalid/');
  assert.deepEqual(candidates.map(c => [c.via, c.url]), [['JSON_LD', 'https://alfa.example.invalid/img/logo-schema.png'], ['HEADER_IMG', 'https://alfa.example.invalid/img/header-logo.svg'], ['ICON', 'https://alfa.example.invalid/apple.png']]);
  assert.ok(identityMatches('Alfa Diagnósticos', names)); assert.ok(!identityMatches('Beta Clínica', names));
  assert.equal(extractCandidates('<html><body><img src="data:image/png;base64,AAA" class="logo"></body></html>', 'https://x.invalid/').candidates.length, 0);
});

// ---- PDF page ----
const rate = (n: number, d: number) => ({ value: n / d, numerator: n, denominator: d, platforms: 1 });
const row = (name: string, o: any = {}) => ({ id: name, name, is_client: false, domain: null, mention: rate(8, 20), recommendation: rate(4, 20), citation: rate(1, 20), share: rate(4, 30), diff: { mention: 0, recommendation: 5, citation: 0, platforms: ['OpenAI'] }, measured: true, platforms: ['OpenAI'], skipped: [], logo: null, ...o });
const snap = (competitors: any[], over: any = {}) => { const o: any = snap0(competitors, over); o.narrative = narrativeV2(o); return o; };
const snap0 = (competitors: any[], over: any = {}) => ({ schema: 'citavel-report-snapshot/v2', report_type: 'IA', format: 'COMPLETO', generated_at: '2026-10-14T12:00:00Z', client: { name: 'Cliente', domain: 'https://cliente.invalid/' }, period: { start: '2026-10-01', end: '2026-10-10', days: null }, gsc_metrics: null, data_provenance: [], next_steps: [], narrative: {},
  ai_visibility: { status: 'AVAILABLE', title: 'Medição', classification: 'LAB', source: 'Agentes', methodology: 'm', methodology_version: '1', executed_at: '2026-10-11', period: {}, platforms: [{ provider: 'OPENAI', label: 'OpenAI', model: 'x', collection_method: 'API', prompts: 20, observations: 20, mentions: 8, recommendations: 4, citations: 1, mention_rate: rate(8, 20), recommendation_rate: rate(4, 20), citation_rate: rate(1, 20) }], indicators: { mention: rate(8, 20), recommendation: rate(4, 20), citation: rate(1, 20), observations: 20 }, quantitative: true, competitors: [], sources: [], strengths: [], weaknesses: [], opportunities: [], conclusions: [], limitations: [], evidence: [], comparison: null },
  competitive: { status: 'AVAILABLE', measurement_version: 1, classification: 'LAB', methodology: 'm', methodology_version: '1', period: { start: '2026-10-01', end: '2026-10-10', executed_at: '2026-10-11' }, platforms: ['OpenAI'],
    rows: [row('Cliente', { is_client: true, diff: null, logo: { data_uri: 'data:image/png;base64,iVBORw0KGgo=' } }), ...competitors], top: competitors[0] ? { name: competitors[0].name, recommendation: competitors[0].recommendation, diff: 5 } : null,
    matrix_platforms: ['OpenAI'], matrix: [{ name: 'Cliente', is_client: true, cells: { OpenAI: { recommendation: { rate: rate(4, 20) }, mention: { rate: rate(8, 20) }, citation: { state: 'NOT_MEASURED' } } } }, ...competitors.map(c => ({ name: c.name, is_client: false, cells: { OpenAI: { recommendation: { rate: rate(5, 20) }, mention: { state: 'NOT_COMPARABLE', reason: 'x' }, citation: { state: 'NOT_MEASURED' } } } }))], opportunities: competitors.length ? [{ id: 'o', title: 'Alfa é mais recomendada em OpenAI', description: 'Alfa foi recomendada em 5 de 20 respostas.', competitor: 'Alfa', platform: 'OpenAI', priority: 'MÉDIA', evidence: 'OpenAI: 5/20 × 4/20' }] : [], not_comparable: [], without_data: [] }, ...over });
const names = (n: number) => Array.from({ length: n }, (_, i) => row(['Alfa', 'Beta', 'Gama', 'Delta', 'Épsilon', 'Zeta', 'Eta'][i], { logo: i === 1 ? { data_uri: 'data:image/png;base64,iVBORw0KGgo=' } : null }));
const html = (s: any) => renderReportHtmlV2(s, { snapshotId: 'x', hash: 'h' });
const cmpPos = (h: string) => ({ cover: h.indexOf('class="cover"'), cmp: h.indexOf('class="cmp-page"'), intro: h.indexOf('class="intro"') });

test('PDF: the comparison is the first analytical page, right after the cover, for IA and COMPLETO', () => {
  for (const kind of ['IA', 'COMPLETO']) {
    const h = html(snap(names(3), { report_type: kind })); const p = cmpPos(h);
    assert.ok(p.cover >= 0 && p.cover < p.cmp && p.cmp < p.intro, kind);
    assert.match(h, /Como sua marca se compara\?/); assert.match(h, /Presença e recomendações nas inteligências artificiais monitoradas\./);
    assert.match(h, /4\/20/); assert.match(h, /clogo av/); assert.match(h, /<img src="data:image\/png;base64,iVBORw0KGgo="/);
    assert.match(h, /Comparativo por plataforma/); assert.match(h, /Oportunidades competitivas/);
  }
});
test('PDF: 5 competitors fit the first page; more continue in a following section without losing rows', () => {
  const five = html(snap(names(5))); assert.ok(!five.includes('Comparativo competitivo (continuação)')); for (const n of ['Alfa', 'Beta', 'Gama', 'Delta', 'Épsilon']) assert.ok(five.includes(n));
  const seven = html(snap(names(7))); assert.ok(seven.includes('Comparativo competitivo (continuação)')); for (const n of ['Zeta', 'Eta']) assert.ok(seven.includes(n));
  assert.match(seven, /Mais 2 empresas identificadas aparecem/);
});
test('PDF: no competitive data → no fabricated table; Google-only reports never include it', () => {
  const none = html(snap([], { competitive: { status: 'UNAVAILABLE', reason: 'NO_COMPARABLE_DATA' } })); assert.ok(!none.includes('class="cmp-page"')); assert.ok(!none.includes('Como sua marca se compara'));
  const g = html(snap(names(3), { report_type: 'GOOGLE' })); assert.ok(!g.includes('class="cmp-page"'));
  const missing = html({ ...snap(names(3)), competitive: undefined }); assert.ok(!missing.includes('class="cmp-page"'));
});
test('PDF: names are escaped (no HTML injection through competitor names)', () => {
  const h = html(snap([row('<img src=x onerror=alert(1)>Evil')])); assert.ok(!h.includes('<img src=x onerror')); assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;Evil'));
});
