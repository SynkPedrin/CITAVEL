# CITÁVEL Manager

Painel local multi-cliente sobre o Engine CITÁVEL existente. O Manager lê dados reais, aplica isolamento por cliente e mantém automações no backend.

## Requirements

Node.js 20.9+, Docker Desktop e o Engine ativo em http://localhost:8788. O Manager usa http://localhost:3002 porque a porta 3000 já é usada neste computador.

## Setup

    npm install
    npm run setup
    npm run db:up
    npm run db:migrate
    npm run seed
    npm run dev

O setup cria .env.local e .runtime/ACESSO-ADMIN.txt com permissões privadas. A senha não aparece no terminal. O primeiro administrador é admin@citavel.local.

## Environment

Veja .env.example. Nunca coloque chaves, tokens, senhas ou OAuth em arquivos versionados.

## Database

O PostgreSQL roda no container citavel-manager-db na porta local 55432. db:migrate aplica o schema Prisma.

## Running Manager

Abra http://localhost:3002. A Cosentino é carregada por npm run sync:cosentino. As sessões usam cookie httpOnly e sameSite strict.

## Connecting n8n

O adapter server-side suporta API, webhook autenticado e estado pendente. Use N8N_API_KEY para API, ou N8N_WEBHOOK_URL com N8N_WEBHOOK_SECRET e o header X-Citavel-Secret. O workflow citavelCosentV1 não é alterado. Se o webhook ainda não estiver instalado, o ciclo pode ser executado pelo endpoint privado do Engine local e fica registrado como fallback.

## Importing Cosentino

sync:cosentino é idempotente e importa cliente, prompts, respostas LAB, páginas, fontes, gaps, ações, experimentos, relatórios e estados de integração. O Manager não usa a credencial Google Sheets - Clinica VET.

## Creating Users

Administradores podem criar usuários pela API administrativa. A senha temporária exige troca no primeiro acesso. CLIENT_ADMIN e CLIENT_VIEWER só recebem clientes atribuídos.

## Creating Client

Use Administração, Clientes, Novo cliente. O wizard grava os dados, registra eventos de provisionamento e inicia a sincronização.

## Testing

Use npm run typecheck, npm run build e npm test. Os 47 testes do Engine continuam no projeto original.

## Production Notes

O localhost é desenvolvimento. Para app.citavel.ai, mova Manager e PostgreSQL para uma VPS ou serviço gerenciado, mantenha n8n privado, habilite HTTPS e configure APP_URL.
