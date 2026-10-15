import { requireOperator, assertClient } from '@/lib/auth';
import { loadSearchData } from '@/lib/gsc/insights';
import { db } from '@/lib/db';
import { ok, fail } from '../../../../_utils';
// What a report would contain, without creating anything.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireOperator(); const { id } = await params; await assertClient(actor, id);
    const u = new URL(request.url); const kind = u.searchParams.get('kind') || 'COMPLETO';
    const out: any = { warnings: [] as string[] };
    if (kind !== 'IA') {
      const g = await loadSearchData(id, { period: u.searchParams.get('period') || '28d', from: u.searchParams.get('from') || undefined, to: u.searchParams.get('to') || undefined });
      out.google = g.state === 'READY' ? { state: 'READY', property: g.binding.property.siteUrl, requested: { start: g.period.start, end: g.period.end, days: g.period.days }, available: { start: g.coverage.firstDate, end: g.coverage.lastDate, days: g.coverage.currentDays }, comparable: g.coverage.comparable, clicks: g.totals.clicks, impressions: g.totals.impressions } : { state: g.state };
      if (g.state !== 'READY') out.warnings.push('Sem dados do Google: as seções do Google aparecerão como indisponíveis.');
      else { if (g.coverage.currentDays < g.period.days) out.warnings.push(`O Google tem dados para ${g.coverage.currentDays} de ${g.period.days} dias do período.`); if (!g.coverage.comparable) out.warnings.push('Sem período anterior comparável: o relatório não mostrará variações percentuais.'); }
    }
    if (kind !== 'GOOGLE') {
      const mid = u.searchParams.get('measurementId');
      const m = await db.aiMeasurement.findFirst({ where: { clientId: id, status: 'APPROVED', ...(mid ? { id: mid } : {}) }, orderBy: [{ executedAt: 'desc' }, { importedAt: 'desc' }], select: { id: true, title: true, classification: true, version: true, executedAt: true, _count: { select: { platforms: true } } } });
      out.ai = m ? { state: 'READY', ...m } : { state: 'NONE' };
      if (!m) out.warnings.push(kind === 'IA' ? 'Não há medição de IA aprovada: importe uma medição antes de gerar este relatório.' : 'Sem medição de IA aprovada: a seção de IA aparecerá como indisponível.');
      else if (m.classification === 'QUALITATIVE') out.warnings.push('A medição de IA é qualitativa: o relatório não mostrará percentuais de IA.');
    }
    return ok(out);
  } catch (e) { return fail(e); }
}
