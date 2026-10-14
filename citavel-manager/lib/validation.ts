import { z } from 'zod';
import { ROLES } from './security';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12, 'Use uma senha com pelo menos 12 caracteres.').max(128).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes.');
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
export const clientKeySchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,62}$/);
const domainSchema = z.string().trim().max(512).refine(value => {
  try { const url = new URL(value.includes('://') ? value : `https://${value}`); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !!url.hostname && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { return false; }
}, 'Informe um domínio público válido.');
export const clientCreateSchema = z.object({
  clientKey: clientKeySchema.optional(), name: z.string().trim().min(2).max(150), brandName: z.string().trim().min(2).max(150),
  domain: domainSchema, industry: z.string().trim().min(2).max(300), location: z.string().trim().min(2).max(300),
  city: z.string().trim().max(150).optional(), state: z.string().trim().max(100).optional(),
  priorityServices: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  market: z.string().trim().max(500).optional(), goals: z.array(z.string().trim().max(300)).max(20).default([]),
}).strict();
export const clientUpdateSchema = clientCreateSchema.partial().omit({ clientKey: true }).extend({ status: z.enum(['ACTIVE', 'PAUSED']).optional() }).strict();
export const runSchema = z.object({ mode: z.enum(['ONBOARDING', 'BASELINE', 'WEEKLY', 'CONTENT', 'MONITOR', 'REPORT']).default('WEEKLY'), confirmed: z.literal(true) }).strict();
export const userCreateSchema = z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, role: z.enum(ROLES), clientIds: z.array(z.string().min(1).max(128)).max(100).default([]), temporaryPassword: passwordSchema.optional(), tempPassword: passwordSchema.optional() }).strict();
export const userUpdateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), role: z.enum(ROLES).optional(), clientIds: z.array(z.string().min(1).max(128)).max(100).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(), resetPassword: z.boolean().optional() }).strict();
export const actionUpdateSchema = z.object({ status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'DISMISSED', 'OPEN', 'APPROVED', 'IMPLEMENTED', 'BLOCKED']) }).strict();
export const actionRejectSchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();
export const goldenPlatforms = ['ChatGPT', 'Gemini', 'Perplexity', 'Google AI Mode', 'Copilot'] as const;
export const identityDecisionSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
  corrections: z.object({
    description: z.string().trim().max(2000).optional(),
    tagline: z.string().trim().max(300).optional(),
    official_domain: z.string().trim().max(512).optional(),
  }).strict().optional(),
}).strict();
export const cleanroomSchema = z.object({
  brandName: z.string().trim().min(2).max(150),
  officialDomain: domainSchema.optional(),
}).strict();
export const goldenImportSchema = z.object({
  platform: z.enum(goldenPlatforms),
  promptExternalId: z.string().trim().min(1).max(128),
  response: z.string().trim().min(20, 'Cole a resposta completa observada (mínimo de 20 caracteres).').max(20000),
  timestamp: z.string().trim().min(1).max(64).refine(value => !Number.isNaN(new Date(value).getTime()), 'Informe uma data e hora válidas.'),
}).strict();
export const contentUpdateSchema = z.object({ status: z.enum(['APPROVED', 'PUBLISHED']), publishedUrl: z.string().url().max(2048).optional() }).strict().refine(value => value.status !== 'PUBLISHED' || value.publishedUrl?.startsWith('https://'), { message: 'Informe a URL HTTPS do conteúdo publicado.' });
