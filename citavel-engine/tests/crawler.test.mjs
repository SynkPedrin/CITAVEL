import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isPublicAddress, parseRobots, robotsAllowed, parseHtml, crawl, audit, extractEvidence } from '../core/crawler.mjs';

const config = { client_id: 'fixture', brand: 'Marca de Teste', domain: 'https://fixture.example/' };
const html = ({ title = 'Página de teste', body = '<h1>Informações de teste</h1>', head = '' } = {}) => `<!doctype html><html><head><title>${title}</title>${head}</head><body><nav>MENU EXCLUÍDO</nav><main>${body}</main><footer>RODAPÉ EXCLUÍDO</footer></body></html>`;
const fixtureFetch = (routes, calls = []) => async (url) => {
  calls.push(url);
  const response = routes[url];
  if (response instanceof Error) throw response;
  return { status: response?.status ?? 404, headers: response?.headers ?? { 'content-type': 'text/html' }, body: response?.body ?? '' };
};

test('URL normalization resolves relatives and preserves meaningful path/query identity', () => {
  assert.equal(normalizeUrl('../produtos/?b=2&utm_source=x&a=1#info', 'https://EXAMPLE.com:443/local/'), 'https://example.com/produtos/?a=1&b=2');
  assert.equal(normalizeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(normalizeUrl('https://example.com/x/'), 'https://example.com/x/');
  for (const invalid of ['javascript:alert(1)', 'file:///tmp/test', 'ftp://example.com', 'https://user:secret@example.com/', '']) assert.equal(normalizeUrl(invalid), null);
});

test('private and special-use network targets are rejected including IPv4-mapped IPv6', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.1.1', '172.20.1.1', '169.254.169.254', '192.168.1.1', '192.0.2.5', '198.18.1.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1', '2001:0db8::1', '2002:7f00:1::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const domain of ['http://127.0.0.1', 'http://localhost', 'http://[::1]', 'http://2130706433', 'http://192.168.1.1', 'http://machine.local']) await assert.rejects(crawl({ ...config, domain }), /UNSAFE_URL/);
});

test('robots chooses longest agent group and longest matching rule with allow winning ties', () => {
  const robots = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*?secret=*\nUser-agent: Googlebot\nDisallow: /search\nUser-agent: OAI-SearchBot\nDisallow: /\nAllow: /allowed$\nUser-agent: Googlebot\nAllow: /search/help\nSitemap: https://fixture.example/map.xml`, config.domain);
  assert.equal(robotsAllowed(robots, `${config.domain}private/x`), false);
  assert.equal(robotsAllowed(robots, `${config.domain}private/public`), true);
  assert.equal(robotsAllowed(robots, `${config.domain}?secret=x`), false);
  assert.equal(robotsAllowed(robots, `${config.domain}private`, 'Googlebot'), true);
  assert.equal(robotsAllowed(robots, `${config.domain}search`, 'Googlebot'), false);
  assert.equal(robotsAllowed(robots, `${config.domain}search/help`, 'Googlebot'), true);
  assert.equal(robotsAllowed(robots, `${config.domain}allowed`, 'OAI-SearchBot'), true);
  assert.equal(robotsAllowed(robots, `${config.domain}allowed/more`, 'OAI-SearchBot'), false);
  assert.deepEqual(robots.sitemaps, ['https://fixture.example/map.xml']);
  const unicode = parseRobots('User-agent: *\nDisallow: /ação\nDisallow: /~private', config.domain);
  assert.equal(robotsAllowed(unicode, `${config.domain}a%C3%A7%C3%A3o`), false);
  assert.equal(robotsAllowed(unicode, `${config.domain}%7Eprivate`), false);
});

test('HTML extraction retains technical fields without executing scripts or mixing navigation into main text', () => {
  const page = parseHtml(html({ head: `<meta name="description" content="Descrição de teste"><link rel="canonical" href="/canonical"><meta name="robots" content="noindex,follow"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Teste"}]}</script><script type="application/ld+json">{broken}</script>`, body: '<h1>Informações de teste</h1><h2>Detalhes</h2><h3>Contexto</h3><p>Texto principal com informações publicadas apenas para este teste.</p><a href="/second?utm_source=test">Interno</a><a href="https://external.example/">Externo</a><img src="/photo.jpg" alt="Imagem de teste"><img src="/empty.jpg"><script>THROW_SECRET</script>' }), config.domain, config, { status: 200, headers: { 'content-type': 'text/html', 'last-modified': 'Tue, 01 Sep 2026 12:00:00 GMT' }, response_time_ms: 12 });
  assert.equal(page.canonical, 'https://fixture.example/canonical');
  assert.equal(page.meta_description, 'Descrição de teste');
  assert.equal(page.indexable, false);
  assert.deepEqual(page.schema_types, ['Organization']);
  assert.equal(page.json_ld_errors.length, 1);
  assert.deepEqual(page.h2, ['Detalhes']);
  assert.deepEqual(page.h3, ['Contexto']);
  assert.equal(page.image_count, 2);
  assert.equal(page.missing_alt_count, 1);
  assert.equal(page.response_time_ms, 12);
  assert.deepEqual(page.internal_links, ['https://fixture.example/second']);
  assert.deepEqual(page.external_links, ['https://external.example/']);
  assert.match(page.main_text, /Texto principal/);
  assert.doesNotMatch(page.main_text, /MENU|RODAPÉ|THROW_SECRET/);
  assert.ok(page.word_count > 10);
  const scoped = parseHtml(html(), config.domain, config, { headers: { 'x-robots-tag': 'bingbot: follow, noindex' } });
  assert.equal(scoped.indexable, true, 'A Bing-only noindex must not mark Googlebot as noindex');
});

test('bounded crawl honors crawler blocks while reporting distinct Googlebot and OAI policies', async () => {
  const calls = [];
  const routes = {
    'https://fixture.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\nUser-agent: Googlebot\nDisallow: /google-only\nUser-agent: OAI-SearchBot\nDisallow: /\nSitemap: https://fixture.example/sitemap.xml' },
    'https://fixture.example/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://fixture.example/orphan</loc></url><url><loc>https://fixture.example/private</loc></url></urlset>' },
    'https://fixture.example/': { status: 200, body: html({ body: '<h1>Início</h1><p>Informações de teste suficientes para mostrar uma declaração no banco de evidências.</p><a href="/google-only">Detalhes</a><a href="/#top">Início</a><a href="/private">Privado</a>' }) },
    'https://fixture.example/orphan': { status: 200, body: html() },
    'https://fixture.example/google-only': { status: 200, body: html() },
  };
  const result = await crawl(config, { fetch: fixtureFetch(routes, calls), maxPages: 5, delayMs: 0 });
  assert.equal(result.pages.length, 4);
  assert.ok(!calls.includes('https://fixture.example/private'));
  assert.equal(result.pages.find((page) => page.url.endsWith('/private')).skipped, 'ROBOTS_BLOCKED');
  assert.equal(result.pages.find((page) => page.url.endsWith('/google-only')).robots.googlebot, false);
  assert.equal(result.pages[0].robots.oai_searchbot, false);
  const rows = audit(result, config);
  assert.ok(rows.find((row) => row.url.endsWith('/orphan')).issues.some((issue) => issue.code === 'ORPHAN_CANDIDATE'));
  assert.ok(rows[0].issues.some((issue) => issue.code === 'TITLE_DUPLICATE'));
  assert.ok(rows[0].issues.some((issue) => issue.code === 'OAI_SEARCHBOT_BLOCKED'));
  const evidence = extractEvidence(result, config);
  assert.ok(evidence.length > 0);
  assert.ok(evidence.every((row) => row.verified === false && row.public_allowed === false && row.source_url.startsWith(config.domain)));
  assert.deepEqual(evidence.map((row) => row.evidence_id), extractEvidence(result, config).map((row) => row.evidence_id));
  assert.equal(new Set(evidence.map((row) => row.evidence_id)).size, evidence.length);
});

test('unavailable robots fails closed and does not invent empty-content SEO issues', async () => {
  const calls = [];
  const result = await crawl(config, { fetch: fixtureFetch({ 'https://fixture.example/robots.txt': { status: 503, body: 'Unavailable' } }, calls), delayMs: 0 });
  assert.deepEqual(calls, ['https://fixture.example/robots.txt']);
  assert.equal(result.pages[0].skipped, 'ROBOTS_UNAVAILABLE');
  const row = audit(result, config)[0];
  assert.equal(row.indexable, null);
  assert.equal(row.seo_score, null);
  assert.deepEqual(row.issues.map((issue) => issue.code), ['ROBOTS_UNAVAILABLE']);
  assert.deepEqual(extractEvidence(result, config), []);
});

test('redirects cannot reach private targets; loops and chain lengths are bounded', async () => {
  const calls = [];
  const result = await crawl(config, { fetch: fixtureFetch({
    'https://fixture.example/': { status: 302, headers: { location: 'http://127.0.0.1/admin' } },
  }, calls), delayMs: 0 });
  assert.equal(result.pages[0].redirect_error, 'EXTERNAL_REDIRECT_NOT_FOLLOWED');
  assert.ok(!calls.some((url) => url.includes('127.0.0.1')));
  const loop = await crawl(config, { fetch: fixtureFetch({
    'https://fixture.example/': { status: 302, headers: { location: '/loop' } },
    'https://fixture.example/loop': { status: 301, headers: { location: '/' } },
  }), delayMs: 0 });
  assert.equal(loop.pages[0].fetch_error, 'REDIRECT_LOOP');
  assert.equal(loop.pages[0].redirect_chain.length, 2);
  assert.ok(audit(loop, config)[0].issues.some((issue) => issue.code === 'REDIRECT_CHAIN'));
});

test('crawl page budget stops query expansion and flags a partial sample', async () => {
  const fetch = async (url) => ({ status: 200, headers: { 'content-type': 'text/html' }, body: url.endsWith('robots.txt') ? '' : url.endsWith('sitemap.xml') ? '<urlset/>' : html({ body: Array.from({ length: 20 }, (_, i) => `<a href="/page?n=${i}">${i}</a>`).join('') }) });
  const result = await crawl(config, { fetch, maxPages: 3, delayMs: 0 });
  assert.equal(result.pages.length, 3);
  assert.equal(result.scope.bounded_sample, true);
  assert.ok(result.issues.some((issue) => issue.code === 'BOUNDED_SAMPLE'));
});
