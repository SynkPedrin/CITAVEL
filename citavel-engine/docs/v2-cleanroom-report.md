# CITÁVEL V2 — Contrato: Brand Discovery + Clean-Room + Report Engine/PDF + n8n

Objetivo: operação sem agente de código. Manager = control plane, n8n = orquestrador, Engine = análise/descoberta, Publishing = adapters, Report Engine = snapshot→HTML→PDF.
Nada de dados fake: toda descoberta tem source_url, source_type, collected_at, confidence; ausência vira NOT_FOUND, nunca valor inventado.

## 1. Brand & Identity Discovery (engine, `core/brand-discovery.mjs`)

### Endpoints (server.mjs, mesmos guards)
- `POST /v1/cleanroom` body `{client_id, brand_name, official_domain?}` → cria cliente LIMPO (sem copiar dados de outro cliente; store já tem esse invariante) com config mínima `{client_id, brand: brand_name, domain: official_domain||'', market:'', locations:[], priority_services:[], competitors:[]}` + `clean_room: true`, e roda o estágio DISCOVER. Se `official_domain` ausente → resposta `{status:'DOMAIN_REQUIRED', note}` (V1 não faz scraping de buscador; pedir domínio é o comportamento honesto do handoff §8/§10).
- `POST /v1/discover/{client}` → (re)roda DISCOVER com a config atual.
- `POST /v1/discover/{client}/confirm` body `{actor, corrections?}` → `brand_identity.status: VERIFIED_BRAND_IDENTITY` (aplica correções manuais com `corrected_by/at`); também `reject` → `IDENTITY_REJECTED`.
- Stages novos no pipeline: `DISCOVER` como primeiro estágio do ONBOARDING quando `config.domain` presente (idempotente; em re-runs só re-executa se identidade ausente ou `force:true`).

### Output — `state.brand_identity`
```
{status: 'AUTO_DISCOVERED'|'VERIFIED_BRAND_IDENTITY'|'IDENTITY_REJECTED'|'INCOMPLETE',
 brand_name, official_domain, alternate_names: [{name, source_url, confidence}],
 tagline, description: {text, source_url, confidence},
 logos: [{asset_url, type:'organization_jsonld'|'header'|'manifest'|'favicon'|'og_image'|'candidate', width?, height?, mime_type, source_page, confidence}],
 favicon: {asset_url, source_page, confidence}|null,
 palette: [{role:'primary'|'secondary'|'accent'|'background'|'surface'|'text_primary'|'text_secondary', hex, source:'css_variable'|'theme_color'|'inline_style'|'stylesheet', confidence}],
 fonts: [{family, source:'google_fonts'|'font_face'|'stylesheet', confidence}],
 social_profiles: [{platform:'linkedin'|'instagram'|'youtube'|'facebook'|'x'|'tiktok', url, confidence}],
 contact: {whatsapp: [{number, source_url}], emails: [], forms: [{page_url, confidence}]},
 products_services: [{name, source_url, confidence}],
 claims: [{text, source_url, first_party:true, confidence}],
 cta: [{text, href, source_url}],
 collected_at, sources: [url]}
```
Regras:
- Prioridade de logo do handoff §13 (JSON-LD Organization.logo > header > manifest > favicon > og:image). Nunca imagem aleatória.
- Paleta: meta theme-color, CSS variables (`--*` em `<style>`/stylesheets do próprio domínio), cores dominantes de inline styles. Sem paleta detectável → `palette: []` + status parcial INCOMPLETE, não inventar.
- Social: apenas links em domínios oficiais das plataformas encontrados no site; confidence menor se só em footer.
- Buscar também `/manifest.json`, `/favicon.ico`, `/site.webmanifest` quando referenciados.
- Extrair de até N páginas (home + páginas já no crawl quando existir). Reusar o fetcher do crawler (respeita SSRF/robots).

### PUBLIC CONTENT MAP
No crawl (`core/crawler.mjs` ou pós-processo), cada página ganha `page_class: 'HOME'|'PRODUCT'|'SERVICE'|'FEATURE'|'USE_CASE'|'CASE'|'BLOG'|'ABOUT'|'CONTACT'|'LEGAL'|'OTHER'` por heurística determinística (path + title + h1). Sem IA. Testável.

### Clean-room isolation (testável)
`createClient` para clean-room não pode ler/copiar nada de outro cliente (teste: criar clean-room após cliente populado, provar state vazio e config mínima). Após DISCOVER, o engine pode PREENCHER config vazia (domain, market a partir de description/products_services) marcando `config_provenance.auto_filled_from: 'DISCOVER'` com collected_at — nunca sobrescrever campos preenchidos manualmente.

## 2. Report Engine (engine, `core/report-engine.mjs`)

### REPORT SNAPSHOT (imutável)
`state.report_snapshots[]`: `{snapshot_id, client_id, period:{type:'WEEKLY'|'MONTHLY'|'CUSTOM', start, end}, created_at, baseline, current_metrics:{LAB,GOLDEN}, prompts:{total, money, gained, lost, stable}, competitors, sources, gaps, actions:[{action_id,title,status,url}], published_assets:[{url, action_id, published_at}], seo:{critical,warnings,opportunities}, demand, experiments, next_actions, implementations:[...], data_sources:[{type:'ENGINE'|'LAB'|'GOLDEN'|'GA4'|'SEARCH_CONSOLE'|'MANUAL', status}]}`
- `snapshot_id` determinístico por (client, period, dia) — re-gerar no mesmo dia substitui; dias anteriores intactos (imutável por período passado).
- Stage REPORT passa a: gerar snapshot → markdown (atual, compatível) → HTML (atual) → HTML executivo (novo template, identidade CITÁVEL) → PDF (se renderer disponível).

### PDF
- `core/pdf.mjs`: `renderPdf(html, outPath)` usando `playwright-core` (nova dep) com Chromium: `process.env.CHROMIUM_PATH` (container: `/usr/bin/chromium-browser` via apk) → fallback channel `chrome` (host dev). Sem renderer → `{status:'PDF_UNAVAILABLE'}` honesto, HTML continua disponível.
- Template: capa (CITÁVEL + "Relatório de Presença e Demanda em IA" + cliente + período), seções §54 do handoff (1 Resumo Executivo … 13 Metodologia), links clicáveis, identidade visual CITÁVEL: fundo preto/branco, verde chartreuse (#C6FF00 ou valor do ASSETS), logo de /ASSETS (copiar para clients/<id>/reports/assets/ na geração — NÃO referenciar paths fora do cliente). Zero números hardcoded: tudo do snapshot; sem dado → "Pendente".
- Dockerfile: `apk add --no-cache chromium` + `ENV CHROMIUM_PATH=/usr/bin/chromium-browser` + `playwright-core` no package.json (npm ci normal).

### Private storage
- PDFs e relatórios executivos em `clients/<id>/reports/` já fora de repo público (clientes/ não é repo git público — manter assim; adicionar `clients/` no .gitignore do engine se ainda não estiver).
- Engine serve estáticos só em 127.0.0.1 (atual). NOVO: rotas estáticas de `reports/private/` exigem header `x-citavel-engine-secret` igual a `process.env.ENGINE_EVENT_SECRET` quando definido; PDF executivo vai para `reports/private/`. Manager faz proxy autenticado (ver §4).

## 3. n8n V2 (scripts/build-workflows.mjs)

Renomear/regenerar CORE genérico (sem duplicar por cliente): `citavelCore00Master` (orquestra em ordem) + `citavelCore01Discover`, `02Crawl`(=INGEST/AUDIT), `03Baseline`, `04Measure`(=INTELLIGENCE), `05Intelligence`, `06Actions`, `07Execute`, `08Publish`, `09Monitor`, `10Report` — todos thin HTTP → `/v1/run` com stage (ou endpoints novos). Manter compatibilidade: workflow do cliente (cosentino/desigual) só seta client_id e chama o MASTER. Não quebrar `tests/workflows.test.mjs` (atualizar nomes esperados) nem o install script.

## 4. Manager (Next.js)

- **Criar cliente clean-room**: no wizard `/admin/clients/new`, opção "Descoberta automática (clean-room)": inputs brand_name + official_domain opcional → POST engine `/v1/cleanroom` → provisiona normalmente no Manager (mesmo client_id). Se DOMAIN_REQUIRED, o fluxo pede o domínio (campo já existe).
- **Seção Identidade** (nova, nav do cliente): mostra `brand_identity` (logos com preview via URL externa, paleta com swatches, fontes, descrição, social, contato, claims) cada item com origem (link) e confidence (Badge); botões CONFIRMAR/CORRIGIR/REJEITAR (canOperate) → `/v1/discover/{client}/confirm`. Status AUTO_DISCOVERED vs VERIFIED_BRAND_IDENTITY visível. Ausências como NOT_FOUND.
- **Relatórios**: cards ganham "Baixar PDF" quando existir PDF no snapshot/relatório → `GET /api/clients/[id]/reports/[reportId]/pdf` (canOperate+tenant): lê o PDF do disco do engine (CITAVEL_ENGINE_PATH) server-side e strema com `content-type: application/pdf`; nunca expõe path nem URL do engine. Se PDF_UNAVAILABLE, mostra o HTML (link atual) + nota.
- **Sync**: mapear `brand_identity` e `report_snapshots` (metadados, não o PDF binário) para o Client.metadata/Integration? Preferir campos Json novos no Client: `brandIdentity Json?` (ou metadata). Não criar tabela nova para snapshots: guardar resumo em Report.summary (já existe) + `Report.filePath` para PDF privado (relativo).
- Cliente final (role CLIENT_*) não vê infra (Git/Vercel/n8n/Gemini/Ollama): verificar que as seções novas não expõem esses termos para roles de cliente.

## 5. Testes obrigatórios

Engine (node --test, fixtures tmp, sem rede — fetch injetável):
- brand discovery: logo priority chain, palette de CSS variables, social extraction, NOT_FOUND honestos, confidence presente, provenance completa.
- clean-room isolation: state nasce vazio; config auto-fill só em campos vazios e com provenance.
- content map: classificação por path/title.
- report snapshot: imutabilidade por período, determinismo, data_sources declara LAB vs GOLDEN, "Pendente" sem dado.
- pdf: gera arquivo válido (%PDF) quando chromium presente (skip com aviso quando ausente — registrar skipped, não fingir pass).
- n8n: workflows V2 resolvem referências (atualizar tests/workflows.test.mjs).
- SUITE ATUAL (58) VERDE.

Manager (node --test + tsx):
- PDF route: 401/403 tenant, stream só para arquivo dentro do cliente (path traversal rejeitado), PDF_UNAVAILABLE honesto.
- Identity confirm: guardas, payload de correção.
- SUITE ATUAL (25) VERDE.

## 6. Invariantes

- LAB e GOLDEN nunca se misturam (existente; estender a snapshots/PDF com data_sources).
- Nada de agente de código na operação: todos os fluxos novos são endpoints + UI (n8n opcional nesta rodada para os fluxos novos; instalação via script existente).
- Idempotência em todos os endpoints novos.
- O primeiro clean-room NÃO publica: para em PROPOSED/WAITING_APPROVAL (política já existente).
