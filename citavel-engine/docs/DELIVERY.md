# Entrega CITAVEL CLIENT ENGINE V1

Status geral: PARTIALLY READY. O núcleo local foi instalado, executado pelo n8n e reexecutado sem duplicação. Planilha externa depende da autorização específica da conta. Integrações de métricas dependem de IDs/OAuth.

## Criado e testado

- 12 workflows instalados, incluindo 9 CORE principais, sincronização Sheets, Cosentino e template.
- Serviço persistente Docker `citavel-engine`, dashboard em http://localhost:8788/clients/cosentino/dashboard/.
- 8 páginas HTTP 200 coletadas; 59 evidências com fonte/data e verificação pendente.
- 40 prompts, 4 respostas LAB reais de Ollama qwen3.5:4b.
- 4 URLs citadas pelo modelo, sem verificação de retrieval. Nenhum concorrente foi confirmado nesta pequena amostra.
- 4 gaps, 6 ações priorizadas, 1 rascunho, 1 experimento planejado e 1 relatório semanal.
- 16 exports CSV no schema da planilha.
- Importação JSON/CSV de GOLDEN/evidência, templates, controle de aprovação e checkpoints de experimentos.
- Acompanhamento semanal local segunda-feira 09h, São Paulo, quando computador/Docker estiverem ligados.

## Workflows n8n

| Nome | ID | Estado |
|---|---|---|
| CITAVEL CORE — 00 MASTER | citavelCore00V1 | Publicado; execução validada |
| CITAVEL CORE — 01 INGEST | citavelCore01V1 | Publicado; execução validada |
| CITAVEL CORE — 02 AUDIT | citavelCore02V1 | Publicado; execução validada |
| CITAVEL CORE — 03 DEMAND | citavelCore03V1 | Publicado; execução validada |
| CITAVEL CORE — 04 INTELLIGENCE | citavelCore04V1 | Publicado; execução validada |
| CITAVEL CORE — 05 ACTION | citavelCore05V1 | Publicado; execução validada |
| CITAVEL CORE — 06 CONTENT | citavelCore06V1 | Publicado; execução validada |
| CITAVEL CORE — 07 MONITOR | citavelCore07V1 | Publicado; dados locais validados |
| CITAVEL CORE — 08 REPORT | citavelCore08V1 | Publicado; execução validada |
| CITAVEL CORE — 09 SHEETS | citavelCore09V1 | Publicado; ramo externo bloqueado até autorização |
| CITAVEL CLIENT — COSENTINO | citavelCosentV1 | Execução manual validada |
| CITAVEL CLIENT TEMPLATE | citavelTempltV1 | Pronto para duplicar e configurar CLIENT_ID |

A versão atual instalada é n8n 2.35.5 (container `n8n`). O ambiente inicial usava 2.39.7; os nodes foram conferidos novamente após a mudança. Os workflows Vitta Vet existentes foram preservados. CORE significa workflow invocável por outro workflow; publicação de um CORE não publica conteúdo no site.

## Integrações

| Integração | Resultado |
|---|---|
| Ollama | READY; quatro modelos descobertos; qwen3.5:4b executou LAB e classificação |
| Gemini | Chave aceita; geração degradada: modelo antigo HTTP 404 e modelo atual HTTP 503. Fallback Ollama validado |
| Google Sheets | Autorização da conta pendente; criação/gravação ainda não executadas |
| Search Console | property e OAuth pendentes |
| GA4 | property ID numérico e OAuth pendentes |
| GTM | conta/container e OAuth pendentes; somente leitura |

A revisão automática bloqueou a criação da planilha porque a conta da credencial “Google Sheets - Clinica VET” não foi autorizada especificamente. A pergunta de autorização permanece pendente. Essa limitação não impede o funcionamento local.

## Qualidade

47 testes automatizados passaram. A execução local e a execução real do n8n passaram. A repetição manteve 59 evidências, 40 prompts, 4 AI runs, 9 registros de páginas (8 coletadas e 1 draft), 4 fontes, 4 gaps, 6 ações, 1 experimento e 1 relatório. Fixtures são isoladas. Segredos não aparecem em código, workflows ou documentação.

Amostra limitada: não interpretar os quatro testes LAB como medição da visibilidade real em buscadores. GOLDEN, leads, pipeline, receita e indexação real continuam pendentes. O draft tem informações a completar e nunca foi publicado.

## Operação

Abra http://localhost:5678/workflow/citavelCosentV1 e use Execute workflow. Alternativa: `node scripts/run.mjs cosentino ONBOARDING` na pasta `/Users/pedro/Documents/CITAVEL/citavel-engine`.

Para novo cliente: `./scripts/create-client novo-cliente`; preencher o client.json; duplicar CITAVEL CLIENT TEMPLATE; ajustar CLIENT_ID; executar. Guia completo no README.md.

## Recuperação em 5 de outubro de 2026

O container anterior do n8n e o serviço CITAVEL estavam parados. A instância atual `n8n` usa o mesmo volume persistente e preservou os 12 workflows. O CITAVEL foi religado e conectado à instância atual pela rede Docker dedicada `citavel-local`. A execução do workflow Cosentino na versão 2.35.5 terminou com sucesso. Corrigida também a importação de Sheets para nunca converter um registro LAB existente em GOLDEN por alteração de seu run_id. Seis testes novos cobrem essa proteção, idempotência e evidências não publicáveis.

O ciclo WEEKLY de 5 de outubro terminou READY, sem erros: 8 AI runs LAB acumulados (4 da baseline e 4 do ciclo semanal), 5 URLs citadas pelo modelo, 4 gaps, 6 ações e 2 relatórios semanais. As 59 evidências, 40 prompts e 1 rascunho foram preservados. Nenhuma resposta GOLDEN ou publicação foi fabricada.

## Atualização V2 — 13 de outubro de 2026

Validado ao vivo no Mac (log em `docs/startup-check.log`):

- Motor reconstruído e religado (`healthz` ok); n8n alcança o motor pela rede `citavel-local`; Ollama ok (qwen3.5:4b/9b).
- 16 workflows V2 importados; 12 CORE V2 publicados; 10 CORE V1 legados despublicados (podem ser arquivados no n8n).
- Novos workflows de cliente: `citavelDesiguV1` (Desigual) e `citavelOrvyncV1` (Orvyn clean-room), além de Cosentino e Template.
- Corrigida a ordem do MASTER: DEMAND agora roda antes de INTELLIGENCE (antes os testes LAB rodavam antes das perguntas serem atualizadas). "Resumo final" não regera mais o relatório.
- Agendador: recupera a semana perdida. Em 13/out recuperou o WEEKLY de 12/out: Cosentino READY (20→24 runs LAB), Desigual READY (primeiro WEEKLY, 44→52 runs), Orvyn PARTIALLY_READY (bloqueado de propósito, ver abaixo).
- Execução real pelo n8n (Cosentino, modo ONBOARDING): DISCOVER → INGEST → AUDIT → DEMAND → INTELLIGENCE → ACTION → CONTENT → MONITOR → REPORT, todas SUCCESS/SKIPPED esperado.
- Orvyn: `orvyn.app` é domínio à venda (redirect para forsale.godaddy.com). O motor agora detecta `PARKED_DOMAIN` e não gera nem testa perguntas genéricas sem `market`/`priority_services`.
- Gemini: fallback entre modelos implementado e testado em unidade; geração real ainda não confirmada após a mudança.
- 73 testes automatizados passando.

Pendências que dependem de decisão/acesso do operador: repositório do site para publicação (`config.publishing`), domínio e mercado reais da Orvyn, OAuth Google (Sheets/GA4/GSC/GTM), respostas GOLDEN reais, aprovação das ações propostas no Manager.
