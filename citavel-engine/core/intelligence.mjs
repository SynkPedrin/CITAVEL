import { createHash } from 'node:crypto';

/**
 * Deterministic, local intelligence. Rates are fractions in [0, 1], or null when
 * there is no denominator. LAB and GOLDEN observations are never pooled.
 * A citation means an explicit URL supplied with the observation, not an
 * independent verification that a model retrieved or endorsed the page.
 */
export const METRIC_DEFINITIONS = Object.freeze({
  mention_rate: 'Runs with a brand mention / valid runs, within one run_type.',
  recommendation_coverage: 'Commercial runs recommending brand / commercial runs (commercial_score >= 4).',
  money_prompt_coverage: 'Distinct observed commercial prompts with at least one recommendation / distinct observed commercial prompts, within one run_type.',
  top3_recommendation_rate: 'Commercial runs explicitly ranking brand 1–3 / commercial runs.',
  citation_rate: 'Runs containing any explicit HTTP(S) citation / valid runs.',
  owned_citation_rate: 'Runs citing the configured domain or a subdomain / valid runs.',
  third_party_citation_rate: 'Runs citing any other domain / valid runs.',
  share_of_voice: 'Brand recommendation occurrences / (brand + observed competitor recommendation occurrences). Each entity counts at most once per run.',
  source_opportunity_score: 'Within each run_type: 100 * (source citation_count / maximum source citation_count) * (mean observed commercial_score / 5) * (0.5 + 0.5 * competitor-run fraction) * (1 - brand-mentioned-run fraction). Round to integer. Heuristic opportunity, not a scientific ranking score.',
});

const hash = (prefix, value) => `${prefix}_${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)}`;
const unique = (values) => [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const clean = (value) => text(value).replace(/\s+/g, ' ').trim();
const fold = (value) => clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const label = (item) => typeof item === 'string' ? item : item?.name || item?.service || item?.value || '';
const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [value]; } catch { return value ? [value] : []; }
  }
  return value ? [value] : [];
};
const contains = (body, entity) => !!entity && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(fold(entity))}(?=$|[^\\p{L}\\p{N}])`, 'u').test(fold(body));
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const dateOf = (run) => run.timestamp || run.created_at || null;

function normalizeCitation(value) {
  try {
    const u = new URL(clean(value));
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch { return null; }
}

const domainOf = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
};
const owned = (url, config) => {
  const host = domainOf(url), own = domainOf(config?.domain);
  return !!(host && own && (host === own || host.endsWith(`.${own}`)));
};

/** Creates exactly 40 auditable questions. Config supplies topic labels, not asserted commercial claims. */
export function generatePrompts(config, evidence = []) {
  if (!config?.client_id || !config?.brand) throw new Error('client_id and brand are required to generate prompts');
  const location = asArray(config.locations).map(label).filter(Boolean)[0] || config.location || '[LOCALIDADE A DEFINIR]';
  const services = asArray(config.priority_services).map(label).filter(Boolean);
  const brand = config.brand;
  const locationText = clean(location);
  // Multi-vertical clients: each cluster takes the next priority service so
  // Money Prompts span every vertical instead of repeating the first one.
  const chosen = services.length ? services : [config.market || '[SERVIÇO A DEFINIR]'];
  const clusters = [
    ['INFORMATIONAL', 1, 'INFORMATIONAL', [
      `O que avaliar antes de pesquisar %SERVICE% em ${locationText}?`,
      `Quais documentos consultar ao avaliar %SERVICE% em ${locationText}?`,
      `Como entender as etapas de contratação ou compra de %SERVICE%?`,
      `Que perguntas fazer a uma empresa de %SERVICE% antes de contratar?`,
      `Como verificar informações publicadas sobre %SERVICE% em ${locationText}?`,
    ]],
    ['PROBLEM', 2, 'PROBLEM', [
      `Como reduzir dúvidas ao escolher uma empresa de %SERVICE% em ${locationText}?`,
      `O que fazer quando faltam informações sobre %SERVICE% em ${locationText}?`,
      `Como comparar propostas de %SERVICE% com condições diferentes?`,
      `Como verificar se uma empresa de %SERVICE% é adequada ao meu caso?`,
      `Quais sinais de atenção observar antes de decidir sobre %SERVICE%?`,
    ]],
    ['CATEGORY', 3, 'CONSIDERATION', [
      `Quais empresas atuam com %SERVICE% em ${locationText} e onde confirmar essa atuação?`,
      `Quais opções de %SERVICE% devo pesquisar em ${locationText}?`,
      `Que critérios usar para selecionar empresas de %SERVICE%?`,
      `Quais fontes independentes consultar sobre empresas de %SERVICE% em ${locationText}?`,
      `Que evidências ajudam a avaliar uma empresa de %SERVICE%?`,
    ]],
    ['COMPARISON', 4, 'PURCHASE', [
      `Quais empresas de %SERVICE% comparar antes de comprar em ${locationText}?`,
      `Como comparar a ${brand} com outras opções de %SERVICE% em ${locationText}, usando fontes verificáveis?`,
      `Quais fornecedores de %SERVICE% em ${locationText} apresentam informações suficientes para uma decisão de compra?`,
      `Ao contratar %SERVICE% em ${locationText}, como comparar atendimento, documentação e condições comprovadas?`,
      `Qual empresa de %SERVICE% em ${locationText} vale incluir numa lista de compra e por quê?`,
    ]],
    ['PURCHASE', 4, 'PURCHASE', [
      `Onde encontrar opções de %SERVICE% para comprar ou contratar em ${locationText}?`,
      `Com quais empresas falar para solicitar uma proposta de %SERVICE% em ${locationText}?`,
      `Como solicitar informações comerciais verificáveis sobre %SERVICE% em ${locationText}?`,
      `Quais opções de %SERVICE% em ${locationText} devo avaliar antes de fechar negócio?`,
      `Onde confirmar disponibilidade, documentação e condições para contratar %SERVICE% em ${locationText}?`,
    ]],
    ['RECOMMENDATION', 5, 'RECOMMENDATION', [
      `Quais empresas você recomenda pesquisar para %SERVICE% em ${locationText}? Cite suas fontes.`,
      `Que empresa de %SERVICE% em ${locationText} você recomendaria para uma primeira consulta e por quê?`,
      `Recomende até três opções de %SERVICE% em ${locationText}, distinguindo fatos confirmados de lacunas.`,
      `A ${brand} deve entrar numa lista de opções de %SERVICE% em ${locationText}? Use apenas evidências verificáveis.`,
      `Quais empresas de %SERVICE% em ${locationText} têm evidências públicas suficientes para você recomendar uma avaliação comercial?`,
    ]],
    ['LOCAL', 5, 'RECOMMENDATION', [
      `Quais empresas locais procurar para %SERVICE% em ${locationText}?`,
      `Quem você recomenda contatar sobre %SERVICE% na região de ${locationText}?`,
      `Onde buscar uma proposta de %SERVICE% em ${locationText}, com fontes para verificar a empresa?`,
      `Que opções de %SERVICE% em ${locationText} devem compor minha lista inicial de fornecedores?`,
      `Recomende empresas para pesquisar %SERVICE% em ${locationText} sem presumir disponibilidade ou preços.`,
    ]],
    ['CONTEXTUAL', 4, 'PURCHASE', [
      `Se eu estiver começando a pesquisar %SERVICE% em ${locationText}, quais empresas devo contatar primeiro?`,
      `Para uma decisão de compra informada de %SERVICE% em ${locationText}, quais opções e fontes comparar?`,
      `Se a prioridade for clareza das informações, quais empresas de %SERVICE% em ${locationText} devo avaliar?`,
      `Que empresas de %SERVICE% em ${locationText} devo consultar para esclarecer documentação e condições?`,
      `Antes de contratar %SERVICE% em ${locationText}, quais opções você incluiria numa comparação fundamentada?`,
    ]],
  ];
  const sourceIds = evidence.filter((e) => e.verified === true && e.public_allowed === true).map((e) => e.evidence_id).filter(Boolean);
  return clusters.flatMap(([cluster, score, intent, templates], clusterIndex) => {
    const serviceText = clean(chosen[clusterIndex % chosen.length]);
    return templates.map((template, index) => {
      const prompt = template.replaceAll('%SERVICE%', serviceText);
      return {
        prompt_id: hash('pr', [config.client_id, cluster, prompt]), client_id: config.client_id,
        cluster, prompt, intent, commercial_score: score, priority: `P${score}`,
        service: serviceText, location: locationText, active: true, control_group: index === 4,
        source_evidence_ids: sourceIds, generation_method: 'deterministic_question_templates_v1',
      };
    });
  });
}

function citationList(run, response) {
  const raw = response.match(/https?:\/\/[^\s<>"'\]\}]+/gi) || [];
  const supplied = asArray(run.citations).flatMap((item) => typeof item === 'string' ? [item] : [item?.url || item?.uri || item?.web?.uri]);
  const grounded = asArray(run.groundingMetadata?.groundingChunks || run.grounding_metadata?.grounding_chunks)
    .map((item) => item?.web?.uri || item?.web?.url);
  return unique([...raw, ...supplied, ...grounded].map((value) => {
    let candidate = clean(value).replace(/[.,;:!?]+$/, '');
    // Markdown's closing parenthesis is not part of the target URL. Balanced
    // parentheses within a path (e.g. Wikipedia pages) remain intact.
    while (candidate.endsWith(')') && (candidate.match(/\)/g) || []).length > (candidate.match(/\(/g) || []).length) candidate = candidate.slice(0, -1);
    return normalizeCitation(candidate);
  })).sort();
}

function entityAssessment(response, entity) {
  if (!contains(response, entity)) return { mentioned: false, recommended: false, position: null, sentiment: 'UNKNOWN', supporting_text: [] };
  const lines = response.split(/\r?\n/);
  const supporting = [];
  let positive = false, negative = false, recommended = false;
  const positions = [];
  const positiveRe = /\b(recomendo|recomendamos|recomenda(?:do|da|dos|das)|recomendaria|sugiro|sugerimos|indico|indicamos|considere|vale(?: a pena)? (?:consultar|avaliar|considerar)|boa (?:opcao|escolha)|boas opcoes|melhor(?:es)? (?:opcao|escolha|empresa)|top(?:\s+\d+)? (?:opcoes|empresas))\b/;
  const negationRe = /\b(nao|nunca|sem|evit(?:e|ar)|desaconselh|nao posso|nao e possivel|nao tenho|nao ha)\b/;
  const uncertaintyRe = /\b(talvez|hipotetic|poderia|se fosse|caso fosse|nao confirmado|nao verificado|desconheco)\b/;
  const negativeRe = /\b(nao recomendo|nao recomendamos|nao recomendaria|evite|desaconselho|experiencia negativa)\b/;
  let recommendationHeading = false;
  for (const line of lines) {
    const normalizedLine = fold(line);
    if (!line.trim()) continue;
    const numbered = line.match(/^\s*(?:[-*]\s*)?(\d{1,2})[.)]\s+(.+)$/);
    if (!numbered && /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?(?:minhas |as |algumas |principais )?(?:recomendacoes|opcoes recomendadas|empresas recomendadas|melhores opcoes|melhores empresas)\b/i.test(fold(line))) {
      recommendationHeading = !negationRe.test(normalizedLine);
    } else if (/^\s*#{1,6}\s+/.test(line) && !positiveRe.test(normalizedLine)) recommendationHeading = false;
    if (!contains(line, entity)) continue;
    // Sentence-local checks avoid borrowing another company's endorsement.
    const clauses = line.split(/(?<=[.!?;])\s+|\s+(?:mas|por[eé]m|contudo)\s+/u).filter((part) => contains(part, entity));
    for (const clause of clauses) {
      const normalized = fold(clause);
      supporting.push(clean(clause));
      if (negativeRe.test(normalized)) negative = true;
      const safe = !negationRe.test(normalized) && !uncertaintyRe.test(normalized) && !/\?\s*$/.test(clause);
      const explicit = safe && positiveRe.test(normalized);
      const ranked = safe && numbered && recommendationHeading;
      if (explicit || ranked) {
        recommended = true;
        positive = true;
        if (numbered) positions.push(Number(numbered[1]));
      }
    }
  }
  // Conflicting positive/negative assertions require human review; do not award a recommendation.
  if (negative) recommended = false;
  return {
    mentioned: true, recommended, position: recommended && positions.length ? Math.min(...positions) : null,
    sentiment: positive && negative ? 'MIXED' : negative ? 'NEGATIVE' : positive ? 'POSITIVE' : 'NEUTRAL',
    supporting_text: unique(supporting),
  };
}

function configuredCompetitors(config) {
  return asArray(config.competitors).map((entry) => typeof entry === 'string' ? { name: entry } : entry)
    .filter((entry) => entry?.name && fold(entry.name) !== fold(config.brand));
}

function observedCompetitorCandidates(run, response, config) {
  const supplied = asArray(run.competitors).map((entry) => typeof entry === 'string' ? { name: entry } : entry)
    .filter((entry) => entry?.name && contains(response, entry.name))
    .map((entry) => ({ name: entry.name, identification_method: 'supplied_name_observed', needs_validation: true }));
  const listed = [];
  for (const line of response.split(/\r?\n/)) {
    const match = line.match(/^\s*\d{1,2}[.)]\s+(?:\*\*)?([^:\n—–]{2,80}?)(?:\*\*)?(?:\s*[:—–]\s|\s+-\s)/u);
    if (!match) continue;
    const name = clean(match[1]).replace(/\*\*/g, '');
    // Candidate discovery stays conservative. It is never treated as a
    // verified business fact; a reviewer must confirm the entity and domain.
    if (!/^[\p{Lu}\p{N}][\p{L}\p{N}&.'’ -]+$/u.test(name) || name.split(/\s+/).length > 7) continue;
    if (/^(?:uma?|as?|os?|outras?|empresas? locais?|op[cç][oõ]es|pesquise|consulte|verifique|nao|não|recomendo|procure|escolha|documenta[cç][aã]o|pre[cç]o|atendimento)\b/i.test(name)) continue;
    if (entityAssessment(response, name).recommended) listed.push({ name, identification_method: 'explicit_recommendation_list_candidate', needs_validation: true });
  }
  return [...new Map([...listed, ...supplied, ...configuredCompetitors(config)]
    .filter((entry) => fold(entry.name) !== fold(config.brand))
    .map((entry) => [fold(entry.name), entry])).values()];
}

/** Does not trust imported booleans or infer a citation from a mere domain name. */
export function parseResponse(run, config, prompts = []) {
  if (!run || typeof run !== 'object') throw new Error('AI run must be an object');
  if (!config?.brand) throw new Error('Client brand is required to parse responses');
  if (run.client_id && run.client_id !== config.client_id) throw new Error('AI run belongs to a different client');
  const runType = clean(run.run_type || 'LAB').toUpperCase();
  if (!['LAB', 'GOLDEN'].includes(runType)) throw new Error(`Invalid run_type: ${runType}`);
  const response = text(run.raw_response ?? run.response ?? run.text ?? '');
  const prompt = prompts.find((p) => p.prompt_id === run.prompt_id);
  const citations = citationList(run, response);
  const brand = entityAssessment(response, config.brand);
  const competitors = observedCompetitorCandidates(run, response, config).map((competitor) => {
    const aliases = unique([competitor.name, ...asArray(competitor.aliases)]);
    const observations = aliases.map((alias) => entityAssessment(response, alias));
    if (!observations.some((observation) => observation.mentioned)) return null;
    return {
      competitor_id: competitor.competitor_id || hash('co', [config.client_id, fold(competitor.name)]),
      name: competitor.name, domain: domainOf(competitor.domain) || null, mentioned: true,
      recommended: observations.some((observation) => observation.recommended),
      approx_position: observations.map((observation) => observation.position).filter((position) => position !== null).sort((a, b) => a - b)[0] ?? null,
      citation_count: citations.filter((url) => competitor.domain && owned(url, competitor)).length,
      supporting_text: unique(observations.flatMap((observation) => observation.supporting_text)),
      identification_method: competitor.identification_method || 'configured_name_observed',
      needs_validation: competitor.needs_validation === true,
    };
  }).filter(Boolean);
  const valid = !!response.trim() && run.valid !== false && !run.error && !['ERROR', 'FAILED', 'SKIPPED', 'PENDING', 'CANCELLED', 'CANCELED'].includes(clean(run.status).toUpperCase());
  const runId = run.run_id || hash('run', [config.client_id, runType, run.platform || 'unknown', run.model || 'unknown', run.prompt_id || null, dateOf(run), response]);
  return {
    ...run,
    run_id: runId,
    client_id: config.client_id, timestamp: dateOf(run), platform: run.platform || 'unknown', model: run.model || 'unknown',
    prompt_id: run.prompt_id || null, response, raw_response: response, run_type: runType,
    commercial_score: prompt ? finite(prompt.commercial_score) : null,
    brand_mentioned: brand.mentioned, brand_recommended: valid && brand.recommended,
    approx_position: valid ? brand.position : null, sentiment: brand.sentiment, citations, competitors,
    owned_domain_cited: citations.some((url) => owned(url, config)), owned_site_cited: citations.some((url) => owned(url, config)),
    brand_supporting_text: brand.supporting_text,
    claims: brand.supporting_text.map((claim) => ({ claim, verified: false, public_allowed: false, source_run_id: runId })),
    valid, parser_version: 'deterministic_conservative_v1',
    parser_limitations: ['Explicit textual endorsements only; no inferred sentiment beyond local text.', 'Discovered competitor candidates require human entity/domain confirmation.', 'An explicit URL is observed citation data, not proof of retrieval.'],
  };
}

// Exported for the Action Engine baseline/result snapshots. Formulas unchanged.
export function aggregateMetrics(runs, prompts, config) {
  const commercial = runs.filter((run) => finite(prompts.find((p) => p.prompt_id === run.prompt_id)?.commercial_score) >= 4);
  const recommended = runs.filter((run) => run.brand_recommended).length;
  const competitorRecommendations = runs.reduce((sum, run) => sum + run.competitors.filter((competitor) => competitor.recommended).length, 0);
  return {
    runs: runs.length, valid_runs: runs.length, eligible_commercial_runs: commercial.length,
    brand_mentions: runs.filter((run) => run.brand_mentioned).length, brand_recommendations: recommended,
    commercial_recommendations: commercial.filter((run) => run.brand_recommended).length,
    competitor_recommendations: competitorRecommendations,
    mention_rate: ratio(runs.filter((run) => run.brand_mentioned).length, runs.length),
    recommendation_coverage: ratio(commercial.filter((run) => run.brand_recommended).length, commercial.length),
    top3_recommendation_rate: ratio(commercial.filter((run) => run.brand_recommended && run.approx_position !== null && run.approx_position >= 1 && run.approx_position <= 3).length, commercial.length),
    citation_rate: ratio(runs.filter((run) => run.citations.length).length, runs.length),
    owned_citation_rate: ratio(runs.filter((run) => run.owned_domain_cited).length, runs.length),
    third_party_citation_rate: ratio(runs.filter((run) => run.citations.some((url) => !owned(url, config))).length, runs.length),
    share_of_voice: ratio(recommended, recommended + competitorRecommendations),
    money_prompt_coverage: ratio(unique(commercial.filter((run) => run.brand_recommended).map((run) => run.prompt_id)).length, unique(commercial.map((run) => run.prompt_id)).length),
    unique_prompts: unique(runs.map((run) => run.prompt_id)).length,
  };
}

/** Graph records include run_type in their IDs; they cannot accidentally pool LAB and GOLDEN. */
export function analyzeRuns(inputRuns = [], prompts = [], config) {
  if (!config?.client_id) throw new Error('client_id is required to analyze runs');
  const parsed = inputRuns.map((run) => parseResponse(run, config, prompts));
  const deduplicated = [...new Map(parsed.map((run) => [`${run.run_type}:${run.run_id}`, run])).values()];
  const runs = deduplicated.filter((run) => run.valid);
  const metrics = Object.fromEntries(['LAB', 'GOLDEN'].map((type) => [type, aggregateMetrics(runs.filter((run) => run.run_type === type), prompts, config)]));
  const sourceMap = new Map(), competitorMap = new Map(), losses = new Map();
  for (const run of runs) {
    const prompt = prompts.find((p) => p.prompt_id === run.prompt_id);
    for (const url of run.citations) {
      const sourceId = hash('src', [config.client_id, run.run_type, url]);
      if (!sourceMap.has(sourceId)) sourceMap.set(sourceId, {
        source_id: sourceId, run_type: run.run_type, domain: domainOf(url), url,
        source_type: owned(url, config) ? 'OWNED' : 'THIRD_PARTY', citation_count: 0,
        prompts: [], run_ids: [], competitors_present: [], client_present: false, client_absent_runs: 0,
        competitor_runs: 0, commercial_scores: [], last_seen: null,
      });
      const source = sourceMap.get(sourceId);
      source.citation_count += 1;
      source.prompts.push(run.prompt_id);
      source.run_ids.push(run.run_id);
      source.competitors_present.push(...run.competitors.map((competitor) => competitor.name));
      source.client_present ||= run.brand_mentioned;
      source.client_absent_runs += run.brand_mentioned ? 0 : 1;
      source.competitor_runs += run.competitors.length ? 1 : 0;
      source.commercial_scores.push(clamp(finite(prompt?.commercial_score), 0, 5));
      if (run.timestamp && (!source.last_seen || run.timestamp > source.last_seen)) source.last_seen = run.timestamp;
    }
    for (const competitor of run.competitors) {
      const id = hash('cgraph', [config.client_id, run.run_type, competitor.competitor_id]);
      if (!competitorMap.has(id)) competitorMap.set(id, {
        competitor_id: id, entity_id: competitor.competitor_id, run_type: run.run_type,
        name: competitor.name, domain: competitor.domain, mentions: 0, recommendations: 0, citation_count: 0,
        prompts: [], run_ids: [], share_of_voice: null, last_seen: null,
      });
      const row = competitorMap.get(id);
      row.mentions += 1; row.recommendations += competitor.recommended ? 1 : 0;
      row.citation_count += competitor.citation_count; row.prompts.push(run.prompt_id); row.run_ids.push(run.run_id);
      if (run.timestamp && (!row.last_seen || run.timestamp > row.last_seen)) row.last_seen = run.timestamp;
    }
    // A missing result, unknown prompt, informational response or error is not
    // evidence of a commercial loss. Causes remain hypotheses for review.
    if (prompt && finite(prompt.commercial_score) >= 4 && !run.brand_recommended) {
      const id = hash('gap', [config.client_id, run.run_type, run.prompt_id, 'EVIDENCE_GAP']);
      if (!losses.has(id)) losses.set(id, {
        gap_id: id, client_id: config.client_id, run_type: run.run_type, prompt_id: run.prompt_id,
        gap_type: 'EVIDENCE_GAP', description: `Ausência de recomendação explícita de ${config.brand} no prompt comercial observado. Revisar evidências e cobertura antes de atribuir uma causa.`,
        reason: 'The recorded response does not explicitly recommend the client. This does not establish a content, technical, reputation or product defect.',
        competitor: [], supporting_sources: [], source_run_ids: [], evidence: [],
        severity: finite(prompt.commercial_score) === 5 ? 'HIGH' : 'MEDIUM', confidence: 0.6,
        commercial_score: finite(prompt.commercial_score), status: 'OPEN', needs_validation: true,
        recommended_action: 'Revisar a resposta e as fontes, validar evidências comerciais e preparar um brief vinculado ao prompt; publicar somente após revisão.',
      });
      const loss = losses.get(id);
      loss.competitor.push(...run.competitors.filter((competitor) => competitor.recommended).map((competitor) => competitor.name));
      loss.supporting_sources.push(...run.citations);
      loss.source_run_ids.push(run.run_id);
      loss.evidence.push({ run_id: run.run_id, observation: 'brand_recommended=false', competitor_recommendations: run.competitors.filter((competitor) => competitor.recommended).map((competitor) => competitor.name) });
    }
  }
  const sources = [...sourceMap.values()].map((source) => {
    const maxFrequency = Math.max(1, ...[...sourceMap.values()].filter((candidate) => candidate.run_type === source.run_type).map((candidate) => candidate.citation_count));
    const meanScore = source.commercial_scores.reduce((sum, score) => sum + score, 0) / source.citation_count;
    const factors = {
      frequency: source.citation_count / maxFrequency,
      commercial_weight: meanScore / 5,
      competitor_presence: 0.5 + 0.5 * source.competitor_runs / source.citation_count,
      client_absence: source.client_absent_runs / source.citation_count,
    };
    return {
      ...source, prompts: unique(source.prompts).sort(), prompt_count: unique(source.prompts).length,
      run_ids: unique(source.run_ids).sort(), competitors_present: unique(source.competitors_present).sort(),
      opportunity_score: clamp(Math.round(100 * factors.frequency * factors.commercial_weight * factors.competitor_presence * factors.client_absence), 0, 100),
      opportunity_factors: factors, opportunity_formula: METRIC_DEFINITIONS.source_opportunity_score,
      presence_scope: 'Co-occurrence in the AI response; source page content has not been inspected.',
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score || a.source_id.localeCompare(b.source_id));
  const competitors = [...competitorMap.values()].map((competitor) => ({
    ...competitor, prompts: unique(competitor.prompts).sort(), run_ids: unique(competitor.run_ids).sort(),
    share_of_voice: ratio(competitor.recommendations, metrics[competitor.run_type].brand_recommendations + metrics[competitor.run_type].competitor_recommendations),
  })).sort((a, b) => b.recommendations - a.recommendations || a.name.localeCompare(b.name));
  const gaps = [...losses.values()].map((loss) => ({
    ...loss, competitor: unique(loss.competitor).sort(), supporting_sources: unique(loss.supporting_sources).sort(), source_run_ids: unique(loss.source_run_ids).sort(),
  })).sort((a, b) => b.commercial_score - a.commercial_score || a.gap_id.localeCompare(b.gap_id));
  return {
    metrics, sources, competitors, gaps, definitions: METRIC_DEFINITIONS,
    input_runs: inputRuns.length, unique_runs: deduplicated.length, excluded_runs: deduplicated.filter((run) => !run.valid).map((run) => run.run_id),
  };
}

const actionType = (gapType) => ({
  TECHNICAL_GAP: 'TECHNICAL', CONTENT_GAP: 'CONTENT', ENTITY_GAP: 'ENTITY', EVIDENCE_GAP: 'CONTENT',
  SOURCE_GAP: 'AUTHORITY', REPUTATION_GAP: 'REPUTATION', CONVERSION_GAP: 'CONVERSION',
})[gapType] || 'CONTENT';

// Action Engine contract fields. action_type uses the contract enum (SOURCE, not
// the legacy internal label AUTHORITY); `type` is kept untouched for compatibility.
const contractActionType = (type) => type === 'AUTHORITY' ? 'SOURCE' : type;
const automationLevel = (type) => ['SOURCE', 'REPUTATION', 'CONVERSION'].includes(contractActionType(type)) ? 'HUMAN_ACTION' : 'APPROVAL_REQUIRED';
// Default risk is conservative: interventions that touch the site or public
// reputation start MEDIUM; everything else starts LOW. Humans can raise it.
const defaultRisk = (type) => ['TECHNICAL', 'REPUTATION'].includes(contractActionType(type)) ? 'MEDIUM' : 'LOW';
const actionEngineFields = (type, createdAt) => {
  const action_type = contractActionType(type);
  const automation_level = automationLevel(type);
  return {
    action_type, automation_level, approval_required: automation_level !== 'AUTOMATIC', risk: defaultRisk(type),
    affected_urls: [], preview: null, execution: null, deployment: null,
    lifecycle: [{ status: 'PROPOSED', at: createdAt, actor: 'engine', note: 'Ação gerada a partir da origem registrada.' }],
  };
};

/** Every action carries the gap, observation or SEO issue that originated it. */
export function generateActions(gaps = [], prompts = [], seo = []) {
  const fromGaps = gaps.filter((gap) => gap?.gap_id).map((gap) => {
    const affected = unique([gap.prompt_id, ...asArray(gap.affected_prompts)]).sort();
    const matching = prompts.filter((prompt) => affected.includes(prompt.prompt_id));
    const score = Math.max(0, ...matching.map((prompt) => finite(prompt.commercial_score)), finite(gap.commercial_score));
    const severity = typeof gap.severity === 'number' ? clamp(gap.severity, 0, 1) : ({ CRITICAL: 1, HIGH: 0.9, MEDIUM: 0.6, WARNING: 0.6, LOW: 0.3 })[gap.severity] || 0.5;
    const confidence = clamp(finite(gap.confidence, 0.5), 0, 1);
    const effort = clamp(finite(gap.effort_estimate, 2), 1, 5);
    const priorityScore = Math.round(100 * (0.35 * score / 5 + 0.3 * severity + 0.15 * Math.min(affected.length / 5, 1) + 0.2 * confidence) / Math.sqrt(effort));
    return {
      action_id: hash('act', [gap.gap_id, actionType(gap.gap_type)]), client_id: gap.client_id || null,
      gap_id: gap.gap_id, type: actionType(gap.gap_type), priority: priorityScore >= 50 ? 'HIGH' : priorityScore >= 30 ? 'MEDIUM' : 'LOW',
      priority_score: priorityScore, priority_formula: '100 * (0.35*commercial/5 + 0.30*severity + 0.15*min(prompt_count/5,1) + 0.20*confidence) / sqrt(effort[1..5])',
      title: gap.gap_type === 'EVIDENCE_GAP' ? 'Validar evidências e preparar brief para demanda comercial observada' : `Resolver ${gap.gap_type || 'gap'} observado`,
      description: gap.recommended_action || gap.description || 'Revisar o dado de origem e definir uma intervenção verificável.',
      affected_prompts: affected, source_run_ids: unique(asArray(gap.source_run_ids)), supporting_sources: unique(asArray(gap.supporting_sources)),
      expected_signal: actionType(gap.gap_type) === 'TECHNICAL' ? 'indexability / retrieval' : 'citation / recommendation',
      status: 'PROPOSED', owner: null, created_at: gap.created_at || null, completed_at: null,
      confidence, effort_estimate: effort, run_type: gap.run_type || null,
      requires_evidence_validation: gap.needs_validation !== false,
      origin: { gap_id: gap.gap_id, prompt_ids: affected, run_ids: unique(asArray(gap.source_run_ids)) },
      ...actionEngineFields(actionType(gap.gap_type), gap.created_at || null),
    };
  });
  const technical = seo.flatMap((row) => asArray(row.issues).filter((issue) => issue && !(typeof issue === 'object' && issue.severity === 'OK')).map((issue) => {
    const code = typeof issue === 'string' ? issue : issue.code || issue.type || issue.message;
    const severity = typeof issue === 'object' ? issue.severity : 'WARNING';
    const issueId = typeof issue === 'object' && issue.issue_id || hash('seo', [row.url, code]);
    return {
      action_id: hash('act', [issueId, 'TECHNICAL']), gap_id: null, type: 'TECHNICAL',
      priority: severity === 'CRITICAL' ? 'HIGH' : severity === 'OPPORTUNITY' ? 'LOW' : 'MEDIUM',
      priority_score: severity === 'CRITICAL' ? 90 : severity === 'OPPORTUNITY' ? 20 : 45,
      title: `Revisar ${clean(code)} em ${row.url || '[URL NECESSÁRIA]'}`,
      description: typeof issue === 'object' ? issue.message || issue.description || clean(code) : issue,
      affected_prompts: [], expected_signal: 'indexability / retrieval', status: 'PROPOSED', owner: null,
      created_at: row.timestamp || null, completed_at: null, url: row.url, source_issue_id: issueId,
      origin: { seo_issue_id: issueId, url: row.url, observed_at: row.timestamp || null },
      ...actionEngineFields('TECHNICAL', row.timestamp || null), affected_urls: row.url ? [row.url] : [],
    };
  }));
  return [...new Map([...fromGaps, ...technical].map((action) => [action.action_id, action])).values()]
    .sort((a, b) => b.priority_score - a.priority_score || a.action_id.localeCompare(b.action_id));
}

const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slugify = (value) => fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const missing = '[INFORMAÇÃO NECESSÁRIA]';

export function createExperiment(config, action, prompts = [], baseline = null) {
  const intervention = unique(asArray(action.affected_prompts)).sort();
  const controls = prompts.filter((prompt) => prompt.control_group && !intervention.includes(prompt.prompt_id) && prompt.active !== false).map((prompt) => prompt.prompt_id).sort();
  return {
    experiment_id: hash('exp', [config.client_id, action.action_id]), client_id: config.client_id,
    name: `Avaliação da intervenção ${action.action_id}`,
    hypothesis: 'Uma intervenção fundamentada nas evidências pode estar associada a maior cobertura de recomendações nos prompts selecionados.',
    intervention_prompts: intervention, control_prompts: controls,
    actions: [action.action_id], baseline, current_result: null, start_date: null, end_date: null,
    checkpoints: ['BASELINE', 'D30', 'D60', 'D90'], status: 'PLANNED', conclusion: null,
    interpretation: 'Comparar LAB e GOLDEN separadamente. Relatar associação observada, sem afirmar causalidade absoluta.',
  };
}

/** Drafts are reviewable hypotheses. Only explicitly verified and public evidence becomes copy. */
export function createDraft(config, action, evidence = [], prompts = []) {
  if (!config?.client_id || !action?.action_id) throw new Error('Client and traceable action are required for content');
  if (!action.gap_id && action.approved_strategy !== true && action.strategy_approved !== true) throw new Error('Content requires a gap-linked action or explicitly approved strategy');
  if (['REJECTED', 'CANCELLED'].includes(action.status)) throw new Error('Cannot create content for a rejected or cancelled action');
  const targets = unique(asArray(action.affected_prompts)).sort();
  const targetPrompts = prompts.filter((prompt) => targets.includes(prompt.prompt_id));
  const firstPrompt = targetPrompts[0];
  const service = clean(firstPrompt?.service || asArray(config.priority_services).map(label).find(Boolean) || config.market || missing);
  const location = clean(firstPrompt?.location || asArray(config.locations).map(label).find(Boolean) || config.location || missing);
  const title = `Como avaliar ${service} em ${location}`;
  const pageId = hash('page', [config.client_id, action.action_id]);
  const eligible = evidence.filter((item) => item && (!item.client_id || item.client_id === config.client_id) && item.evidence_id && item.verified === true && item.public_allowed === true
    && (item.source_url || item.source || item.source_type) && (item.claim || item.value !== null && item.value !== undefined));
  const sourceEvidence = [...new Map(eligible.map((item) => [item.evidence_id, item])).values()].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const facts = sourceEvidence.map((item) => {
    const claim = clean(item.claim), value = clean(item.value);
    return { evidence_id: item.evidence_id, text: claim && value && fold(claim) !== fold(value) ? `${claim}: ${value}` : claim || value,
      source_url: normalizeCitation(item.source_url), source: clean(item.source || item.source_type), collected_at: item.collected_at || item.created_at || null };
  });
  const experiment = createExperiment(config, action, prompts);
  const outline = ['Informações confirmadas', 'Pontos a confirmar antes de decidir', 'Perguntas frequentes', 'Próximo passo', 'Fontes'];
  const faq = [
    { question: 'Quais opções e condições estão disponíveis?', answer: missing },
    { question: 'Onde consultar a documentação e confirmar os detalhes?', answer: missing },
    { question: 'Como entrar em contato para avaliar uma proposta?', answer: missing },
  ];
  const cta = `Solicite informações e confirme disponibilidade, condições e documentação. Canal de contato: ${missing}`;
  const sourceLines = facts.map((fact) => `- ${fact.evidence_id}: ${fact.source_url || fact.source || missing}${fact.collected_at ? ` (coleta: ${fact.collected_at})` : ''}`);
  const copy = facts.length ? facts.map((fact) => `- ${fact.text} [${fact.evidence_id}]`).join('\n') : missing;
  const markdown = `# ${title}\n\n## Informações confirmadas\n\n${copy}\n\n## Pontos a confirmar antes de decidir\n\nDisponibilidade, condições comerciais, documentação aplicável e adequação ao seu caso: ${missing}\n\n## Perguntas frequentes\n\n${faq.map((item) => `### ${item.question}\n\n${item.answer}`).join('\n\n')}\n\n## Próximo passo\n\n${cta}\n\n## Fontes\n\n${sourceLines.length ? sourceLines.join('\n') : missing}\n`;
  const description = `Perguntas e informações para avaliar ${service} em ${location}. Confirme condições, documentação e adequação ao seu caso.`;
  const metadata = {
    page_id: pageId, client_id: config.client_id, slug: `${slugify(title)}-${pageId.slice(-6)}`,
    title, meta_description: description, h1: title, h2: outline, page_type: 'GUIDE',
    cluster: firstPrompt?.cluster || 'CONTEXTUAL', target_prompts: targets,
    action_id: action.action_id, gap_id: action.gap_id || null, experiment_id: experiment.experiment_id,
    source_evidence_ids: facts.map((fact) => fact.evidence_id), created_at: action.created_at || null,
    status: 'DRAFT', auto_publish: false, indexable: false,
  };
  const brief = {
    objective: 'Responder à demanda comercial observada com informações verificadas; lacunas exigem validação humana.',
    target_prompts: targetPrompts.map((prompt) => ({ prompt_id: prompt.prompt_id, prompt: prompt.prompt })),
    origin: action.origin || { action_id: action.action_id, gap_id: action.gap_id },
    outline, facts, missing_information: ['Disponibilidade', 'Condições comerciais', 'Documentação aplicável', 'Canal de contato confirmado'],
    publication_requirements: ['Revisar cada fato e fonte', 'Preencher ou remover marcadores', 'Aprovar conteúdo explicitamente'],
  };
  const structuredData = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, inLanguage: 'pt-BR' };
  const factHtml = facts.length ? `<ul>${facts.map((fact) => `<li>${escapeHtml(fact.text)} <small>[${escapeHtml(fact.evidence_id)}]</small></li>`).join('')}</ul>` : `<p>${missing}</p>`;
  const sourcesHtml = facts.length ? `<ul>${facts.map((fact) => `<li>${escapeHtml(fact.evidence_id)}: ${fact.source_url ? `<a href="${escapeHtml(fact.source_url)}" rel="noopener noreferrer">${escapeHtml(fact.source_url)}</a>` : escapeHtml(fact.source || missing)}</li>`).join('')}</ul>` : `<p>${missing}</p>`;
  const html = `<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><style>body{font:18px/1.65 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#17332d}h1{line-height:1.2}h2{margin-top:2rem}aside{padding:12px;background:#fff2cc;border-radius:8px}small{color:#52665f}a{color:#176758}</style><script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script></head><body><aside>Rascunho para revisão — contém informações pendentes.</aside><main><h1>${escapeHtml(title)}</h1><h2>Informações confirmadas</h2>${factHtml}<h2>Pontos a confirmar antes de decidir</h2><p>Disponibilidade, condições comerciais, documentação aplicável e adequação ao seu caso: ${missing}</p><h2>Perguntas frequentes</h2>${faq.map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`).join('')}<h2>Próximo passo</h2><p>${escapeHtml(cta)}</p><h2>Fontes</h2>${sourcesHtml}</main></body></html>`;
  return {
    ...metadata, metadata, brief, title, slug: metadata.slug, meta_description: description,
    outline, h1: title, h2: outline, copy, faq, cta, internal_links: [],
    structured_data_recommendation: 'WebPage only. Add Organization/LocalBusiness or FAQPage only after validating applicable facts and reviewed content.',
    structured_data: structuredData, sources_used: facts, experiment, markdown, html,
    warnings: facts.length ? ['Draft requires review and missing information.'] : ['No verified, public evidence was available; no client commercial facts were generated.'],
  };
}
