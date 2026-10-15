// Measurement briefing for the external agents (copied by the operator; nothing is sent or executed).
// Uses only confirmed information; unknown items are stated as unknown instead of guessed.
export type BriefingInput = {
  clientName: string; domain: string; industry: string | null; locations: string[]; services: string[];
  topQueries: { query: string; impressions: number; clicks: number }[]; commercialQueries: string[];
  previous: { title: string; executedAt: string | null; classification: string; platforms: string[]; methodology: string } | null;
};
export const DELIVERY_TEMPLATE = `RELATÓRIO DE PRESENÇA EM IA

CLIENTE:
DOMÍNIO:
PERÍODO: dd/mm/aaaa a dd/mm/aaaa
DATA DA EXECUÇÃO: dd/mm/aaaa
ORIGEM: (ex.: agentes Endrigo · coleta manual nas interfaces · API)
METODOLOGIA:
VERSÃO:

PLATAFORMAS:

OPENAI:
MODELO:
MÉTODO DE COLETA: (interface de consumo / API)
PROMPTS:
OBSERVAÇÕES:
MENÇÕES:
RECOMENDAÇÕES:
CITAÇÕES:

GEMINI:
MODELO:
MÉTODO DE COLETA:
PROMPTS:
OBSERVAÇÕES:
MENÇÕES:
RECOMENDAÇÕES:
CITAÇÕES:

CLAUDE:
MODELO:
MÉTODO DE COLETA:
PROMPTS:
OBSERVAÇÕES:
MENÇÕES:
RECOMENDAÇÕES:
CITAÇÕES:

COPILOT:
MÉTODO DE COLETA:
PROMPTS:
OBSERVAÇÕES:
MENÇÕES:
RECOMENDAÇÕES:
CITAÇÕES:

CONCORRENTES:
- Nome (plataformas onde apareceu)
(contagens por concorrente só entram pelo JSON estruturado, no campo competitive_analysis: nome, domínio e, por plataforma, observações, menções, recomendações e citações sobre as mesmas respostas do cliente. Texto livre não gera percentuais de concorrentes.)

FONTES:
- https://...

PONTOS FORTES:
-

PONTOS FRACOS:
-

OPORTUNIDADES:
-

CONCLUSÃO:

EVIDÊNCIAS:
- Prompt + resposta original (ou link/print) por plataforma

LIMITAÇÕES:
-`;

export function buildBriefing(i: BriefingInput) {
  const list = (xs: string[], empty: string) => xs.length ? xs.map(x => `- ${x}`).join('\n') : `- ${empty}`;
  return `BRIEFING DE MEDIÇÃO DE PRESENÇA EM IA — ${i.clientName}

Objetivo: medir como ${i.clientName} aparece nas respostas de assistentes de IA (menções, recomendações e citações do site) para perguntas reais de potenciais clientes.

DADOS CONFIRMADOS DO CLIENTE
- Empresa: ${i.clientName}
- Domínio: ${i.domain}
- Segmento: ${i.industry || 'não informado no cadastro'}
- Localidades confirmadas:
${list(i.locations, 'nenhuma confirmada no cadastro — não presumir localidade')}
- Serviços confirmados:
${list(i.services, 'nenhum confirmado no cadastro — não presumir serviços')}

PESQUISAS REAIS NO GOOGLE (Search Console, maiores volumes de impressões)
${list(i.topQueries.map(q => `${q.query} (${q.impressions} impressões, ${q.clicks} cliques)`), 'sem dados do Google disponíveis')}

CONSULTAS COMERCIAIS RELEVANTES (identificadas no Search Console)
${list(i.commercialQueries, 'nenhuma identificada até o momento')}

MEDIÇÃO ANTERIOR
${i.previous ? `- ${i.previous.title} · ${i.previous.executedAt || 'data não informada'} · ${i.previous.classification} · ${i.previous.methodology} · plataformas: ${i.previous.platforms.join(', ') || '—'}\n- Para permitir comparação, repita as mesmas plataformas, modelos e prompts sempre que possível.` : '- nenhuma (esta será a linha de base)'}

O QUE PRECISAMOS NA ENTREGA
1. Metodologia utilizada e versão.
2. Plataformas avaliadas e modelos (com data da coleta).
3. Método de coleta por plataforma: interface de consumo (app/site) ou API.
4. Lista de prompts executados.
5. Respostas originais (texto ou link/print) — necessárias para classificar como GOLDEN.
6. Por plataforma: nº de prompts, nº de observações (respostas analisadas), nº de respostas que mencionam a marca, nº que recomendam a marca e nº que citam o site ${i.domain}.
7. Concorrentes mencionados (por plataforma).
8. Fontes/URLs citadas.
9. Conclusões, pontos fortes, pontos fracos, oportunidades e limitações.

REGRAS
- Informe contagens (ex.: "MENÇÕES: 8 de 20"), não só percentuais.
- Não estime números que não foram observados; escreva "não medido".
- Não inclua dados de pacientes ou informações pessoais.
- Sempre que possível, devolva no modelo abaixo (texto ou JSON).

${DELIVERY_TEMPLATE}`;
}
