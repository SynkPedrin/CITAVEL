# Segurança

Senhas usam bcrypt. Sessões usam token aleatório armazenado como hash em Postgres e cookie httpOnly, sameSite strict; HTTPS é obrigatório em produção.

Mutations exigem Origin igual a APP_URL e X-Citavel-Request: 1. Login tem rate limit persistido. Queries são filtradas por organização e cliente atribuído. Segredos n8n, Gemini e Google nunca voltam ao browser.

Google Sheets fica PENDING_AUTHORIZATION. O Manager não usa a credencial Google Sheets - Clinica VET.
