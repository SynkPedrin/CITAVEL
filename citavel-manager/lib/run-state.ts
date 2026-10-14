export const STAGES: Record<string, string[]> = {
  ONBOARDING: ['INGEST', 'AUDIT', 'DEMAND', 'INTELLIGENCE', 'ACTION', 'CONTENT', 'MONITOR', 'REPORT'],
  BASELINE: ['AUDIT', 'DEMAND', 'INTELLIGENCE', 'ACTION', 'REPORT'],
  WEEKLY: ['AUDIT', 'DEMAND', 'INTELLIGENCE', 'ACTION', 'MONITOR', 'REPORT'],
  CONTENT: ['CONTENT', 'REPORT'], MONITOR: ['MONITOR', 'REPORT'], REPORT: ['REPORT'],
};
export type StageResult = { stage: string; status: 'SUCCESS' | 'PARTIAL' | 'ERROR' | 'SKIPPED'; counts: Record<string, number>; durationMs: number | null };
export function engineStages(mode: string) {
  if (!STAGES[mode]) throw new Error('MODE_INVALID');
  return STAGES[mode];
}
export function summarizeStage(input: any, clientId: string, stage: string): StageResult {
  if (input?.client_id !== clientId || input?.stage !== stage || !['SUCCESS', 'PARTIAL', 'ERROR', 'SKIPPED'].includes(input?.status)) throw new Error('ENGINE_RESULT_NOT_CONFIRMED');
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.summary || {})) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) counts[key] = value;
  return { stage, status: input.status, counts, durationMs: typeof input.duration_ms === 'number' ? input.duration_ms : null };
}
export function finalRunStatus(stages: StageResult[]) {
  if (!stages.length || stages.every(s => s.status === 'ERROR')) return 'FAILED';
  return stages.some(s => s.status === 'ERROR' || s.status === 'PARTIAL') ? 'PARTIAL' : 'SUCCESS';
}
