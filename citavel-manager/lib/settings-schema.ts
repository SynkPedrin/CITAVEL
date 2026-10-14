import { z } from 'zod';

export const settingGroups = {
  ENGINE: { label: 'Engine CITÁVEL', fields: [{ key: 'CITAVEL_ENGINE_URL', label: 'Endereço do Engine', placeholder: 'http://localhost:8788' }] },
  N8N: { label: 'n8n', fields: [{ key: 'N8N_BASE_URL', label: 'Endereço do n8n', placeholder: 'http://localhost:5678' }, { key: 'N8N_API_KEY', label: 'Chave de API', secret: true }, { key: 'N8N_WEBHOOK_URL', label: 'Webhook de execução', placeholder: 'http://localhost:5678/webhook/citavel-manager-run' }, { key: 'N8N_WEBHOOK_SECRET', label: 'Segredo do webhook', secret: true }] },
  OLLAMA: { label: 'Ollama', fields: [{ key: 'OLLAMA_BASE_URL', label: 'Endereço do Ollama', placeholder: 'http://localhost:11434' }] },
  GEMINI: { label: 'Gemini', fields: [{ key: 'GEMINI_API_KEY', label: 'Chave de API', secret: true }] },
  GOOGLE: { label: 'Acesso Google', fields: [{ key: 'GOOGLE_CLIENT_ID', label: 'ID do cliente OAuth', placeholder: '…apps.googleusercontent.com' }, { key: 'GOOGLE_CLIENT_SECRET', label: 'Segredo do cliente OAuth', secret: true }] },
} satisfies Record<string, { label: string; fields: { key: string; label: string; placeholder?: string; secret?: boolean }[] }>;
export type SettingGroup = keyof typeof settingGroups;
export type SettingField = { key: string; label: string; placeholder?: string; secret?: boolean };
export const localServiceUrl = z.string().trim().max(2048).refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.hash; } catch { return false; }
}, 'Use um endereço local válido (localhost ou 127.0.0.1).');
export const settingUpdateSchema = z.object({ group: z.enum(['ENGINE','N8N','OLLAMA','GEMINI','GOOGLE']), values: z.record(z.string(), z.string().max(8192)) }).strict().superRefine(({ group, values }, ctx) => {
  const fields = settingGroups[group].fields as SettingField[];
  for (const [key,value] of Object.entries(values)) {
    if (!fields.some(f => f.key === key)) ctx.addIssue({ code: 'custom', message: 'Campo de configuração não permitido.', path: ['values',key] });
    else if (value && key.endsWith('_URL') && !localServiceUrl.safeParse(value).success) ctx.addIssue({ code: 'custom', message: 'Use um endereço local válido.', path: ['values',key] });
    else if (/[\r\n\0]/.test(value)) ctx.addIssue({ code: 'custom', message: 'Valor inválido.', path: ['values',key] });
  }
});
export const googleProviderSchema = z.enum(['GA4','SEARCH_CONSOLE','GOOGLE_SHEETS','GTM']);
export type GoogleProvider = z.infer<typeof googleProviderSchema>;
export const resourceSchemas = {
  GA4: z.object({ propertyId: z.string().trim().regex(/^\d+$/, 'Informe o ID numérico da propriedade.') }).strict(),
  SEARCH_CONSOLE: z.object({ siteUrl: z.string().trim().max(512).regex(/^(sc-domain:[a-zA-Z0-9.-]+|https?:\/\/[^\s]+)$/, 'Informe a propriedade verificada.') }).strict(),
  GOOGLE_SHEETS: z.object({ spreadsheetId: z.string().trim().regex(/^[a-zA-Z0-9_-]{20,150}$/, 'Informe o ID da planilha.') }).strict(),
  GTM: z.object({ accountId: z.string().trim().regex(/^\d+$/), containerId: z.string().trim().regex(/^\d+$/) }).strict(),
};
