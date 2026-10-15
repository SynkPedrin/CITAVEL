// Deterministic executive narrative for report v2. Sentences exist only when their numbers are in the snapshot.
// Google (observed organic search) and AI (imported external measurement) are described separately and never
// combined into a single score; no causality is asserted.
const n = (v: number) => v.toLocaleString('pt-BR');
const p = (v: number, d = 1) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
const day = (d: string | null | undefined) => d ? d.split('-').reverse().join('/') : '—';
const CLS: Record<string, string> = { GOLDEN: 'GOLDEN (respostas reais com evidências)', LAB: 'LAB (testes automatizados)', QUALITATIVE: 'qualitativa, sem verificação independente' };

export function narrativeV2(s: any): { google: string[]; ai: string[]; closing: string[] } {
  const google: string[] = [], ai: string[] = [], closing: string[] = [];
  const g = s.gsc_metrics;
  if (g?.status === 'AVAILABLE') {
    const t = g.totals, c = g.coverage;
    google.push(`Entre ${day(c.firstDate)} e ${day(c.lastDate)}, o site apareceu ${n(t.impressions)} vezes nos resultados da Pesquisa Google e recebeu ${n(t.clicks)} cliques, com CTR de ${t.ctr == null ? '—' : p(t.ctr, 2)} e posição média ${t.position == null ? '—' : t.position.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`);
    if (c.currentDays < c.requestedDays) google.push(`O período solicitado tem ${c.requestedDays} dias, mas o Search Console disponibiliza dados para ${c.currentDays} deles; os números refletem apenas os dias com dados.`);
    if (g.deltas && g.previous_totals) {
      const dir = (v: number) => v > 0 ? 'cresceram' : v < 0 ? 'caíram' : 'ficaram estáveis';
      google.push(`Em relação ao período anterior de mesma duração, as impressões ${dir(g.deltas.impressions.pct)} ${p(Math.abs(g.deltas.impressions.pct))} e os cliques ${dir(g.deltas.clicks.pct)} ${p(Math.abs(g.deltas.clicks.pct))}.`);
    } else google.push('Ainda não há período anterior com cobertura suficiente para uma comparação válida.');
    if (g.brand?.share_of_identified_clicks != null && g.brand.branded.clicks + g.brand.non_branded.clicks > 0) google.push(`Buscas que citam a marca somaram ${n(g.brand.branded.clicks)} cliques (${p(g.brand.share_of_identified_clicks)} dos cliques com consulta identificada); buscas sem a marca, ${n(g.brand.non_branded.clicks)}.`);
    if (g.hidden_query_share?.clicks != null && g.hidden_query_share.clicks > 0) google.push(`${p(g.hidden_query_share.clicks)} dos cliques vieram de consultas que o Google não detalha por privacidade ou baixo volume.`);
  } else if (g) google.push('Os dados do Google Search Console ainda não estão disponíveis para este cliente.');

  const a = s.ai_visibility;
  if (a?.status === 'AVAILABLE') {
    const plats = a.platforms.map((x: any) => x.label).join(', ');
    ai.push(`A medição de presença em IA "${a.title}"${a.executed_at ? `, executada em ${day(a.executed_at)}` : ''}, avaliou ${a.platforms.length ? plats : 'plataformas não especificadas'} e é classificada como ${CLS[a.classification] || a.classification}.`);
    const i = a.indicators;
    if (i.mention) ai.push(`A marca foi mencionada em ${i.mention.numerator} de ${i.mention.denominator} respostas observadas (${p(i.mention.value)}).`);
    if (i.recommendation) ai.push(`Foi recomendada em ${i.recommendation.numerator} de ${i.recommendation.denominator} respostas (${p(i.recommendation.value)}).`);
    if (i.citation) ai.push(`O site foi citado em ${i.citation.numerator} de ${i.citation.denominator} respostas (${p(i.citation.value)}).`);
    if (!a.quantitative) ai.push('A medição traz análise qualitativa, sem contagens suficientes para calcular percentuais; por isso nenhum índice é apresentado.');
    if (a.competitors.length) ai.push(`Concorrentes citados nas respostas: ${a.competitors.slice(0, 6).map((c: any) => c.name).join(', ')}.`);
    if (a.comparison?.mention && i.mention) ai.push(`Na medição anterior compatível (${day(a.comparison.executed_at)}), a cobertura de menção era ${p(a.comparison.mention.value)}.`);
  } else if (a) ai.push('Ainda não há medição de presença em IA aprovada para este cliente.');
  if (g && a) closing.push('Os resultados do Google medem o desempenho orgânico observado no Search Console; os de IA vêm de uma medição externa importada. São leituras complementares, apresentadas separadamente e sem um índice combinado.');
  closing.push('As variações descrevem o que foi observado e não comprovam, isoladamente, a causa das mudanças.');
  return { google, ai, closing };
}
