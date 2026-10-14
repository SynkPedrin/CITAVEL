# Arquitetura

O navegador conversa apenas com o Manager. As rotas validam sessão, organização, cliente atribuído e origem da mutação antes de consultar banco ou Engine.

O Engine permanece em CITAVEL_ENGINE_PATH e é lido por syncEngineClient. Os registros normalizados usam client_id e identificador externo estável para permitir reexecução idempotente. Respostas completas de IA e caminhos internos não são enviados ao navegador.

Fluxo: Browser → Manager/Auth → Prisma/Postgres; Manager → Engine; Manager → n8n; Engine → /api/internal/engine-event.

LAB e GOLDEN são preservados e exibidos em superfícies diferentes. Métricas de negócio sem fonte continuam pendentes.
