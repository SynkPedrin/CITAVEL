// Deterministic, auditable query classifier. Every decision carries the rule and the matched terms.
// Terms come only from the client's confirmed configuration (brand, priority services, locations) and
// admin-edited lists; nothing is inferred or invented. Human labels override the rule output.
export const QUERY_CATEGORIES = ['BRANDED', 'NON_BRANDED', 'SERVICE', 'LOCATION', 'INFORMATIONAL', 'COMMERCIAL', 'OTHER'] as const;
export type QueryCategory = (typeof QUERY_CATEGORIES)[number];
export const CLASSIFIER_VERSION = 'gsc-rules-v1';

export type ClassifierTerms = { brand: string[]; services: string[]; locations: string[] };
export type Classification = {
  category: QueryCategory; branded: boolean; tags: QueryCategory[];
  rule: string; matched: string[]; source: 'RULE' | 'HUMAN'; version: string;
};

export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const COMMERCIAL = ['preco', 'precos', 'valor', 'valores', 'quanto custa', 'custo', 'agendar', 'agendamento', 'marcar', 'orcamento', 'convenio', 'convenios', 'plano de saude', 'particular', 'perto de mim', 'proximo', 'melhor', 'melhores', 'comprar', 'contratar', 'onde fazer', 'onde', 'clinica', 'laboratorio', 'telefone', 'whatsapp', 'endereco', 'horario', 'resultado', 'resultados'];
const INFORMATIONAL = ['o que e', 'o que', 'como', 'por que', 'porque', 'para que serve', 'quando', 'qual', 'quais', 'significado', 'sintomas', 'preparo', 'precisa', 'pode', 'doi', 'demora', 'quanto tempo', 'diferenca', 'riscos', 'tipos'];

const hasPhrase = (q: string, phrase: string) => phrase.length > 0 && ` ${q} `.includes(` ${phrase} `);
const clean = (list: string[]) => [...new Set(list.map(normalize).filter(t => t.length >= 2))];

/** Brand terms from confirmed client identity: full brand name and the domain label (e.g. "dcs" from dcs.med.br). */
export function defaultBrandTerms(brandName: string, domain: string, extra: string[] = []) {
  let label = '';
  try { label = new URL(domain.includes('://') ? domain : `https://${domain}`).hostname.replace(/^www\./, '').split('.')[0]; } catch { /* no domain */ }
  return clean([brandName, label.length >= 3 ? label : '', ...extra]);
}

export function classifyQuery(query: string, terms: ClassifierTerms, label?: { category: string } | null): Classification {
  const q = normalize(query);
  const brand = clean(terms.brand).filter(t => hasPhrase(q, t));
  const services = clean(terms.services).filter(t => hasPhrase(q, t));
  const locations = clean(terms.locations).filter(t => hasPhrase(q, t));
  const commercial = COMMERCIAL.filter(t => hasPhrase(q, t));
  const informational = INFORMATIONAL.filter(t => q.startsWith(t + ' ') || q === t);
  const tags: QueryCategory[] = [];
  if (brand.length) tags.push('BRANDED'); else tags.push('NON_BRANDED');
  if (services.length) tags.push('SERVICE');
  if (locations.length) tags.push('LOCATION');
  if (commercial.length) tags.push('COMMERCIAL');
  if (informational.length) tags.push('INFORMATIONAL');
  let category: QueryCategory, rule: string, matched: string[];
  if (brand.length) { category = 'BRANDED'; rule = 'brand_term'; matched = brand; }
  else if (services.length) { category = 'SERVICE'; rule = 'service_term'; matched = services; }
  else if (locations.length) { category = 'LOCATION'; rule = 'location_term'; matched = locations; }
  else if (commercial.length) { category = 'COMMERCIAL'; rule = 'commercial_pattern'; matched = commercial; }
  else if (informational.length) { category = 'INFORMATIONAL'; rule = 'informational_pattern'; matched = informational; }
  else { category = 'OTHER'; rule = 'no_match'; matched = []; }
  const auto: Classification = { category, branded: brand.length > 0, tags, rule, matched, source: 'RULE', version: CLASSIFIER_VERSION };
  if (label && (QUERY_CATEGORIES as readonly string[]).includes(label.category)) {
    const human = label.category as QueryCategory;
    const branded = human === 'BRANDED' ? true : human === 'NON_BRANDED' ? false : auto.branded;
    return { ...auto, category: human, branded, rule: `human_override (rule: ${auto.rule})`, source: 'HUMAN' };
  }
  return auto;
}
