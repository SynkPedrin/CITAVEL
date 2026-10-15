# Deploy

## Estado atual (14/10/2026)
- **Não há ambiente de produção pública.** `app.citavel.ai` não tem DNS; `citavel.ai` é o site institucional (GitHub Pages) e **não** deve receber o Manager.
- O ambiente operacional é local: Manager em `127.0.0.1:3002` (build de produção), Postgres `citavel-manager-db`, n8n compartilhado.

## Local (ambiente atual)
```sh
cd citavel-manager
git log -1                         # versão
npx dotenv -e .env.local -- prisma db push --skip-generate   # schema aditivo
npm run build
ALLOW_INSECURE_LOCAL_HTTP=true npm run start                   # PATH com /Users/pedro/.local/toolchain/node/bin
```
Rollback local: `git checkout <commit anterior> && npm ci && npm run build` e reiniciar; banco: `pg_restore` do dump em `_backup-*` (só se o schema anterior exigir — as mudanças 2.0 são aditivas).

## Produção (quando houver servidor + DNS)
Pré-requisitos: servidor com Docker; registro DNS do domínio do Manager apontando para ele; **novo** client secret OAuth (o que foi exposto deve ser revogado); URI `https://<domínio>/api/integrations/google/callback` cadastrada no Google Cloud.
```sh
cp deploy/.env.production.example deploy/.env.production && chmod 600 deploy/.env.production   # preencher
./deploy/release.sh      # backup do banco → build da imagem (tag = commit) → schema aditivo → troca → health check → rollback automático se falhar
```
Migração de dados do ambiente local: `pg_dump -Fc` do `citavel-manager-db` → `pg_restore` no `db` de produção; copiar `.runtime/reports` para o volume `runtime` (mantendo 0600). Os tokens Google criptografados só funcionam com o mesmo `GOOGLE_TOKEN_KEY`; caso contrário, reconectar o Google após o deploy.
n8n: apontar o workflow `citavelGscSyncV1` para `https://<domínio>/api/internal/gsc/sync` com o mesmo `GSC_JOB_SECRET`.
