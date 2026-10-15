import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { secretMatches } from '@/lib/security';
import { enqueueDailyForAll, runPendingJobs } from '@/lib/gsc/sync';
// Job API for the n8n scheduler. n8n only holds this trigger secret; Google tokens never leave the Manager.
export async function POST(request: Request) {
  const secret = process.env.GSC_JOB_SECRET || '';
  if (secret.length < 32 || !secretMatches(request.headers.get('x-citavel-job-secret') || '', secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const queued = await enqueueDailyForAll();
    const fresh = queued.filter(q => q.created).map(q => q.jobId);
    // Run sequentially to stay within per-user Search Console quota.
    after(async () => { await runPendingJobs().catch(() => {}); });
    return NextResponse.json({ ok: true, bindings: queued.length, queued: fresh.length, skipped: queued.length - fresh.length, jobs: queued }, { status: 202 });
  } catch { return NextResponse.json({ error: 'GSC_SCHEDULE_FAILED' }, { status: 500 }); }
}
export async function GET(request: Request) {
  const secret = process.env.GSC_JOB_SECRET || '';
  if (secret.length < 32 || !secretMatches(request.headers.get('x-citavel-job-secret') || '', secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { db } = await import('@/lib/db');
  const jobs = await db.gscSyncJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, type: true, status: true, errorCode: true, rowsImported: true, finishedAt: true } });
  return NextResponse.json({ jobs });
}
