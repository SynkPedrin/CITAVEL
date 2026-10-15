// Persistence for imported AI measurements: server-side validation, provenance (extracted vs edited),
// conservative GOLDEN rule, and versioning (an edit stores the previous state in ai_measurement_revisions).
import { z } from 'zod';
import { db as prisma } from '../db';
import { HttpError, type Actor } from '../security';
import { parseMeasurement, providerLabel, PARSER_VERSION, type Parsed } from './parse';
import { indicators } from './metrics';
import { competitiveInput, validateCompetitive, syncMeasurementCompetitors } from '../competitive/service';
import { resolveMissingLogos } from '../brand/service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const count = z.number().int().min(0).max(1_000_000).nullable().optional();
const evidence = z.object({ line: z.number().int().min(0), text: z.string().max(400) }).nullable().optional();
export const measurementInput = z.object({
  title: z.string().trim().min(3).max(160),
  source: z.string().trim().min(2).max(200),
  methodology: z.string().trim().min(2).max(300),
  methodologyVersion: z.string().trim().max(60).nullable().optional(),
  classification: z.enum(['LAB', 'GOLDEN', 'QUALITATIVE']),
  periodStart: day, periodEnd: day, executedAt: day,
  rawText: z.string().min(20).max(400_000),
  platforms: z.array(z.object({
    provider: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/), label: z.string().trim().max(80).optional(),
    model: z.string().trim().max(200).nullable().optional(), collectionMethod: z.string().trim().max(200).nullable().optional(),
    promptCount: count, observationCount: count, mentionCount: count, recommendationCount: count, citationCount: count,
  }).strict()).max(20),
  competitors: z.array(z.object({ name: z.string().trim().min(2).max(120), platform: z.string().trim().max(120).nullable().optional(), evidence: z.string().max(400).nullable().optional() }).strict()).max(100),
  sources: z.array(z.object({ url: z.string().trim().url().max(500).refine(u => /^https?:\/\//i.test(u), 'URL inválida'), evidence: z.string().max(400).nullable().optional() }).strict()).max(200),
  findings: z.array(z.object({ type: z.enum(['STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'CONCLUSION', 'LIMITATION', 'EVIDENCE']), text: z.string().trim().min(2).max(2000), evidence: z.string().max(400).nullable().optional() }).strict()).max(200),
  competitiveAnalysis: competitiveInput.optional(),
  acknowledgeSensitive: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
}).strict();
export type MeasurementInput = z.infer<typeof measurementInput>;

/** Validates an operator-reviewed measurement; throws HttpError with a readable message. */
export function validateReviewed(input: MeasurementInput, parsed: Parsed) {
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) throw new HttpError(400, 'O início do período é posterior ao fim.', 'INVALID_PERIOD');
  const seen = new Set<string>();
  for (const p of input.platforms) {
    if (seen.has(p.provider)) throw new HttpError(400, `Plataforma repetida: ${p.provider}.`, 'DUPLICATE_PLATFORM'); seen.add(p.provider);
    for (const f of ['mentionCount', 'recommendationCount', 'citationCount'] as const)
      if (p[f] != null && p.observationCount != null && p[f]! > p.observationCount) throw new HttpError(400, `${p.label || p.provider}: ${f} maior que observações.`, 'IMPOSSIBLE_VALUE');
  }
  if (input.classification === 'GOLDEN') {
    const methods = input.platforms.length > 0 && input.platforms.every(p => (p.collectionMethod || '').trim());
    const consumer = input.platforms.every(p => !/\bapi\b|automatiz/i.test(p.collectionMethod || ''));
    const evidenceCount = input.findings.filter(f => f.type === 'EVIDENCE').length;
    if (!methods || !consumer || evidenceCount === 0) throw new HttpError(400, 'GOLDEN exige método de coleta em interface de consumo para cada plataforma e ao menos uma evidência original (resposta, link ou print). Classifique como QUALITATIVA ou LAB.', 'GOLDEN_REQUIRES_EVIDENCE');
  }
  validateCompetitive(input.competitiveAnalysis ?? [], input.platforms);
  if (parsed.warnings.some(w => w.code === 'SENSITIVE_DATA') && !input.acknowledgeSensitive) throw new HttpError(400, 'O texto contém possíveis dados pessoais ou de saúde. Remova-os ou confirme que são apenas dados institucionais.', 'SENSITIVE_DATA');
}

/** Builds the stored structured record, marking each value as extracted (with evidence) or edited by a human. */
export function structure(input: MeasurementInput, parsed: Parsed) {
  const edits: string[] = [];
  const platforms = input.platforms.map(p => {
    const auto = parsed.platforms.find(x => x.provider === p.provider);
    const fields = (['model', 'collectionMethod', 'promptCount', 'observationCount', 'mentionCount', 'recommendationCount', 'citationCount'] as const).map(f => {
      const value = (p as any)[f] ?? null; const extracted = auto ? (auto as any)[f].value : null;
      const edited = value !== extracted; if (edited) edits.push(`${p.provider}.${f}`);
      return [f, { value, evidence: !edited && auto ? (auto as any)[f].evidence : null, origin: value == null ? 'MISSING' : edited ? 'EDITED' : 'EXTRACTED' }];
    });
    return { provider: p.provider, label: p.label || auto?.label || providerLabel(p.provider), ...Object.fromEntries(fields), declaredRates: auto?.declaredRates || [] };
  });
  for (const k of ['periodStart', 'periodEnd', 'executedAt', 'source', 'methodology', 'methodologyVersion'] as const) if ((input[k] ?? null) !== (parsed.meta[k].value ?? null)) edits.push(`meta.${k}`);
  if (input.classification !== parsed.suggestedClassification) edits.push('classification');
  return { parserVersion: PARSER_VERSION, format: parsed.format, suggestedClassification: parsed.suggestedClassification, classificationReason: parsed.classificationReason,
    metaEvidence: Object.fromEntries(Object.entries(parsed.meta).map(([k, v]) => [k, v.evidence])),
    platforms, competitors: input.competitors, competitiveAnalysis: input.competitiveAnalysis ?? [], sources: input.sources, findings: input.findings, edits };
}

const rows = (input: MeasurementInput) => ({
  platforms: input.platforms.map(p => ({ provider: p.provider, model: p.model ?? null, collectionMethod: p.collectionMethod ?? null, promptCount: p.promptCount ?? null, observationCount: p.observationCount ?? null, mentionCount: p.mentionCount ?? null, recommendationCount: p.recommendationCount ?? null, citationCount: p.citationCount ?? null })),
  competitors: input.competitors.map(c => ({ name: c.name, platform: c.platform ?? null, evidence: c.evidence ?? null })),
  findings: [...input.findings.map(f => ({ type: f.type, title: f.text.slice(0, 160), description: f.text, evidence: f.evidence ?? null })), ...input.sources.map(s => ({ type: 'SOURCE', title: s.url, description: null, evidence: s.evidence ?? null }))],
});

export async function createMeasurement(clientId: string, actor: Actor, raw: unknown, db = prisma) {
  const input = measurementInput.parse(raw); const parsed = parseMeasurement(input.rawText);
  validateReviewed(input, parsed);
  const r = rows(input);
  return db.$transaction(async tx => {
    const m = await tx.aiMeasurement.create({ data: {
      clientId, title: input.title, source: input.source, methodology: input.methodology, methodologyVersion: input.methodologyVersion ?? null, classification: input.classification,
      periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, executedAt: input.executedAt ?? null, rawText: input.rawText,
      structuredData: structure(input, parsed) as any, warnings: parsed.warnings as any, importedById: actor.id,
      platforms: { create: r.platforms }, competitors: { create: r.competitors }, findings: { create: r.findings },
    } });
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
    await syncMeasurementCompetitors(tx, { organizationId: client.organizationId, clientId }, m.id, input.competitiveAnalysis ?? [], input.competitors.map(c => c.name));
    await tx.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'AI_MEASUREMENT', message: 'AI_MEASUREMENT_IMPORTED', metadata: { measurement_id: m.id, classification: m.classification, platforms: r.platforms.length } } });
    return m;
  }).then(m => { void resolveMissingLogos(clientId); return m; });
}

export async function updateMeasurement(clientId: string, measurementId: string, actor: Actor, raw: unknown, db = prisma) {
  const input = measurementInput.parse(raw); const parsed = parseMeasurement(input.rawText);
  validateReviewed(input, parsed);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'ai-m-' + measurementId}))`;
    const old = await tx.aiMeasurement.findUnique({ where: { id: measurementId }, include: { platforms: true, competitors: true, findings: true } });
    if (!old || old.clientId !== clientId) throw new HttpError(404, 'Medição não encontrada.', 'NOT_FOUND');
    const { platforms, competitors, findings, ...base } = old;
    await tx.aiMeasurementRevision.create({ data: { measurementId, version: old.version, changedById: actor.id, note: input.note || null, previousData: { ...base, platforms, competitors, findings } as any } });
    await tx.aiMeasurementPlatform.deleteMany({ where: { measurementId } }); await tx.aiMeasurementCompetitor.deleteMany({ where: { measurementId } }); await tx.aiMeasurementFinding.deleteMany({ where: { measurementId } });
    const r = rows(input);
    const m = await tx.aiMeasurement.update({ where: { id: measurementId }, data: {
      title: input.title, source: input.source, methodology: input.methodology, methodologyVersion: input.methodologyVersion ?? null, classification: input.classification,
      periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, executedAt: input.executedAt ?? null, rawText: input.rawText,
      structuredData: structure(input, parsed) as any, warnings: parsed.warnings as any, version: old.version + 1, updatedById: actor.id,
      platforms: { create: r.platforms }, competitors: { create: r.competitors }, findings: { create: r.findings },
    } });
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
    await syncMeasurementCompetitors(tx, { organizationId: client.organizationId, clientId }, m.id, input.competitiveAnalysis ?? [], input.competitors.map(c => c.name));
    await tx.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'AI_MEASUREMENT', message: 'AI_MEASUREMENT_REVISED', metadata: { measurement_id: m.id, version: m.version } } });
    return m;
  }).then(m => { void resolveMissingLogos(clientId); return m; });
}

export async function setArchived(clientId: string, measurementId: string, actor: Actor, archived: boolean, db = prisma) {
  const m = await db.aiMeasurement.findUnique({ where: { id: measurementId } });
  if (!m || m.clientId !== clientId) throw new HttpError(404, 'Medição não encontrada.', 'NOT_FOUND');
  await db.aiMeasurement.update({ where: { id: m.id }, data: { status: archived ? 'ARCHIVED' : 'APPROVED', updatedById: actor.id } });
  await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'AI_MEASUREMENT', message: archived ? 'AI_MEASUREMENT_ARCHIVED' : 'AI_MEASUREMENT_RESTORED', metadata: { measurement_id: m.id } } });
}

export async function listMeasurements(clientId: string, opts: { includeArchived?: boolean } = {}, db = prisma) {
  const list = await db.aiMeasurement.findMany({ where: { clientId, ...(opts.includeArchived ? {} : { status: 'APPROVED' }) }, include: { platforms: true, competitors: true, findings: true }, orderBy: [{ executedAt: 'desc' }, { importedAt: 'desc' }] });
  return list.map(m => ({ ...m, indicators: indicators(m.platforms.map(p => ({ ...p, label: providerLabel(p.provider) }))) }));
}
export type MeasurementWithIndicators = Awaited<ReturnType<typeof listMeasurements>>[number];
