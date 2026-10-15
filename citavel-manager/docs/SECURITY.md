# Segurança

Senhas usam bcrypt. Sessões usam token aleatório armazenado como hash em Postgres e cookie httpOnly, sameSite strict; HTTPS é obrigatório em produção.

Mutations exigem Origin igual a APP_URL e X-Citavel-Request: 1. Login tem rate limit persistido. Queries são filtradas por organização e cliente atribuído. Segredos n8n, Gemini e Google nunca voltam ao browser.

Google Sheets fica PENDING_AUTHORIZATION. O Manager não usa a credencial Google Sheets - Clinica VET.

## Manager 2.0
- Escopo de cliente centralizado em `lib/clients.ts` (`clientScope`, combinado sempre com `AND`); cada página de cliente revalida o acesso. Regressão coberta por teste (`tests/manager2-db.test.ts`) e pelo E2E (visualizador não abre outro cliente).
- `/admin/*` só para SUPER_ADMIN/ADMIN; operadores (ANALYST, exibido como "Operador da agência") importam medições e geram relatórios; perfis de cliente apenas leem.
- Texto importado é dado não confiável: nunca executado; renderizado escapado (React / `esc` / `cssStr` no PDF); instruções embutidas geram aviso.
- Rate limit por usuário: análise (30/min), importação/edição (20/min), geração de relatório (10/min). Mutations exigem Origin + `X-Citavel-Request`.
- PDF renderizado com JavaScript desligado e rede bloqueada; armazenamento privado 0600; links temporários por usuário; auditoria de geração, visualização e download.
- Dados de saúde: o importador alerta para CPF, telefone, paciente/laudo/prontuário e exige confirmação; consultas do Google com padrões pessoais são mascaradas na importação.
- Dependências: `npm audit --omit=dev` aponta 4 itens "high" no CLI do Prisma (`effect`, `deepmerge-ts`), fora do caminho das requisições; a correção sugerida rebaixa o Prisma — mantido e anotado para a próxima atualização.
