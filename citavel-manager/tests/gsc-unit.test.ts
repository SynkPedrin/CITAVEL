import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, aggregateBy, resolvePeriod, chunkRange, delta } from '../lib/gsc/metrics';
import { classifyQuery, defaultBrandTerms } from '../lib/gsc/classify';
import { redactQuery } from '../lib/gsc/redact';
import { detectOpportunities } from '../lib/gsc/opportunities';
import { GscApi, GscApiError, ROW_LIMIT, propertyType, hasDataAccess } from '../lib/gsc/api';
import { newAuthRequest, exchangeCode, refreshAccessToken, encryptToken, decryptToken, OAuthError, GSC_SCOPE } from '../lib/gsc/oauth';
import { mergeRows, jobWindow } from '../lib/gsc/sync';
import { signLink, verifyLink, LINK_TTL_MS } from '../lib/report/service';
import { renderReportHtml } from '../lib/report/template';
import { narrative } from '../lib/report/narrative';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// ---- metric aggregation ----
test('aggregation never sums CTR or position: CTR = clicks/impressions, position impression-weighted', () => {
  const a = aggregate([{ clicks: 10, impressions: 100, position: 2 }, { clicks: 0, impressions: 900, position: 12 }]);
  assert.equal(a.clicks, 10); assert.equal(a.impressions, 1000);
  assert.equal(a.ctr, 0.01); // not (0.1 + 0) / 2
  assert.equal(a.position, (2 * 100 + 12 * 900) / 1000); // 11, not mean 7
  assert.deepEqual(aggregate([]), { clicks: 0, impressions: 0, ctr: null, position: null });
});
test('aggregateBy groups per key across days', () => {
  const g = aggregateBy([{ key: 'a', clicks: 1, impressions: 10, position: 3 }, { key: 'a', clicks: 1, impressions: 30, position: 5 }, { key: 'b', clicks: 0, impressions: 5, position: 9 }]);
  const a = g.find(x => x.key === 'a')!; assert.equal(a.clicks, 2); assert.equal(a.position, 4.5); assert.equal(a.ctr, 2 / 40);
});
test('periods end on latest data day and compare to the same-length previous window', () => {
  const p = resolvePeriod('28d', '2026-10-11');
  assert.equal(p.start, '2026-09-14'); assert.equal(p.end, '2026-10-11'); assert.equal(p.days, 28);
  assert.deepEqual(p.previous, { start: '2026-08-17', end: '2026-09-13' });
  const c = resolvePeriod('custom', '2026-10-11', { from: '2026-10-01', to: '2026-12-31' });
  assert.equal(c.end, '2026-10-11'); // clamped, never future
  assert.equal(resolvePeriod('bogus', '2026-10-11').key, '28d');
  assert.equal(delta(5, 0).pct, null);
});
test('chunkRange covers the window without gaps or overlap', () => {
  const c = chunkRange('2026-01-01', '2026-01-31', 14);
  assert.deepEqual(c.map(x => [x.start, x.end]), [['2026-01-01', '2026-01-14'], ['2026-01-15', '2026-01-28'], ['2026-01-29', '2026-01-31']]);
});
test('job windows: initial = 16 months back, daily = revision window', () => {
  assert.deepEqual(jobWindow('GSC_INITIAL_SYNC', '2026-10-14'), { start: '2025-06-14', end: '2026-10-13' });
  assert.deepEqual(jobWindow('GSC_DAILY_SYNC', '2026-10-14'), { start: '2026-10-04', end: '2026-10-13' });
});

// ---- classification ----
const terms = { brand: defaultBrandTerms('DCS Diagnósticos por Imagem', 'https://dcs.med.br/'), services: ['ressonância magnética'], locations: ['Campinas'] };
test('classifier: brand from name + domain label, services/locations only from confirmed terms', () => {
  assert.ok(terms.brand.includes('dcs'));
  const b = classifyQuery('DCS resultado de exame', terms); assert.equal(b.category, 'BRANDED'); assert.equal(b.branded, true); assert.deepEqual(b.matched, ['dcs']);
  const s = classifyQuery('ressonancia magnetica preço campinas', terms); assert.equal(s.category, 'SERVICE'); assert.ok(s.tags.includes('LOCATION') && s.tags.includes('COMMERCIAL') && s.tags.includes('NON_BRANDED'));
  assert.equal(classifyQuery('tomografia preço', terms).category, 'COMMERCIAL'); // tomografia is NOT a confirmed service
  assert.equal(classifyQuery('o que é contraste iodado', terms).category, 'INFORMATIONAL');
  assert.equal(classifyQuery('xyz', terms).rule, 'no_match');
  assert.equal(classifyQuery('ressonancia', { brand: [], services: [], locations: [] }).category, 'OTHER'); // no invented services
});
test('classifier: human review overrides and stays auditable', () => {
  const h = classifyQuery('tomografia preço', terms, { category: 'SERVICE' });
  assert.equal(h.category, 'SERVICE'); assert.equal(h.source, 'HUMAN'); assert.match(h.rule, /human_override \(rule: commercial_pattern\)/);
  assert.equal(classifyQuery('dcs', terms, { category: 'NON_BRANDED' }).branded, false);
});
test('redaction masks phone, e-mail, CPF before storage', () => {
  assert.deepEqual(redactQuery('maria 11 98765-4321'), { value: 'maria [telefone]', redacted: true });
  assert.equal(redactQuery('laudo joao@mail.com').value, 'laudo [email]');
  assert.equal(redactQuery('resultado 123.456.789-09').value, 'resultado [cpf]');
  assert.equal(redactQuery('ressonância 3 tesla').redacted, false);
});
test('mergeRows collapses rows that became identical after redaction (weighted position)', () => {
  const m = mergeRows([{ keys: ['2026-10-01', 'tel 11 98765-4321'], clicks: 1, impressions: 10, ctr: .1, position: 2 }, { keys: ['2026-10-01', 'tel 11 91234-5678'], clicks: 0, impressions: 30, ctr: 0, position: 6 }], 1, true);
  assert.equal(m.rows.length, 1); assert.equal(m.redacted, 2); assert.equal(m.rows[0].impressions, 40); assert.equal(m.rows[0].position, 5);
});

// ---- opportunities ----
test('opportunities need volume, position and intent; branded and thin samples are not flagged', () => {
  const C = (cat: any, branded = false) => ({ category: cat, branded, tags: [], rule: '', matched: [], source: 'RULE' as const, version: 'x' });
  const q = (key: string, impressions: number, ctr: number, position: number, cat = 'SERVICE', branded = false) => ({ key, clicks: Math.round(impressions * ctr), impressions, ctr, position, classification: C(cat, branded) });
  const peers = [1, 2, 3, 4, 5].map(i => q(`peer${i}`, 500, 0.2, 2));
  const low = q('ressonancia preço', 800, 0.02, 2);
  const out = detectOpportunities({ queries: [...peers, low, q('dcs', 900, 0.01, 1.5, 'BRANDED', true)], previousQueries: [], pages: [], previousPages: [], days: 28 });
  assert.ok(out.some(o => o.kind === 'LOW_CTR_FOR_POSITION' && o.subject === 'ressonancia preço'));
  assert.ok(!out.some(o => o.subject === 'dcs'));
  // Only 2 comparable queries → no low-CTR claim at all.
  assert.equal(detectOpportunities({ queries: [q('a', 800, 0.2, 2), q('b', 800, 0.01, 2)], previousQueries: [], pages: [], previousPages: [], days: 28 }).filter(o => o.kind === 'LOW_CTR_FOR_POSITION').length, 0);
  const drop = detectOpportunities({ queries: [], previousQueries: [], pages: [{ key: '/a', clicks: 10, impressions: 100, ctr: .1, position: 3 }], previousPages: [{ key: '/a', clicks: 40, impressions: 120, ctr: .33, position: 3 }, { key: '/gone', clicks: 25, impressions: 50, ctr: .5, position: 2 }], days: 28 });
  assert.deepEqual(drop.map(o => o.subject).sort(), ['/a', '/gone']);
});

// ---- Search Console API client ----
test('property types and data access', () => {
  assert.equal(propertyType('sc-domain:dcs.med.br'), 'DOMAIN'); assert.equal(propertyType('https://dcs.med.br/'), 'URL_PREFIX');
  assert.equal(hasDataAccess('siteUnverifiedUser'), false); assert.equal(hasDataAccess('siteFullUser'), true);
});
test('API pagination follows startRow until a short page', async () => {
  const starts: number[] = [];
  const f = (async (_u: string, init: any) => { const b = JSON.parse(init.body); starts.push(b.startRow); assert.equal(b.rowLimit, ROW_LIMIT); assert.equal(b.dataState, 'final'); const n = b.startRow === 0 ? ROW_LIMIT : 7; return json({ rows: Array.from({ length: n }, (_, i) => ({ keys: ['2026-10-01', `q${b.startRow + i}`], clicks: 0, impressions: 1, ctr: 0, position: 1 })) }); }) as any;
  const r = await new GscApi(async () => 't', { fetch: f, sleep: async () => {} }).query('https://dcs.med.br/', { startDate: '2026-10-01', endDate: '2026-10-01', dimensions: ['date', 'query'], type: 'web' });
  assert.deepEqual(starts, [0, ROW_LIMIT]); assert.equal(r.rows.length, ROW_LIMIT + 7); assert.equal(r.truncated, false);
});
test('API retries 429 (honoring Retry-After) and 5xx with backoff, then succeeds', async () => {
  const waits: number[] = []; let calls = 0;
  const f = (async () => { calls++; if (calls === 1) return json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 429, { 'retry-after': '2' }); if (calls === 2) return json({}, 503); return json({ siteEntry: [{ siteUrl: 'https://dcs.med.br/', permissionLevel: 'siteOwner' }] }); }) as any;
  const sites = await new GscApi(async () => 't', { fetch: f, sleep: async ms => { waits.push(ms); } }).listSites();
  assert.equal(sites.length, 1); assert.equal(calls, 3); assert.equal(waits[0], 2000); assert.ok(waits[1] >= 2000);
});
test('API: persistent quota → QUOTA_EXCEEDED (retryable); 403 permission → no retry; 401 → AUTH_EXPIRED', async () => {
  let calls = 0;
  const quota = (async () => { calls++; return json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403); }) as any;
  await assert.rejects(new GscApi(async () => 't', { fetch: quota, sleep: async () => {}, maxAttempts: 3 }).listSites(), (e: any) => e instanceof GscApiError && e.code === 'QUOTA_EXCEEDED' && e.retryable);
  assert.equal(calls, 3); calls = 0;
  const forbidden = (async () => { calls++; return json({ error: { errors: [{ reason: 'forbidden' }] } }, 403); }) as any;
  await assert.rejects(new GscApi(async () => 't', { fetch: forbidden, sleep: async () => {} }).listSites(), (e: any) => e.code === 'PERMISSION_DENIED');
  assert.equal(calls, 1);
  await assert.rejects(new GscApi(async () => 't', { fetch: (async () => json({}, 401)) as any, sleep: async () => {} }).listSites(), (e: any) => e.code === 'AUTH_EXPIRED');
});

// ---- OAuth ----
test('auth URL uses code flow, offline access, PKCE S256, state and the read-only scope', () => {
  const r = newAuthRequest('cid.apps.googleusercontent.com', 'http://localhost:3002/api/integrations/google/callback');
  const u = new URL(r.url); const p = u.searchParams;
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(p.get('response_type'), 'code'); assert.equal(p.get('access_type'), 'offline'); assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('state'), r.state); assert.ok(r.state.length >= 40 && r.verifier.length >= 43);
  assert.ok(p.get('scope')!.split(' ').includes(GSC_SCOPE)); assert.ok(!p.get('scope')!.includes('webmasters ')); // never the write scope
  assert.notEqual(newAuthRequest('c', 'r').state, r.state);
});
test('code exchange requires refresh token and the Search Console scope; reads the account email', async () => {
  const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'ops@agencia.com', sub: '123' })).toString('base64url') + '.y';
  let sent: URLSearchParams | null = null;
  const good = (async (_u: string, init: any) => { sent = init.body; return json({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: `openid ${GSC_SCOPE} email`, id_token: idt }); }) as any;
  const t = await exchangeCode({ clientId: 'c', clientSecret: 's' }, 'code', 'verifier', 'http://cb', good);
  assert.equal(t.email, 'ops@agencia.com'); assert.equal(t.refreshToken, 'r'); assert.equal(sent!.get('code_verifier'), 'verifier'); assert.equal(sent!.get('redirect_uri'), 'http://cb');
  await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's' }, 'c', 'v', 'r', (async () => json({ access_token: 'a', scope: GSC_SCOPE })) as any), (e: any) => e.code === 'OFFLINE_REQUIRED');
  await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's' }, 'c', 'v', 'r', (async () => json({ access_token: 'a', refresh_token: 'r', scope: 'openid email' })) as any), (e: any) => e.code === 'SCOPE_REQUIRED');
  await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's' }, 'c', 'v', 'r', (async () => json({ error: 'invalid_grant' }, 400)) as any), (e: any) => e.code === 'EXCHANGE_FAILED');
});
test('refresh: invalid_grant → AUTH_EXPIRED; success returns access token', async () => {
  assert.equal((await refreshAccessToken({ clientId: 'c', clientSecret: 's' }, 'r', (async () => json({ access_token: 'new', expires_in: 3600 })) as any)).accessToken, 'new');
  await assert.rejects(refreshAccessToken({ clientId: 'c', clientSecret: 's' }, 'r', (async () => json({ error: 'invalid_grant' }, 400)) as any), (e: any) => e instanceof OAuthError && e.code === 'AUTH_EXPIRED');
});
test('refresh tokens are encrypted at rest (AES-GCM, tamper-evident)', () => {
  const enc = encryptToken('1//refresh-token-value');
  assert.ok(!enc.includes('refresh-token-value')); assert.equal(decryptToken(enc), '1//refresh-token-value');
  assert.notEqual(encryptToken('x'), encryptToken('x'));
  const raw = Buffer.from(enc.slice(3), 'base64url'); raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptToken('v1.' + raw.toString('base64url')));
});

// ---- report links & template ----
test('download links expire and are bound to snapshot and user', () => {
  const now = Date.now(); const { exp, sig } = signLink('snap1', 'user1', now);
  assert.equal(verifyLink('snap1', 'user1', exp, sig, now), true);
  assert.equal(verifyLink('snap1', 'user2', exp, sig, now), false);
  assert.equal(verifyLink('snap2', 'user1', exp, sig, now), false);
  assert.equal(verifyLink('snap1', 'user1', exp, sig, now + LINK_TTL_MS + 5), false);
  assert.equal(verifyLink('snap1', 'user1', exp + 1, sig, now), false);
});
test('report template escapes content, marks unavailable data and only prints snapshot numbers', () => {
  const s: any = { language: 'pt-BR', report_type: 'EXECUTIVO', generated_at: '2026-10-14T10:00:00Z', sections: ['summary', 'google', 'ai_presence', 'competitors', 'methodology'], client: { name: '<script>x</script>', domain: 'https://dcs.med.br/' }, period: { start: '2026-09-14', end: '2026-10-11', days: 28, previous: {} },
    gsc_metrics: { status: 'UNAVAILABLE', reason: 'NO_PROPERTY_BOUND' }, ai_visibility: { GOLDEN: { status: 'UNAVAILABLE', reason: 'NO_GOLDEN_OBSERVATIONS' }, LAB: { status: 'UNAVAILABLE', reason: 'NO_LAB_RUNS' } }, competitors: { status: 'UNAVAILABLE', reason: 'NO_CONFIRMED_COMPETITORS' }, implementations: { status: 'UNAVAILABLE' }, next_actions: { status: 'UNAVAILABLE' }, data_provenance: [] };
  s.narrative = narrative(s);
  const html = renderReportHtml(s, { snapshotId: 'snap', hash: 'a'.repeat(64) });
  assert.ok(!html.includes('<script>x')); assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /Nenhuma propriedade do Search Console vinculada/);
  const text = html.replace(/data:[^)"]+/g, ''); assert.ok(!text.includes('undefined') && !text.includes('NaN'));
  assert.ok(!html.includes('Comparação competitiva')); // unavailable competitor section is omitted, not faked
  assert.match(s.narrative.join(' '), /ainda não estão disponíveis/);
});
test('narrative only states growth computed from the snapshot', () => {
  const s: any = { language: 'pt-BR', period: { start: '2026-09-14', end: '2026-10-11' }, ai_visibility: {}, gsc_metrics: { status: 'AVAILABLE', totals: { clicks: 120, impressions: 4000, ctr: 0.03 }, previous_totals: { clicks: 100, impressions: 5000 }, deltas: { impressions: { pct: -0.2 }, clicks: { pct: 0.2 } }, brand: null, hidden_query_share: null, opportunities: [] } };
  const t = narrative(s).join(' ');
  assert.match(t, /impressões caíram 20,0% e os cliques cresceram 20,0%/); assert.match(t, /não comprovam/);
});

test('OAuth client settings are format-checked before being stored', async () => {
  const { settingUpdateSchema } = await import('../lib/settings-schema');
  const ok = (values: Record<string, string>) => settingUpdateSchema.safeParse({ group: 'GOOGLE', values }).success;
  assert.equal(ok({ GOOGLE_CLIENT_ID: '123456789-abc123def.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-' + 'a'.repeat(28) }), true);
  assert.equal(ok({ GOOGLE_CLIENT_ID: 'GOCSPX-swapped', GOOGLE_CLIENT_SECRET: 'GOCSPX-' + 'a'.repeat(28) }), false);
  assert.equal(ok({ GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: '123-abc.apps.googleusercontent.com' }), false);
});

test('brand glued to the next word is branded; typos are not guessed', () => {
  const t = { brand: defaultBrandTerms('DCS Diagnósticos por Imagem', 'https://dcs.med.br/'), services: [], locations: [] };
  assert.equal(classifyQuery('dcsbirigui', t).branded, true);
  assert.equal(classifyQuery('idcs birigui', t).branded, false);
  assert.equal(classifyQuery('dsc birigui', t).branded, false);
  assert.equal(classifyQuery('dcs', t).branded, true);
});
