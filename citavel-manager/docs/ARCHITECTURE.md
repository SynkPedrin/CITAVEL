# Arquitetura — CITÁVEL Manager 2.0

O Manager é uma **central de visualização e relatórios**. Não executa medições de IA, não publica conteúdo e não orquestra agentes.

```
Navegador ──▶ Manager (Next.js 16, app router, :3002)
                ├─ Auth/RBAC (sessão httpOnly, Postgres)
                ├─ Google / SEO ◀── Search Console API (OAuth da agência, sync diário via n8n → /api/internal/gsc/sync)
                ├─ Presença em IA ◀── texto colado pelo operador → parser determinístico → revisão humana → banco
                └─ Relatórios ── snapshot imutável → HTML/CSS de impressão → Chromium (playwright-core, no próprio Manager) → PDF privado
Postgres (citavel-manager-db) · .runtime/ (config criptografada, PDFs 0600)
Engine CITÁVEL (:8788) — legado; o Manager não depende dele para operar (render de PDF só como reserva).
```

## Navegação
- Global: **Clientes** · **Configurações** (admins: Integrações, Usuários e acessos, Plataforma) · Perfil · Sair.
- Cliente: **Google / SEO** · **Presença em IA** · **Relatórios**. Rotas antigas (`/clients/[id]/<seção>`, `/admin`, `/admin/clients`, automações, operação, sistema) redirecionam; os dados antigos continuam no banco.

## Código
| Área | Arquivos |
|---|---|
| Clientes / escopo de acesso | `lib/clients.ts` (`clientScope`, `requireClientAccess`), `app/clients/**` |
| Google | `lib/gsc/*` (OAuth, API, sync, métricas, classificador), `components/google-section.tsx` |
| Presença em IA | `lib/ai-measurement/{parse,metrics,service,briefing}.ts`, `components/ai-import.tsx`, `components/ai-presence.tsx` |
| Relatórios | `lib/report/{snapshot-v2,narrative-v2,template-v2,render,service}.ts` (v1 mantido para relatórios antigos) |
| Tabelas novas | `ai_measurements`, `ai_measurement_platforms`, `ai_measurement_competitors`, `ai_measurement_findings`, `ai_measurement_revisions` (aditivas) |

Layouts e páginas do Next.js renderizam em paralelo: **cada página de cliente verifica o acesso de novo** (`requireClientAccess`), além do layout.
