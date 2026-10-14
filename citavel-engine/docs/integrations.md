# Integrações CITAVEL

Ollama é descoberto em runtime e o menor modelo de texto adequado é selecionado automaticamente. O piloto usa qwen3.5:4b. LAB não faz busca web; URLs citadas pelo modelo são observações não verificadas, não prova de consulta à fonte.

Gemini usa um único segredo em `.runtime/gemini.key`, permissão 0600 e montagem somente leitura no container. O arquivo não é incluído nos workflows, Git, planilha ou dashboard. O cliente OAuth e a chave informada como GA4 não são suficientes para ler Analytics: são necessários autorização OAuth com escopo analytics.readonly e property ID numérico. Nenhuma credencial existente é alterada.

Search Console, GA4 e GTM têm adaptadores de leitura em `core/google.mjs`. IDs desconhecidos permanecem null. Sem OAuth válido, são CONFIG_REQUIRED/CREDENTIAL_REQUIRED. GTM não publica alterações. O monitor continua calculando resultados locais quando essas integrações não estão disponíveis.

Google Sheets: 16 abas no schema do briefing; workflow 09 cria e sincroniza somente após `automation.google_sheets_enabled=true`, configuração que exige autorização do usuário para a conta escolhida. A credencial referenciada é a única disponível no n8n: Google Sheets - Clinica VET. Enquanto a conta não for autorizada, nenhum pedido ao Google Sheets é feito. As 16 tabelas também existem em `clients/{id}/data/sheets/`.

Publicação: conteúdo permanece DRAFT e noindex. `scripts/page-status.mjs` aprova somente depois de preencher/remover os marcadores. PUBLISHED registra uma publicação manual já realizada no domínio do cliente; não envia nada a WordPress, GitHub ou Vercel. Adaptadores de publicação externos ficam para conexão posterior, sem auto-publish.

Documentação oficial consultada: https://docs.n8n.io/hosting/cli-commands/ ; https://ai.google.dev/api ; https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
