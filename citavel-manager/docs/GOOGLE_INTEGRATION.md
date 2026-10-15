# Central de Integrações Google — Search Console

Conexão Google única por organização (agência), propriedades vinculadas explicitamente a clientes,
importação histórica + sincronização diária, dashboard por cliente e relatórios PDF privados.

## Arquitetura

```
Manager (Next.js, :3002) ── OAuth 2.0 (code + PKCE + state) ──> Google
   │  google_connections (refresh token AES-256-GCM, só no backend)
   │  search_console_properties → client_property_bindings (1 propriedade = no máximo 1 cliente)
   │  gsc_sync_jobs · gsc_daily_metrics (totais da API) · gsc_dimension_metrics (QUERY/PAGE/DEVICE/COUNTRY)
   │  gsc_query_labels (revisão humana) · report_snapshots (imutáveis)
   ├── /api/internal/gsc/sync  <── n8n "CITAVEL — GSC DAILY SYNC" (06:30 America/Sao_Paulo, header X-Citavel-Job-Secret)
   └── Engine :8788 /v1/render/pdf (Chromium, JS desligado, rede bloqueada) → PDF → .runtime/reports/<client>/<snapshot>.pdf (0600)
```

O n8n só conhece o segredo de disparo (`GSC_JOB_SECRET`). Nenhum token Google sai do Manager.

## Google Cloud — o que preencher

1. **APIs e serviços → Biblioteca**: ative **Google Search Console API**.
2. **Tela de consentimento OAuth**:
   - Tipo: Externo (ou Interno, se a conta for Google Workspace da agência).
   - Escopos: `openid`, `.../auth/userinfo.email`, `https://www.googleapis.com/auth/webmasters.readonly`.
   - Enquanto o app estiver em **Teste**, adicione o e-mail do operador em *Usuários de teste*.
     Atenção: em modo Teste o Google expira refresh tokens em **7 dias** (a central mostra `AUTH_EXPIRED` e pede reautorização). Para operação contínua, publique o app (escopo `webmasters.readonly` é sensível: pode exigir verificação do Google).
3. **Credenciais → Cliente OAuth (Aplicativo da Web)**:
   - *URIs de redirecionamento autorizados* (correspondência exata, sem barra final):
     - Local: `http://localhost:3002/api/integrations/google/callback`
     - Produção: `https://<domínio do Manager>/api/integrations/google/callback`
       (o README cita `app.citavel.ai` como destino previsto; use o domínio real que estiver em `APP_URL`).
   - *Origens JavaScript*: não são necessárias (o fluxo é server-side).

## Variáveis de ambiente (`.env.local`, nunca versionado)

| Variável | Obrigatória | Uso |
|---|---|---|
| `GOOGLE_CLIENT_ID` | sim* | ID do cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | sim* | Segredo do cliente OAuth |
| `GOOGLE_REDIRECT_URI` | recomendada | URI exata enviada ao Google; deve terminar em `/api/integrations/google/callback`; https obrigatório fora de localhost. Sem ela: `APP_URL` + rota. |
| `GOOGLE_TOKEN_KEY` | recomendada | ≥32 caracteres; chave de criptografia dos refresh tokens (fallback: derivada de `SESSION_SECRET`). Trocar a chave invalida tokens → reautorizar. |
| `GSC_JOB_SECRET` | sim (n8n) | ≥32 caracteres; compartilhado só com a credencial n8n *CITAVEL Manager — GSC job secret*. |
| `REPORT_STORAGE_DIR` | não | Diretório privado dos PDFs (padrão `.runtime/reports`). |

\* Alternativa sem editar arquivos: **Configurações → Acesso Google** (SUPER_ADMIN) grava ID/segredo criptografados em `.runtime/connections/platform.enc`.
Após editar `.env.local`, reinicie o Manager (`ALLOW_INSECURE_LOCAL_HTTP=true npm run start` após `npm run build`, ou `scripts/activate-local.sh`).

## Operação

1. **Configurações → Integrações → Google Search Console → Conectar com Google** (ADMIN/SUPER_ADMIN).
2. Autorize no Google. A conexão só é marcada `CONNECTED` após a troca do código, conferência do escopo e do refresh token; em seguida a Sites API lista as propriedades.
3. **Propriedades encontradas → Selecionar → Cliente → Continuar → Confirmar vínculo e importar histórico**. Nenhuma propriedade é importada sem essa confirmação. É possível criar um *rascunho de cliente* (status `DRAFT`, não ativo).
4. A importação inicial (`GSC_INITIAL_SYNC`) solicita 16 meses e registra o que a API realmente devolveu (`available_start_date`/`available_end_date`).
5. **Cliente → Google / SEO**: indicadores, filtros (7d, 28d, 3m, 6m, 12m, personalizado), comparação com o período anterior, evolução mensal, consultas classificadas, páginas, dispositivos, países, oportunidades, indexação.
6. **Cliente → Relatórios → Gerar relatório** (operadores): tipo, período, seções, idioma. Visualizar/Baixar PDF para qualquer usuário autorizado do cliente (link de 5 min, vinculado ao usuário, auditado).

Estados da central: `NOT_CONNECTED`, `CONNECTING`, `CONNECTED`, `AUTH_EXPIRED`, `SYNCING`, `SYNC_ERROR`.

## Sincronização

- Inicial: até 16 meses; diária: últimos 10 dias (Google revisa dias recentes); `dataState=final`.
- Escrita idempotente: cada janela é substituída atomicamente após ser buscada por completo (sem duplicação).
- Paginação `startRow` (25.000 linhas/requisição); retry com backoff exponencial + `Retry-After` para 429/5xx/quota; 401 → `AUTH_EXPIRED` (sincronizações param, dados preservados); 403 → propriedade marcada sem acesso.
- Um job por vínculo por vez (lock no Postgres); job diário único por dia (`idempotency_key`); job `RUNNING` há mais de 2h é marcado `STALE`.
- Recuperação: um dia perdido é recoberto pela janela de 10 dias do próximo ciclo; jobs com falha podem ser reexecutados em *Gerenciar vínculos → Sincronizar*.
- Agendador interno (Manager): a cada 10 min enfileira o sync do dia de todos os vínculos ativos e executa pendências; lock no Postgres evita duas instâncias trabalhando ao mesmo tempo. Cada job é reivindicado de forma atômica (QUEUED→RUNNING), então agendador, botão e n8n nunca executam o mesmo job duas vezes.
- n8n: workflow `citavelGscSyncV1` (arquivo em `citavel-engine/workflows/gsc-daily-sync.json`). Após importar/publicar, o n8n 2.x precisa ser **reiniciado** para ativar o agendamento.

## Regras de dados

- CTR nunca é somado: `cliques / impressões`. Posição média é ponderada por impressões.
- Totais vêm da consulta `[date]` (incluem consultas anonimizadas). A tabela de consultas soma menos; a diferença aparece como "consultas não detalhadas pelo Google".
- Propriedades de domínio (`sc-domain:`) e de prefixo de URL nunca são somadas.
- Total de páginas indexadas: `UNAVAILABLE_FROM_API` (não estimado por sitemap). Sitemaps: apenas contagem *enviada*. URL Inspection API não está habilitada.
- Consultas com telefone, e-mail, CPF/CNPJ ou números longos são mascaradas na importação. Nomes de pessoas não são detectáveis com confiabilidade.
- Classificador `gsc-rules-v1`: marca (nome + domínio + termos revisados), serviço/localidade (somente termos confirmados no Engine ou revisados), padrões comercial/informacional. Cada consulta mostra a regra e o termo; revisão humana sobrescreve.
- Oportunidades são registradas como *Gaps* `SEARCH_OPPORTUNITY` para revisão. Nada é publicado.
- Relatório: snapshot imutável com hash SHA-256; narrativa determinística gerada só a partir dos números do snapshot.

## Permissões

| Ação | SUPER_ADMIN/ADMIN | ANALYST | CLIENT_ADMIN/VIEWER |
|---|---|---|---|
| Conectar/desconectar Google, vincular propriedades | ✔ | ✘ | ✘ |
| Ver dashboard do cliente | ✔ | ✔ | só clientes atribuídos |
| Revisar classificação, registrar oportunidades, gerar relatório | ✔ | ✔ | ✘ |
| Visualizar/baixar relatórios | ✔ | ✔ | só clientes atribuídos |

Toda a área `/admin` redireciona perfis de cliente para o próprio espaço.

## Testes

`npm test` — inclui `tests/gsc-unit.test.ts` (agregação, classificação, redação, oportunidades, paginação, retry/quota, OAuth/PKCE, criptografia, links, template) e `tests/gsc-db.test.ts` (Postgres real em organização temporária: duas organizações, uma conta Google com vários clientes, vínculo cruzado bloqueado, backfill, idempotência, revisão, falha parcial, isolamento, snapshot, storage privado, AUTH_EXPIRED, desvínculo com expurgo). Os testes usam respostas Google simuladas apenas para validar a lógica; nada disso é gravado como dado real.
