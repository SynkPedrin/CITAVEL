import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport, renderDashboard, classifyLead} from '../core/reports.mjs';

const config = {client_id: 'fixture', brand: 'Fictional Test Brand', domain: 'https://example.test', report_date: '2026-09-30T12:00:00Z'};

test('an empty client has unknown observational and business metrics, not invented zeros', () => {
  const report = buildReport({}, config);
  assert.equal(report.week, '2026-W40');
  assert.equal(report.metrics.GOLDEN.mention_rate, null);
  assert.equal(report.metrics.LAB.recommendation_coverage, null);
  assert.equal(report.metrics.business.revenue, null);
  assert.equal(report.metrics.business.ai_sourced_leads, null);
  assert.equal(report.metrics.analytics.ai_sessions, null);
  assert.equal(report.metrics.seo.indexed_pages, null);
  assert.equal(report.comparisons.GOLDEN.previous_week.mention_rate, null);
  assert.match(report.markdown, /GOLDEN/);
  assert.match(report.markdown, /LAB · USO INTERNO/);
  assert.match(renderDashboard({}, config), /Aguardando testes GOLDEN/);
});

test('GOLDEN and LAB stay separate and commercial coverage has an explicit denominator', () => {
  const report = buildReport({
    prompts: [{prompt_id: 'p1', commercial_score: 5}, {prompt_id: 'p2', commercial_score: 4}, {prompt_id: 'p3', commercial_score: 1}],
    ai_runs: [
      {run_type: 'GOLDEN', prompt_id: 'p1', brand_mentioned: true, brand_recommended: true, approx_position: 2, citations: ['https://example.test/about'], competitors: ['Other']},
      {run_type: 'GOLDEN', prompt_id: 'p2', brand_mentioned: false, brand_recommended: false, citations: [], competitors: ['Other']},
      {run_type: 'GOLDEN', prompt_id: 'p3', brand_mentioned: true, brand_recommended: true, citations: ['https://third.test/page'], competitors: []},
      {run_type: 'LAB', prompt_id: 'p1', brand_mentioned: true, brand_recommended: true, citations: [], competitors: []},
      {run_type: 'LAB', prompt_id: 'p2', brand_mentioned: false, brand_recommended: false, error: 'fixture failure'},
    ],
  }, config);
  assert.equal(report.metrics.GOLDEN.run_count, 3);
  assert.equal(report.metrics.GOLDEN.mention_rate, 2 / 3);
  assert.equal(report.metrics.GOLDEN.recommendation_coverage, 0.5);
  assert.equal(report.metrics.GOLDEN.money_prompt_coverage, 0.5);
  assert.equal(report.metrics.GOLDEN.citation_rate, 2 / 3);
  assert.equal(report.metrics.GOLDEN.owned_citation_rate, 1 / 3);
  assert.equal(report.metrics.LAB.run_count, 1);
  assert.equal(report.metrics.LAB.mention_rate, 1);
  assert.equal(report.recommendation_coverage, 0.5);
});

test('lead attribution requires evidence and correlated or assisted revenue is never sourced revenue', () => {
  assert.equal(classifyLead({source: 'https://chatgpt.com/'}), 'AI_SOURCED');
  assert.equal(classifyLead({source: 'https://notchatgpt.com/'}), 'UNATTRIBUTED');
  assert.equal(classifyLead({source: 'organic', ai_platform: 'ChatGPT'}), 'UNATTRIBUTED');
  assert.equal(classifyLead({self_reported_source: 'ChatGPT'}), 'AI_SOURCED');
  assert.equal(classifyLead({self_reported_source: 'O ChatGPT ajudou na pesquisa'}), 'AI_ASSISTED');
  const report = buildReport({leads: [
    {lead_id: '1', source: 'chatgpt.com', status: 'OPEN', opportunity_value: 4000},
    {lead_id: '2', self_reported_source: 'Perplexity', status: 'WON', opportunity_value: 1000, closed_value: 1000},
    {lead_id: '3', ai_assisted: true, attribution_class: 'AI_ASSISTED', opportunity_value: 3000, closed_value: 2000},
    {lead_id: '4', attribution_class: 'AI_CORRELATED', opportunity_value: 99000, closed_value: 99000},
    {lead_id: '5', source: 'organic', opportunity_value: 2000, closed_value: 2000},
  ]}, config);
  assert.equal(report.metrics.business.ai_sourced_leads, 2);
  assert.equal(report.metrics.business.ai_assisted_leads, 1);
  assert.equal(report.metrics.business.ai_correlated_leads, 1);
  assert.equal(report.metrics.business.pipeline, 4000);
  assert.equal(report.metrics.business.revenue, 1000);
  assert.equal(report.metrics.business.assisted_revenue, 2000);
});

test('indexability and Search Console traffic alone never imply indexation', () => {
  const base = {seo: [{url: 'https://example.test', status_code: 200, indexable: true, issues: []}], search_console: [{page: 'https://example.test', clicks: 3, impressions: 80}]};
  assert.equal(buildReport(base, config).metrics.seo.indexed_pages, null);
  assert.equal(buildReport({...base, search_console: [...base.search_console, {page: 'https://example.test', indexed: true}]}, config).metrics.seo.indexed_pages, 1);
});

test('week and baseline deltas are based on saved observations and missing weeks remain missing', () => {
  const state = {metrics: {GOLDEN: {run_count: 10, mention_rate: 0.5}}, reports: [
    {week: '2026-W37', is_baseline: true, metrics: {GOLDEN: {mention_rate: 0.2}}},
    {week: '2026-W39', metrics: {GOLDEN: {mention_rate: 0.4}}},
  ]};
  const report = buildReport(state, config);
  assert.ok(Math.abs(report.comparisons.GOLDEN.previous_week.mention_rate.delta - 0.1) < 1e-10);
  assert.equal(report.comparisons.GOLDEN.baseline.mention_rate.delta, 0.3);
  assert.equal(buildReport({...state, reports: state.reports.slice(0, 1)}, config).comparisons.GOLDEN.previous_week.mention_rate, null);
});

test('untrusted client and source data are escaped and unsafe links are inert', () => {
  const attack = '</textarea><script>alert("fixture")</script><img src=x onerror=alert(1)>';
  const html = renderDashboard({
    prompts: [{prompt_id: attack, prompt: attack, cluster: attack}],
    sources: [{url: 'javascript:alert(1)', domain: attack}],
    evidence: [{claim: attack, source_url: 'data:text/html,test'}],
    actions: [{title: attack, expected_signal: attack}],
    integration_status: {gemini: {status: 'READY', secret: 'DO_NOT_SERIALIZE_FIXTURE_SECRET'}},
  }, {...config, brand: attack});
  assert.ok(!html.includes('<script>alert('));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="data:'));
  assert.ok(!html.includes('DO_NOT_SERIALIZE_FIXTURE_SECRET'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 10);
});

test('explicit measured zeros remain zeros while absent inputs remain pending', () => {
  const report = buildReport({
    analytics: [{date: '2026-09-30', source: 'chatgpt.com', sessions: 0, conversions: 0}],
    leads: [{source: 'chatgpt.com', opportunity_value: 0, closed_value: 0, status: 'OPEN'}],
  }, config);
  assert.equal(report.metrics.business.revenue, 0);
  assert.equal(report.metrics.analytics.ai_sessions, 0);
  assert.equal(report.metrics.GOLDEN.mention_rate, null);
});

test('authoritative intelligence metrics and source snapshots retain the LAB/GOLDEN boundary', () => {
  const report = buildReport({
    metrics: {GOLDEN: {valid_runs: 5, mention_rate: 0.4, recommendation_coverage: 0.2}, LAB: {runs: 8, mention_rate: 1}},
    sources: [{run_type: 'GOLDEN', url: 'https://gold.test/new'}, {run_type: 'LAB', url: 'https://lab.test/new'}],
    reports: [{week: '2026-W39', source_snapshot: ['https://gold.test/old'], source_snapshot_type: 'GOLDEN'}],
  }, config);
  assert.equal(report.metrics.GOLDEN.run_count, 5);
  assert.equal(report.metrics.GOLDEN.mention_rate, 0.4);
  assert.equal(report.metrics.LAB.run_count, 8);
  assert.deepEqual(report.new_sources, ['https://gold.test/new']);
  assert.deepEqual(report.lost_sources, ['https://gold.test/old']);
  assert.deepEqual(report.lab_source_snapshot, ['https://lab.test/new']);
});

test('missing financial values and unknown opportunity status do not become known pipeline', () => {
  const report = buildReport({leads: [{source: 'chatgpt.com', opportunity_value: 6000, closed_value: ' '}]}, config);
  assert.equal(report.metrics.business.pipeline, null);
  assert.equal(report.metrics.business.revenue, null);
});
