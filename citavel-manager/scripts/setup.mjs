import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const file = new URL('../.env.local', import.meta.url);
try { await fs.access(file); console.log('Configuração privada já existe. Nenhum segredo foi alterado.'); }
catch {
  const password = randomBytes(24).toString('base64url');
  const dbPassword = randomBytes(32).toString('hex');
  const env = `APP_URL=http://localhost:3002\nPORT=3002\nDATABASE_URL=postgresql://citavel:${dbPassword}@127.0.0.1:55432/citavel_manager\nPOSTGRES_PASSWORD=${dbPassword}\nSEED_ADMIN_EMAIL=admin@citavel.local\nSEED_ADMIN_PASSWORD=${password}\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nCITAVEL_ENGINE_PATH=/Users/pedro/Documents/CITAVEL/citavel-engine\nCITAVEL_ENGINE_URL=http://localhost:8788\nN8N_BASE_URL=http://localhost:5678\nN8N_API_KEY=\nN8N_MODE=WEBHOOK\nN8N_WEBHOOK_URL=http://localhost:5678/webhook/citavel-manager-run\nN8N_STATUS_URL=http://localhost:5678/webhook/citavel-manager-status\nN8N_WEBHOOK_SECRET=${randomBytes(48).toString('hex')}\nENGINE_EVENT_SECRET=${randomBytes(48).toString('hex')}\nOLLAMA_BASE_URL=http://localhost:11434\nDOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker\nN8N_CONTAINER=n8n\nSYNC_INTERVAL_MS=600000\n# Opcionais — preencha quando for conectar os provedores externos:\n# GOOGLE_CLIENT_ID=\n# GOOGLE_CLIENT_SECRET=\n# GEMINI_API_KEY=\n`;
  await fs.writeFile(file, env, { mode: 0o600, flag: 'wx' });
  await fs.mkdir(new URL('../.runtime', import.meta.url), { recursive: true, mode: 0o700 });
  await fs.writeFile(new URL('../.runtime/ACESSO-ADMIN.txt', import.meta.url), `CITÁVEL Manager — acesso local\nURL: http://localhost:3002\nE-mail: admin@citavel.local\nSenha temporária: ${password}\n\nTroque a senha no primeiro acesso. Este arquivo contém uma credencial privada.\n`, { mode: 0o600 });
  console.log('Configuração gerada com permissões privadas. Acesso em .runtime/ACESSO-ADMIN.txt; nenhum segredo foi impresso.');
}
