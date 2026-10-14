# CITAVEL CLIENT ENGINE V2

Motor local multi-cliente (Cosentino, Desigual, clean-rooms), com CORE compartilhado e configuração independente por cliente. Dados operacionais ficam em `clients/{client_id}`. Publicação só com aprovação humana.

## Ligar tudo (um clique)

Dê dois cliques em **`/Users/pedro/Documents/CITAVEL/LIGAR CITAVEL.command`**. Ele abre o Docker se preciso, reconstrói e liga o `citavel-engine`, instala/publica os workflows V2 no n8n, testa Ollama e a rede n8n→motor e executa o workflow da Cosentino. Resultado em `docs/startup-check.log`.

## Abrir e executar

- Dashboard: http://localhost:8788/clients/{client_id}/dashboard/
- n8n: um workflow por cliente — **CITAVEL CLIENT — COSENTINO** (`citavelCosentV1`), **— DESIGUAL** (`citavelDesiguV1`), **— ORVYN-CLEANROOM-V1** (`citavelOrvyncV1`) e **CITAVEL CLIENT TEMPLATE**. Todos chamam **CITAVEL CORE — 00 MASTER** (`citavelCore00V2`).
- O node **CLIENT CONFIG** define `client_id` e `mode`.
- Ordem do MASTER (igual a `MODES.ONBOARDING` do motor): 01 DISCOVER → 02 CRAWL → 03 AUDIT → 04 DEMAND → 05 INTELLIGENCE → 06 ACTIONS → 07 CONTENT → 08 PUBLISH (portão: exige aprovação no Manager) → 09 MONITOR → 10 REPORT → 11 SHEETS. Etapas fora do modo escolhido retornam SKIPPED.

Modos: ONBOARDING, BASELINE, WEEKLY, CONTENT, MONITOR, REPORT. ONBOARDING percorre coleta, auditoria, demanda, LAB, inteligência, ações, rascunho, monitoramento e relatório. WEEKLY usa um lote distinto por semana; a mesma semana não repete indevidamente a baseline. Para uma repetição intencional nova, envie outro `batch_id` à API.

Alternativa local:

```sh
cd /Users/pedro/Documents/CITAVEL/citavel-engine
node scripts/run.mjs cosentino ONBOARDING
```

O serviço Docker `citavel-engine` reinicia junto com Docker Desktop. A porta externa é restrita a 127.0.0.1:8788. A porta interna 8787 é usada pelos workflows. Não interrompe nem substitui o n8n existente.

```sh
docker compose -f docker/compose.yml up -d
```

## Piloto e interpretação

A primeira amostra analisa no máximo 8 páginas e gera 40 perguntas comerciais em oito clusters. Executa 4 perguntas de prioridade alta por baseline para limitar o custo. Ajuste `automation.lab_sample_size` até 50 e `crawl_max_pages` até 20 na configuração. O crawl respeita robots, tem timeouts, limita redirecionamentos e bloqueia destinos privados. Não executa JavaScript das páginas, por isso a cobertura é uma amostra do HTML recebido.

LAB registra respostas por API/modelo local. Não equivale a ChatGPT Search. URLs citadas por um modelo não são automaticamente fontes verificadas. GOLDEN registra somente respostas reais importadas pelo operador e aparece em destaque no dashboard. Ausência de dados comerciais/GOLDEN permanece pendente, sem métricas inventadas.

Evidências extraídas do site começam como não verificadas e não publicáveis. A classificação de trechos por IA não comprova sua veracidade. Rascunhos usam somente evidências explicitamente verificadas e autorizadas para divulgação; lacunas recebem `[INFORMAÇÃO NECESSÁRIA]`.

## Configuração e integrações

`clients/cosentino/config/client.json` contém domínio, marca, prioridades e IDs externos. IDs Google desconhecidos são null. Google Sheets depende de autorização específica para a conta da credencial **Google Sheets - Clinica VET**. Até a autorização, `automation.google_sheets_enabled` permanece ausente/false e o workflow 09 não envia pedidos externos. Os 16 arquivos CSV de controle estão em `clients/cosentino/data/sheets/`.

Após a autorização, o workflow 09 cria as 16 abas, grava o ID na configuração e passa a atualizar a mesma planilha. Importa revisões em Evidence (verified/public_allowed), Prompts (active/control_group), Actions (status/owner), Leads e linhas GOLDEN válidas antes de sincronizar. Revisões importadas ao fim de um ciclo são usadas no próximo ciclo. Não apague linhas para excluir registros: desative prompts ou marque ações como CANCELLED. O snapshot exportado é mantido pelo motor e não é uma planilha de escrita livre para todas as colunas.

GA4, Search Console e GTM: adaptadores somente leitura preparados. Para ativação, faltam IDs e OAuth com escopos adequados. Uma API key e client secret sozinhos não concedem acesso aos relatórios privados. Nenhuma credencial existente foi modificada. Detalhes em `docs/integrations.md`.

## Importar respostas reais e evidências

```sh
node scripts/import.mjs cosentino golden /caminho/respostas.json
node scripts/import.mjs cosentino evidence /caminho/evidencias.json
```

JSON pode ser uma lista ou `{ "records": [...] }`; CSV usa cabeçalho. GOLDEN exige `platform`, `timestamp` ISO, `prompt_id` existente e `response`. Plataformas: ChatGPT, Gemini, Perplexity, Google AI Mode, Copilot. Os IDs de prompts estão em `clients/cosentino/demand/prompts.json` e no dashboard. O importador fixa GOLDEN explicitamente e deduplica por conteúdo/plataforma/pergunta/data.

Evidências exigem `claim` ou `value`, uma fonte (`source_url` ou `source`), e validação explícita (`verified: true`, `public_allowed: true`) para serem publicáveis. Sem fonte recebem SOURCE_MISSING.

Endpoints locais, sem publicação externa:

- POST `/v1/run` — `{client_id,mode,stage?,batch_id?}`
- POST `/v1/import/{client_id}/golden` — lista JSON ou CSV
- POST `/v1/import/{client_id}/evidence` — lista JSON ou CSV
- GET `/v1/state/{client_id}` — estado local

## Conteúdo e experimentos

Páginas ficam em `pages/drafts/`, com HTML, Markdown, brief e metadata. Reruns preservam o draft existente. Aprovação é explícita e exige remover/preencher marcadores. Para regenerar intencionalmente, crie nova ação ou use um novo identificador de estratégia revisada; não sobrescreva um draft aprovado.

```sh
node scripts/page-status.mjs cosentino PAGE_ID APPROVED
node scripts/page-status.mjs cosentino PAGE_ID PUBLISHED https://cosentinourbanismo.com.br/pagina-publicada
```

PUBLISHED apenas registra publicação que você já realizou. WordPress/GitHub/Vercel não recebem conteúdo na V1. O snapshot local de uma página publicada mantém o histórico do draft, sem servir como pacote de implantação.

Experimentos começam PLANNED. Após registrar uma página publicada, POST `/v1/lifecycle/cosentino/experiment` com `experiment_id` captura baseline de intervenção/controle e inicia acompanhamento. MONITOR salva D30/D60/D90 quando houver execução após esses prazos. O serviço local agenda WEEKLY a partir de segunda 09h (America/Sao_Paulo), uma vez por semana, para clientes com weekly_monitoring=true. Se o computador/Docker estiver desligado na segunda, o ciclo pendente roda automaticamente assim que o motor voltar (catch-up até domingo). Erros são re-tentados até 3 vezes (intervalo de 1h); um ciclo travado em RUNNING por mais de 2h é retomado. Onboarding feito na mesma semana conta como o ciclo da semana. O agendamento local atualiza arquivos e dashboard; a sincronização Sheets é feita ao executar o workflow no n8n. Comparações indicam associação observada, não causalidade.

## Action Engine

Ações seguem o ciclo `PROPOSED → WAITING_APPROVAL → APPROVED → EXECUTING → VALIDATING → READY_TO_PUBLISH → PUBLISHING → PUBLISHED → MONITORING → MEASURED`, com exceções `NEEDS_INFORMATION`, `NEEDS_HUMAN_ACTION`, `FAILED`, `REJECTED`, `ROLLED_BACK`. Toda transição fica registrada em `action.lifecycle`; nada é deletado. Ações antigas com `status:'OPEN'` são tratadas como `PROPOSED`. Ações `HUMAN_ACTION` (fontes, reputação, conversão) nunca executam: a aprovação prepara brief/pitch/fatos e as move para `NEEDS_HUMAN_ACTION`.

Endpoints locais:

- POST `/v1/actions/{client_id}/{action_id}/decide` — `{decision:'APPROVE'|'REJECT', actor?, note?}`
- POST `/v1/actions/{client_id}/{action_id}/execute` — CONTENT gera pacote evidence-locked reutilizando o rascunho (marcadores `[INFORMAÇÃO NECESSÁRIA]` ⇒ `NEEDS_INFORMATION`; após preencher o draft, reexecute)
- POST `/v1/actions/{client_id}/{action_id}/publish` — exige `READY_TO_PUBLISH` e `config.publishing`

O adapter V1 é `git_static`: escreve `{base_path}/{slug}.html` em `repo_path` e commita na branch `citavel/{cliente}-{action_id}` (nunca em main/master, nunca fora de `base_path`, `url_base` precisa ser do domínio do cliente, push só com `auto_push:true`). Sem adapter ou sem acesso, a ação permanece `READY_TO_PUBLISH` com `BLOCKED_NO_ACCESS`; sem confirmação por GET em produção, `DEPLOY_PENDING_VALIDATION`. Nenhuma publicação é simulada. O baseline dos prompts afetados é salvo em `deployment.baseline_snapshot` antes de publicar, e o stage MONITOR grava medições em `state.action_results` (janelas D1–D90, `TOO_EARLY`/`INSUFFICIENT_DATA` sem dados suficientes, LAB e GOLDEN sempre separados). Contrato completo: `docs/action-engine.md`.

## Novo cliente em até cinco minutos

1. Execute `./scripts/create-client clinica-x` na pasta do projeto.
2. Preencha `clients/clinica-x/config/client.json` com marca, domínio, mercado e localização; mantenha IDs ausentes como null.
3. No n8n, duplique **CITAVEL CLIENT TEMPLATE**.
4. Em **CLIENT CONFIG**, troque CLIENT_ID por `clinica-x`.
5. Execute. O CORE é compartilhado; dados da Cosentino não são copiados.

## Testes e manutenção

```sh
npm ci
npm test
```

Fixtures rodam em pastas temporárias e não contaminam Cosentino. Testes cobrem configuração, normalização de URL, crawler/robots/SSRF, scoring, parser, agregação, gaps, ações, métricas, CSV, importação GOLDEN, atribuição e isolamento de clientes. Relatório de verificação: `docs/qa-results.json`.

Atualizações dos workflows:

```sh
node scripts/build-workflows.mjs   # gera workflows/ (um workflow por cliente em clients/)
node scripts/install-workflows.mjs # importa, publica CORE V2 e despublica CORE V1 legados
```

Os CORE V2 precisam estar publicados para funcionarem como subworkflows no n8n 2.x. Os CORE V1 antigos (01 INGEST … 09 SHEETS) ficam despublicados e podem ser arquivados no n8n. `scripts/run-n8n [workflow_id]` executa um workflow pelo CLI (padrão: Cosentino).

## Salvaguardas de qualidade

- Domínio estacionado/à venda (redirect para GoDaddy/Sedo/Afternic etc.) ou sem conteúdo público vira `PARKED_DOMAIN`/`NO_PUBLIC_CONTENT` em `crawl.site_status` e `brand_identity.site_status`.
- Sem `market` e sem `priority_services`, DEMAND/INTELLIGENCE/ACTION/CONTENT ficam bloqueadas (`CONFIG_REQUIRED`): o motor não gera nem testa perguntas genéricas; perguntas com `[SERVIÇO A DEFINIR]` são desativadas (não apagadas).
- Gemini: tenta vários modelos em ordem (último que funcionou primeiro) antes de cair no Ollama; `GEMINI_MODEL` força um modelo.

Segredos ficam em `.runtime/` fora de Git e documentação. O segredo Gemini é montado somente para leitura. Não exporte credenciais do n8n para diagnóstico; o inventário usa apenas id/nome/tipo. Os arquivos sob `sources/` e os assets originais não foram modificados.
