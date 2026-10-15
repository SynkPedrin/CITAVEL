# Report Engine

`Relatórios → Gerar relatório` → tipo (**Google / SEO**, **Presença em IA**, **Completo**), período do Google, medição de IA, formato (**Executivo** ou **Completo**) → prévia com avisos → **Gerar PDF**.

Pipeline: `snapshot-v2` (imutável, SHA-256) → `template-v2` (HTML/CSS de impressão, sem JavaScript) → Chromium do próprio Manager (`lib/report/render.ts`, JS desligado, rede bloqueada exceto `data:`) → `.runtime/reports/<cliente>/<snapshot>.pdf` (0600).

O snapshot registra `client`, `report_type`, `format`, `period`, cobertura do Google, dados do Search Console, `ai_measurement_ids` + `ai_measurement_versions`, proveniência, `template_version`, `created_by`, `generated_at`. Editar uma medição depois **não** altera relatórios gerados.

Identidade: capa preta com a arte verde-lima e o logotipo reais (`lib/report/assets`, derivados de `public/brand`), indicadores na capa, faixas de seção pretas numeradas, páginas brancas, rodapé com paginação (CSS `@page`, ausente na capa). Fonte Inter (Open Sans como reserva).

Regras: seções sem dados são omitidas ou marcadas *Indisponível*; nenhum zero substitui ausência; variações só com período anterior comparável (≥ 80 % dos dias com dados); a narrativa é determinística, separa Google e IA e não afirma causalidade.

Acesso: gerar = operadores; visualizar/baixar = usuários autorizados do cliente; download por link de 5 min vinculado ao usuário; visualizações e downloads auditados (`system_events`). Relatórios v1 antigos continuam visualizáveis.
