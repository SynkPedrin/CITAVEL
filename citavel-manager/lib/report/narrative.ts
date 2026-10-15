// Deterministic executive narrative. Each sentence is produced only when its numbers exist in the snapshot;
// it describes observed change and never asserts causes or commercial outcomes.
type Lang = 'pt-BR' | 'en';
const n = (v: number, lang: Lang) => v.toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR');
const p = (v: number, lang: Lang, d = 1) => `${(v * 100).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;

export function narrative(s: any): string[] {
  const lang: Lang = s.language === 'en' ? 'en' : 'pt-BR'; const pt = lang === 'pt-BR'; const out: string[] = [];
  const g = s.gsc_metrics;
  if (g?.status === 'AVAILABLE') {
    const t = g.totals, d = g.deltas;
    out.push(pt ? `De ${s.period.start} a ${s.period.end}, o site apareceu ${n(t.impressions, lang)} vezes nos resultados da Pesquisa Google e recebeu ${n(t.clicks, lang)} cliques (CTR de ${t.ctr == null ? '—' : p(t.ctr, lang, 2)}).`
      : `From ${s.period.start} to ${s.period.end}, the site appeared ${n(t.impressions, lang)} times in Google Search results and received ${n(t.clicks, lang)} clicks (CTR ${t.ctr == null ? '—' : p(t.ctr, lang, 2)}).`);
    if (g.previous_totals && d.impressions?.pct != null && d.clicks?.pct != null) {
      const dir = (v: number) => pt ? (v > 0 ? 'cresceram' : v < 0 ? 'caíram' : 'ficaram estáveis') : (v > 0 ? 'increased' : v < 0 ? 'decreased' : 'were flat');
      out.push(pt ? `Em relação ao período anterior de mesma duração, as impressões ${dir(d.impressions.pct)} ${p(Math.abs(d.impressions.pct), lang)} e os cliques ${dir(d.clicks.pct)} ${p(Math.abs(d.clicks.pct), lang)}.`
        : `Compared with the previous period of equal length, impressions ${dir(d.impressions.pct)} ${p(Math.abs(d.impressions.pct), lang)} and clicks ${dir(d.clicks.pct)} ${p(Math.abs(d.clicks.pct), lang)}.`);
    } else out.push(pt ? 'Não há dados do período anterior para comparação.' : 'No previous-period data is available for comparison.');
    if (g.brand?.share_of_identified_clicks != null) out.push(pt ? `Buscas que citam a marca responderam por ${p(g.brand.share_of_identified_clicks, lang)} dos cliques com consulta identificada (${n(g.brand.branded.clicks, lang)} cliques).` : `Searches mentioning the brand accounted for ${p(g.brand.share_of_identified_clicks, lang)} of clicks with an identified query (${n(g.brand.branded.clicks, lang)} clicks).`);
    if (g.hidden_query_share?.clicks != null) out.push(pt ? `${p(g.hidden_query_share.clicks, lang)} dos cliques vieram de consultas que o Google não detalha (anonimizadas ou de baixo volume).` : `${p(g.hidden_query_share.clicks, lang)} of clicks came from queries Google does not disclose (anonymized or low volume).`);
    if (g.opportunities?.length) out.push(pt ? `Foram identificadas ${g.opportunities.length} oportunidades de melhoria com base nos dados do período.` : `${g.opportunities.length} improvement opportunities were identified from the period's data.`);
  } else out.push(pt ? 'Os dados do Google Search Console ainda não estão disponíveis para este cliente.' : 'Google Search Console data is not yet available for this client.');
  const golden = s.ai_visibility?.GOLDEN, lab = s.ai_visibility?.LAB;
  if (golden?.status === 'AVAILABLE' && golden.recommendation_coverage != null) out.push(pt ? `Nas ${golden.sample_size} respostas reais observadas (GOLDEN), a marca foi recomendada em ${p(golden.recommendation_coverage, lang)}.` : `In ${golden.sample_size} observed real answers (GOLDEN), the brand was recommended in ${p(golden.recommendation_coverage, lang)}.`);
  else if (lab?.status === 'AVAILABLE' && lab.mention_coverage != null) out.push(pt ? `No diagnóstico automatizado (LAB, ${lab.sample_size} execuções), a marca foi mencionada em ${p(lab.mention_coverage, lang)} das respostas; este é um teste experimental, não uma medição das plataformas reais.` : `In the automated diagnostic (LAB, ${lab.sample_size} runs), the brand was mentioned in ${p(lab.mention_coverage, lang)} of answers; this is an experimental test, not a measurement of real platforms.`);
  out.push(pt ? 'As variações descrevem associações observadas e não comprovam, isoladamente, a causa das mudanças.' : 'Changes describe observed associations and do not, on their own, establish causes.');
  return out;
}
