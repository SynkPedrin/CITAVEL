import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompts, parseResponse, analyzeRuns, generateActions, createDraft, createExperiment } from '../core/intelligence.mjs';

const config = {
  client_id: 'fixture-client', brand: 'Marca Teste', domain: 'https://marca.example/',
  market: 'serviços imobiliários', priority_services: ['loteamentos'], locations: ['Cidade Fictícia'],
  competitors: [{ name: 'Rival Alfa', domain: 'https://rival.example/' }, { name: 'Rival Beta' }],
};
const prompts = [
  { prompt_id: 'money', prompt: 'Que empresa escolher?', commercial_score: 5, cluster: 'RECOMMENDATION', service: 'loteamentos', location: 'Cidade Fictícia' },
  { prompt_id: 'buy', prompt: 'Onde comprar?', commercial_score: 4, cluster: 'PURCHASE', service: 'loteamentos', location: 'Cidade Fictícia' },
  { prompt_id: 'learn', prompt: 'O que é?', commercial_score: 1, cluster: 'INFORMATIONAL', control_group: true },
];
const observation = (id, promptId, response, runType = 'LAB') => ({ run_id: id, prompt_id: promptId, response, run_type: runType, timestamp: '2026-01-10T00:00:00Z', platform: 'fixture', model: 'fixture' });

test('prompt universe is deterministic, bounded, scored, and uses eight clusters', () => {
  const first = generatePrompts(config);
  assert.equal(first.length, 40);
  assert.equal(new Set(first.map((prompt) => prompt.prompt_id)).size, 40);
  assert.equal(new Set(first.map((prompt) => prompt.cluster)).size, 8);
  assert.equal(first.filter((prompt) => prompt.commercial_score >= 4).length, 25);
  assert.deepEqual(first, generatePrompts(config));
  assert(first.every((prompt) => prompt.priority === `P${prompt.commercial_score}`));
  assert(!JSON.stringify(first).includes('entrega garantida'));
});

test('parser retains raw text and recognizes explicit recommendations and ranks', () => {
  const response = 'Recomendações:\n1. Rival Alfa — opção inicial.\n2. Marca Teste — consulte detalhes.\nFontes: https://marca.example/projeto e https://rival.example/';
  const run = parseResponse(observation('ranking', 'money', response), config, prompts);
  assert.equal(run.response, response);
  assert.equal(run.raw_response, response);
  assert.equal(run.brand_mentioned, true);
  assert.equal(run.brand_recommended, true);
  assert.equal(run.approx_position, 2);
  assert.equal(run.sentiment, 'POSITIVE');
  assert.equal(run.owned_domain_cited, true);
  assert.equal(run.competitors.length, 1);
  assert.equal(run.competitors[0].recommended, true);
  assert.equal(run.competitors[0].citation_count, 1);
});

test('parser does not reward mentions, questions, negated recommendations or unrelated endorsement', () => {
  const cases = [
    'A Marca Teste foi mencionada no diretório.',
    'Você recomenda a Marca Teste?',
    'Não recomendo a Marca Teste.',
    'Não posso recomendar a Marca Teste sem informações adicionais.',
    'Recomendo Rival Alfa. A Marca Teste consta na pesquisa.',
    'Talvez eu recomendaria a Marca Teste.',
    '1. Marca Teste — apenas uma entrada do cadastro.',
  ];
  for (const [index, response] of cases.entries()) {
    const run = parseResponse({ ...observation(`negative-${index}`, 'money', response), brand_recommended: true }, config, prompts);
    assert.equal(run.brand_mentioned, true, response);
    assert.equal(run.brand_recommended, false, response);
    assert.equal(run.approx_position, null, response);
  }
  assert.equal(parseResponse(observation('boundary', 'money', 'Marca TesteXYZ é citada.'), config, prompts).brand_mentioned, false);
  assert.equal(parseResponse(observation('neg', 'money', 'Não recomendo a Marca Teste.'), config, prompts).sentiment, 'NEGATIVE');
});

test('only explicit safe URLs become citations, with correct domain ownership and punctuation', () => {
  const response = 'Fonte [artigo](https://marca.example/guia?utm_source=fixture). Também https://marca.example.evil.example/foo. Um domínio sozinho: rival.example. Fonte https://pt.example/wiki/Nome_(exemplo).';
  const run = parseResponse({ ...observation('urls', 'money', response), citations: ['javascript:alert(1)', 'https://login:secret@marca.example/', { url: 'https://rival.example/fonte' }] }, config, prompts);
  assert.deepEqual(run.citations, [
    'https://marca.example.evil.example/foo', 'https://marca.example/guia',
    'https://pt.example/wiki/Nome_(exemplo)', 'https://rival.example/fonte',
  ]);
  assert.equal(run.owned_domain_cited, true);
  const spoof = parseResponse(observation('spoof', 'money', 'https://marca.example.evil.example/foo'), config, prompts);
  assert.equal(spoof.owned_domain_cited, false);
  assert.deepEqual(parseResponse(observation('bare', 'money', 'Fonte: marca.example'), config, prompts).citations, []);
});

test('competitor discovery requires observed names and marks unverified entities', () => {
  const run = parseResponse({ ...observation('discovery', 'money', 'Recomendações:\n1. Horizonte Urbanismo — consulte condições.\n2. Verifique documentos — leia com atenção.'), competitors: ['Fantasma Imóveis'] }, config, prompts);
  assert.equal(run.competitors.length, 1);
  assert.equal(run.competitors[0].name, 'Horizonte Urbanismo');
  assert.equal(run.competitors[0].recommended, true);
  assert.equal(run.competitors[0].needs_validation, true);
  assert.equal(run.competitors[0].domain, null);
});

test('metrics isolate LAB and GOLDEN and commercial coverage excludes informational runs', () => {
  const runs = [
    observation('lab-win', 'money', 'Recomendo a Marca Teste. https://marca.example/'),
    observation('lab-loss', 'buy', 'Recomendo Rival Alfa. https://rival.example/'),
    observation('lab-info', 'learn', 'A Marca Teste aparece no catálogo.'),
    observation('golden-loss', 'money', 'Recomendo Rival Beta.', 'GOLDEN'),
  ];
  const result = analyzeRuns(runs, prompts, config);
  assert.equal(result.metrics.LAB.runs, 3);
  assert.equal(result.metrics.LAB.eligible_commercial_runs, 2);
  assert.equal(result.metrics.LAB.recommendation_coverage, 0.5);
  assert.equal(result.metrics.LAB.mention_rate, 2 / 3);
  assert.equal(result.metrics.LAB.share_of_voice, 0.5);
  assert.equal(result.metrics.GOLDEN.runs, 1);
  assert.equal(result.metrics.GOLDEN.recommendation_coverage, 0);
  assert.equal(result.metrics.GOLDEN.share_of_voice, 0);
  assert.equal(result.gaps.length, 2);
  assert.deepEqual(new Set(result.gaps.map((gap) => gap.run_type)), new Set(['LAB', 'GOLDEN']));
  assert(result.gaps.every((gap) => gap.needs_validation === true && gap.source_run_ids.length === 1));
});

test('empty, failed, and unknown-prompt runs do not manufacture commercial observations', () => {
  const empty = analyzeRuns([], prompts, config);
  assert.equal(empty.metrics.LAB.mention_rate, null);
  assert.equal(empty.metrics.GOLDEN.recommendation_coverage, null);
  assert.equal(empty.metrics.LAB.share_of_voice, null);
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.gaps, []);
  const result = analyzeRuns([
    observation('empty', 'money', ''),
    { ...observation('failed', 'money', 'Recomendo a Marca Teste.'), error: 'TIMEOUT' },
    observation('unknown-prompt', 'unknown', 'Recomendo Rival Alfa.'),
  ], prompts, config);
  assert.equal(result.metrics.LAB.runs, 1);
  assert.equal(result.metrics.LAB.eligible_commercial_runs, 0);
  assert.equal(result.metrics.LAB.recommendation_coverage, null);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.excluded_runs.length, 2);
  assert.throws(() => parseResponse({ response: 'x', run_type: 'BLENDED' }, config), /Invalid run_type/);
});

test('source graph deduplicates run IDs and URLs, aggregates prompts and separates mode', () => {
  const runs = [
    observation('a', 'money', 'Recomendo Rival Alfa. https://rival.example/ https://rival.example/#same'),
    observation('b', 'buy', 'Recomendo Rival Alfa. https://rival.example/'),
    observation('c', 'money', 'Recomendo a Marca Teste. https://rival.example/', 'GOLDEN'),
  ];
  const result = analyzeRuns([...runs, runs[0]], prompts, config);
  assert.equal(result.metrics.LAB.runs, 2);
  assert.equal(result.sources.length, 2);
  const lab = result.sources.find((source) => source.run_type === 'LAB');
  const golden = result.sources.find((source) => source.run_type === 'GOLDEN');
  assert.equal(lab.citation_count, 2);
  assert.equal(lab.prompt_count, 2);
  assert.deepEqual(lab.competitors_present, ['Rival Alfa']);
  assert.equal(lab.opportunity_score, 90);
  assert.equal(golden.opportunity_score, 0);
  assert.notEqual(lab.source_id, golden.source_id);
  assert.match(lab.presence_scope, /Co-occurrence/);
  assert.equal(result.competitors.find((competitor) => competitor.run_type === 'LAB').recommendations, 2);
  const reusedIds = analyzeRuns([
    observation('external-id', 'money', 'Recomendo a Marca Teste.'),
    observation('external-id', 'money', 'Recomendo Rival Alfa.', 'GOLDEN'),
  ], prompts, config);
  assert.equal(reusedIds.metrics.LAB.recommendation_coverage, 1);
  assert.equal(reusedIds.metrics.GOLDEN.recommendation_coverage, 0);
});

test('actions are stable, prioritized and traceable to gaps or specific SEO observations', () => {
  const analysis = analyzeRuns([observation('loss', 'money', 'Recomendo Rival Alfa. https://rival.example/')], prompts, config);
  const seo = [{ url: 'https://marca.example/404', timestamp: '2026-01-10', issues: [{ code: 'HTTP_404', severity: 'CRITICAL', message: 'HTTP 404 observado.' }] }];
  const actions = generateActions(analysis.gaps, prompts, seo);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, 'TECHNICAL');
  assert.equal(actions[0].priority, 'HIGH');
  assert(actions[0].origin.seo_issue_id);
  const content = actions.find((action) => action.type === 'CONTENT');
  assert.equal(content.gap_id, analysis.gaps[0].gap_id);
  assert.deepEqual(content.affected_prompts, ['money']);
  assert.deepEqual(content.source_run_ids, ['loss']);
  assert.equal(content.priority, 'HIGH');
  assert.deepEqual(generateActions(analysis.gaps, prompts, seo), actions);
});

test('drafts require an authorized origin and exclude unverified/nonpublic evidence', () => {
  const analysis = analyzeRuns([observation('loss', 'money', 'Recomendo Rival Alfa.')], prompts, config);
  const action = generateActions(analysis.gaps, prompts)[0];
  const evidence = [
    { evidence_id: 'public', claim: 'Documento público validado', value: 'Fato de teste comprovado', source_url: 'https://marca.example/documento', verified: true, public_allowed: true },
    { evidence_id: 'unverified', claim: 'Entrega garantida em 30 dias', source_url: 'https://marca.example/promessa', verified: false, public_allowed: true },
    { evidence_id: 'private', claim: 'Dado confidencial', source_type: 'manual', verified: true, public_allowed: false },
    { evidence_id: 'string-bool', claim: 'Fato sem validação booleana', source_type: 'manual', verified: 'true', public_allowed: true },
    { evidence_id: 'other-client', client_id: 'someone-else', claim: 'Fato de outra empresa', source_type: 'manual', verified: true, public_allowed: true },
  ];
  const draft = createDraft(config, action, evidence, prompts);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.auto_publish, false);
  assert.equal(draft.indexable, false);
  assert.deepEqual(draft.metadata.source_evidence_ids, ['public']);
  assert(draft.markdown.includes('Fato de teste comprovado'));
  assert(draft.markdown.includes('[INFORMAÇÃO NECESSÁRIA]'));
  for (const forbidden of ['Entrega garantida', 'Dado confidencial', 'Fato sem validação booleana', 'Fato de outra empresa']) {
    assert(!JSON.stringify(draft).includes(forbidden));
  }
  assert.equal(draft.page_id, createDraft(config, action, evidence, prompts).page_id);
  assert.equal(draft.experiment.intervention_prompts.includes('money'), true);
  assert.deepEqual(draft.experiment.control_prompts, ['learn']);
  assert.match(draft.html, /noindex,nofollow/);
  assert.throws(() => createDraft(config, { action_id: 'arbitrary' }, evidence, prompts), /gap-linked/);
  assert.throws(() => createDraft(config, { ...action, status: 'REJECTED' }, evidence, prompts), /rejected/);
});

test('empty evidence yields only placeholders; HTML escapes verified content', () => {
  const action = { action_id: 'approved', approved_strategy: true, affected_prompts: ['buy'] };
  const empty = createDraft(config, action, [], prompts);
  assert.deepEqual(empty.source_evidence_ids, []);
  assert.deepEqual(empty.sources_used, []);
  const withMarkup = createDraft(config, action, [{ evidence_id: 'e1', claim: '<script>alert(1)</script>', source_type: 'manual', verified: true, public_allowed: true }], prompts);
  assert(!withMarkup.html.includes('<script>alert(1)</script>'));
  assert(withMarkup.html.includes('&lt;script&gt;'));
  assert.deepEqual(createExperiment(config, action, prompts), empty.experiment);
});
