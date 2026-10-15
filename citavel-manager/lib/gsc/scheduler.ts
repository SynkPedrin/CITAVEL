// Automatic Google updates inside the Manager (does not depend on n8n being restarted or reachable).
// Every tick: queue today's update for every active binding (idempotent per day), then run all pending jobs.
// A Postgres advisory lock makes sure only one Manager instance works at a time.
import { db } from '../db';
import { enqueueDailyForAll, runPendingJobs } from './sync';

const TICK_MS = 10 * 60_000;
const LOCK_KEY = 72_310_001; // arbitrary, stable
type State = { started: boolean; running: boolean; lastTick: string | null; lastResult: string | null; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __citavelGscScheduler?: State };
export const schedulerState = () => (g.__citavelGscScheduler ||= { started: false, running: false, lastTick: null, lastResult: null });

export async function tick() {
  const st = schedulerState();
  if (st.running) return 'BUSY';
  st.running = true;
  try {
    const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
    if (!locked) return 'OTHER_INSTANCE';
    try {
      const queued = await enqueueDailyForAll({ trigger: 'SCHEDULER' });
      const run = await runPendingJobs();
      st.lastResult = `bindings=${queued.length} new=${queued.filter(q => q.created).length} ran=${run.ran.length} stale=${run.recoveredStale}`;
      if (queued.some(q => q.created) || run.ran.length || run.recoveredStale) console.log(JSON.stringify({ level: 'INFO', event: 'GSC_SCHEDULER_TICK', at: new Date().toISOString(), result: st.lastResult, jobs: run.ran }));
      return st.lastResult;
    } finally { await db.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`; }
  } catch (e) {
    st.lastResult = 'ERROR'; console.error(JSON.stringify({ level: 'ERROR', event: 'GSC_SCHEDULER_TICK_FAILED', message: (e as Error).message?.slice(0, 200) }));
    return 'ERROR';
  } finally { st.lastTick = new Date().toISOString(); st.running = false; }
}

export function startGscScheduler() {
  const st = schedulerState();
  if (st.started || process.env.GSC_SCHEDULER === 'off') return;
  st.started = true;
  setTimeout(() => { void tick(); }, 20_000).unref?.(); // catch up shortly after the server starts
  st.timer = setInterval(() => { void tick(); }, TICK_MS); st.timer.unref?.();
  console.log(JSON.stringify({ level: 'INFO', event: 'GSC_SCHEDULER_STARTED', every_minutes: TICK_MS / 60_000 }));
}
