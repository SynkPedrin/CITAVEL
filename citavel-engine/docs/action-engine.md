# CITÁVEL — Action Engine Contract (v1)

Escopo: camada DETECTAR → EXPLICAR → PROPOR → APROVAR → EXECUTAR → VALIDAR → PUBLICAR → MONITORAR → MEDIR.
Este documento é o contrato entre Engine (Node, `core/`) e Manager (Next.js). Implementar exatamente estes endpoints e formatos.

## 1. Lifecycle de Action (engine, `state.actions[]`)

Estados (ordem feliz):
`DETECTED → PROPOSED → WAITING_APPROVAL → APPROVED → EXECUTING → VALIDATING → READY_TO_PUBLISH → PUBLISHING → PUBLISHED → MONITORING → MEASURED`

Exceções: `NEEDS_INFORMATION`, `NEEDS_HUMAN_ACTION`, `FAILED`, `REJECTED`, `ROLLED_BACK`.

Regras:
- Actions existentes com `status:'OPEN'` passam a ser tratadas como `PROPOSED` (migração na leitura/upsert, sem reescrever histórico).
- Actions com `automation_level:'HUMAN_ACTION'` vão de `PROPOSED → WAITING_APPROVAL → (APPROVE) → NEEDS_HUMAN_ACTION` com pacote preparado (brief/pitch). Nunca executam.
- Toda transição registra em `action.lifecycle`: `{status, at (ISO), actor, note}` — nunca pular estado silenciosamente; transição inválida retorna erro `INVALID_TRANSITION`.
- Nada é deletado: REJECTED/FAILED/ROLLED_BACK permanecem no estado.

Campos novos do action (além dos existentes `action_id, client_id, gap_id, title/summary, priority, priority_score, status, created_at, origin{gap_id,prompt_ids,run_ids}, expected_signal`):
```
action_type:        'CONTENT'|'TECHNICAL'|'ENTITY'|'SOURCE'|'REPUTATION'|'CONVERSION'
automation_level:   'AUTOMATIC'|'APPROVAL_REQUIRED'|'HUMAN_ACTION'
approval_required:  boolean
risk:               'LOW'|'MEDIUM'|'HIGH'
affected_prompts:   [prompt_id]
affected_urls:      [url]
preview:            null | {page_type, slug, url_desired, title, meta_description, h1, outline[], faq_count, cta, schema_types[], internal_links[], evidence_ids[], missing_information: boolean}
execution:          null | {started_at, finished_at, status, log: [{step, status, at, detail}], page_id}
deployment:         null | {adapter, repo_path, branch, commit, url, status, published_at, rollback: {strategy, commit? , note}}
```

## 2. Endpoints novos do Engine (server.mjs)

Autenticação: mesma postura atual (bind loopback + host/origin guards). Respostas de erro: `{error: CODE}` HTTP 4xx/5xx.

### POST /v1/actions/{client_id}/{action_id}/decide
Body: `{decision:'APPROVE'|'REJECT', actor?:string}`
- APPROVE: `PROPOSED|WAITING_APPROVAL → APPROVED` (valida transição).
- REJECT: `PROPOSED|WAITING_APPROVAL → REJECTED` (exige `note` opcional).
Resposta: `{action}` atualizado.

### POST /v1/actions/{client_id}/{action_id}/execute
Body: `{actor?:string}`
- Pré: status `APPROVED` (ou `AUTOMATIC` em `PROPOSED` quando política permitir — V1: exigir APPROVED).
- Fluxo: `APPROVED → EXECUTING → VALIDATING → READY_TO_PUBLISH | NEEDS_INFORMATION | FAILED`.
- CONTENT: gera CONTENT PACKAGE reutilizando `createDraft` (evidence-locked; `[INFORMAÇÃO NECESSÁRIA]` ⇒ `NEEDS_INFORMATION`); preenche `preview` + `execution.page_id`.
- TECHNICAL: V1 gera plano com before/after e vai para `READY_TO_PUBLISH` (sem auto-fix fora de adapter configurado).
- SOURCE/REPUTATION/CONVERSION: prepara pacote humano (brief, pitch, fatos) ⇒ `NEEDS_HUMAN_ACTION`.
Resposta: `{action, validation:{evidence_ok, missing: string[], links_ok, schema_ok}}`.

### POST /v1/actions/{client_id}/{action_id}/publish
Body: `{actor?:string}`
- Pré: `READY_TO_PUBLISH`. Fluxo: `→ PUBLISHING → PUBLISHED → MONITORING` (MONITORING é aplicado após validação de produção; em V1, PUBLISHED já liga monitoramento e o próximo MONITOR stage move para MONITORING/MEASURED).
- Usa `config.publishing` do cliente (ver §4). Sem adapter configurado ou sem acesso (push negado, repo ausente): permanece `READY_TO_PUBLISH` com `deployment.status:'BLOCKED_NO_ACCESS'` e `note` explicando exatamente o que falta. NUNCA fingir publicação.
- Após escrita/push: validação de produção = GET na URL esperada (até ~3 tentativas, timeout) ⇒ 200 + conteúdo presente. Sem validação ⇒ `READY_TO_PUBLISH` com nota `DEPLOY_PENDING_VALIDATION`.
Resposta: `{action, deployment}`.

## 3. Publishing adapters (engine, `core/publish.mjs`)

Interface: `{type, check(config) → {ok, detail}, publish({page, html, action, config}) → {commit?, branch, url, rollback}, rollback(deployment, config)}`.

V1 implementa `git_static`:
```
config.publishing = {
  adapter: 'git_static',
  repo_path: '/abs/path/do/repo',
  base_path: 'public/p',            // onde o HTML é escrito dentro do repo
  url_base: 'https://agenciadesigual.com.br/p',
  branch_prefix: 'citavel/',
  auto_push: false                   // true só com credencial confirmada
}
```
Comportamento: verifica `git status` limpo na branch atual (senão BLOCKED), cria branch `{branch_prefix}{client}-{action_id curto}`, escreve `{base_path}/{slug}.html`, commit `[CITAVEL-{action_id}] {título da action}`, push se `auto_push`. Rollback registrado = `{strategy:'git_revert', commit}`.
Segurança: `repo_path` precisa existir e ser repo git; recusar escrita fora de `base_path`; nunca commitar em `main/master` diretamente; nunca deletar arquivos.

## 4. ActionResult (engine, `state.action_results[]`)

```
{result_id, action_id, client_id, measured_at, window: 'D1'|'D7'|'D14'|'D30'|'D60'|'D90',
 baseline: {mention, recommendation, citation, runs},
 current:  {mention, recommendation, citation, runs},
 deltas:   {mention, recommendation, citation},
 result_status: 'TOO_EARLY'|'INSUFFICIENT_DATA'|'POSITIVE_SIGNAL'|'NEUTRAL'|'NEGATIVE_SIGNAL',
 notes}
```
- Calculado no stage MONITOR para actions `PUBLISHED|MONITORING`: métricas restritas aos `affected_prompts` (mesmas fórmulas de `aggregateMetrics`), baseline = snapshot salvo na publicação (`action.deployment.baseline_snapshot`), current = runs mais recentes do mesmo run_type.
- `runs < 2` no current ⇒ `INSUFFICIENT_DATA`. Janela anterior a D1 ⇒ `TOO_EARLY`.
- Após primeira medição com dados: action → `MEASURED` (continua sendo medida em MONITORs futuros).

## 5. Relatório (engine, `core/reports.mjs`)

Nova seção `## IMPLEMENTAÇÕES REALIZADAS`: por action com lifecycle ≥ APPROVED no período — problema (gap), decisão, URL publicada (se houver), prompts alvo, `result_status` atual. Sem dados ⇒ seção com "Nenhuma implementação no período." (não omitir).

## 6. Manager — mapeamento (sync + schema)

Prisma (db push, sem migration framework):
- `Action`: adicionar `actionType String?`, `automationLevel String?`, `risk String?`, `lifecycle Json?`, `preview Json?`, `execution Json?`, `deployment Json?`.
- Novo `ActionExecution {id, actionId→Action, status, log Json, startedAt, finishedAt}`.
- Novo `Deployment {id, clientId→Client, actionId→Action?, pageId→Page?, adapter, branch?, commit?, url?, status, rollback Json?, publishedAt?, createdAt}`.
- Novo `ActionResult {id, actionId→Action, measuredAt, window, baseline Json, current Json, deltas Json, resultStatus, notes?, @@unique([actionId, window, measuredAt])}`.
- `syncEngineClient`: mapear `state.actions[*]` (campos novos), `state.action_results[*]` → ActionResult; criar Deployment quando `action.deployment.status` indicar publicação; registrar ActionExecution a partir de `action.execution`.
- `getClientData`: expor os campos novos (lifecycle/preview/deployment podem ir à UI; sem segredos — repo_path NUNCA vai ao browser, strip em getClientData).

## 7. Manager — UI

- `/clients/[id]/approvals` (nova seção na nav): cards de actions `PROPOSED|WAITING_APPROVAL` com prioridade, problema, evidência (origem: gap→prompts→runs), prompts afetados, preview (title/H1/outline), risco, automation_level; botões APROVAR / REJEITAR (V1 individual).
- `/clients/[id]/actions/[actionId]` (nova rota): trace completo "POR QUE ESTA AÇÃO EXISTE" (prompt → run → concorrentes/fontes → gap → action → preview → deployment → monitoring → result), lifecycle timeline, botões de decisão quando aplicável, deep links para prompt/fonte/URL.
- Asset detail em `/clients/[id]/content/[pageId]`: URL real, status, motivo (gap/ação), prompts alvo, baseline vs atual (quando houver ActionResult), publicado em, link externo.
- Overview: seção "OPERAÇÃO ATUAL" com contagens por estado (EM ANÁLISE=PROPOSED, AGUARDANDO APROVAÇÃO, EXECUTANDO, PUBLICADOS, EM MONITORAMENTO, COM SINAL POSITIVO) calculadas do DB.
- APIs: `POST /api/actions/[id]/approve` (chama engine decide→execute→publish se `READY_TO_PUBLISH` e adapter ok; registra SystemEvent por transição), `POST /api/actions/[id]/reject` (com motivo). Ambas: `canOperate`, CSRF padrão, audit.
- Nav do cliente: adicionar "Aprovações" (com contador de pendentes) sem remover seções existentes.

## 8. Invariantes

- Sem dados fake: qualquer métrica de resultado deriva de runs reais; sem runs ⇒ `INSUFFICIENT_DATA`/`TOO_EARLY`.
- Publicação só em domínio do cliente (engine já valida hostname em `setPageStatus`; adapters validam `url_base` contra `config.domain`).
- Idempotência: re-executar `execute` com action já `READY_TO_PUBLISH`+page existente retorna o existente; `publish` repetido não duplica commit (branch existe ⇒ reutilizar/atualizar).
- Tenant isolation no Manager como já existe (`permitsClient`).
- Testes novos em ambos os repos; suites atuais (47 engine / 12 manager) devem continuar verdes.
