import { redirect, notFound } from 'next/navigation';
import { getSession, canOperate } from '@/lib/auth';
import { requireClientAccess } from '@/lib/clients';
import { db } from '@/lib/db';
import { providerLabel } from '@/lib/ai-measurement/parse';
import { AiImport, type Draft } from '@/components/ai-import';
export const dynamic = 'force-dynamic';
export default async function EditMeasurement({ params }: { params: Promise<{ id: string; measurementId: string }> }) {
  const actor = await getSession(); if (!actor) redirect('/login'); const { id, measurementId } = await params; await requireClientAccess(actor, id);
  if (!canOperate(actor)) redirect(`/clients/${id}/ia/${measurementId}`);
  const m = await db.aiMeasurement.findFirst({ where: { id: measurementId, clientId: id }, include: { platforms: true, competitors: true, findings: true, competitorMetrics: { include: { competitor: true } }, client: { select: { name: true } } } });
  if (!m) notFound();
  const sd = (m.structuredData || {}) as any;
  const initial: Draft = {
    title: m.title, source: m.source, methodology: m.methodology, methodologyVersion: m.methodologyVersion || '', classification: m.classification as Draft['classification'],
    periodStart: m.periodStart || '', periodEnd: m.periodEnd || '', executedAt: m.executedAt || '', rawText: m.rawText,
    platforms: m.platforms.map(p => { const sp = sd.platforms?.find((x: any) => x.provider === p.provider) || {}; return { provider: p.provider, label: providerLabel(p.provider), model: p.model, collectionMethod: p.collectionMethod, promptCount: p.promptCount, observationCount: p.observationCount, mentionCount: p.mentionCount, recommendationCount: p.recommendationCount, citationCount: p.citationCount, evidence: Object.fromEntries(Object.entries(sp).filter(([, v]: any) => v && typeof v === 'object' && 'evidence' in v).map(([k, v]: any) => [k, v.evidence])) }; }),
    competitors: m.competitors.map(c => ({ name: c.name, platform: c.platform, evidence: c.evidence })),
    competitive: [...m.competitorMetrics.reduce((map, x) => { const e = map.get(x.competitorId) ?? { name: x.competitor.name, domain: x.competitor.officialDomain || '', metrics: [] as any[] }; e.metrics.push({ provider: x.provider, observationCount: x.observationCount, mentionCount: x.mentionCount, recommendationCount: x.recommendationCount, citationCount: x.citationCount }); map.set(x.competitorId, e); return map; }, new Map<string, { name: string; domain: string; metrics: any[] }>()).values()],
    sources: m.findings.filter(f => f.type === 'SOURCE').map(f => ({ url: f.title, evidence: f.evidence })),
    findings: m.findings.filter(f => f.type !== 'SOURCE').map(f => ({ type: f.type, text: f.description || f.title, evidence: f.evidence })),
    warnings: (m.warnings as any) || [], suggestion: sd.suggestedClassification ? { value: sd.suggestedClassification, reason: sd.classificationReason } : null, metaEvidence: sd.metaEvidence || {},
  };
  return <div className="section-stack"><AiImport clientId={id} clientName={m.client.name} initial={initial} measurementId={m.id} /></div>;
}
