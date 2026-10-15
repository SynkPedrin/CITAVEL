import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { snapshotFor, snapshotHtml } from '@/lib/report/service';
import { fail } from '../../../../../_utils';
// "Visualizar": the same HTML used for the PDF, rendered from the immutable snapshot, sandboxed (no scripts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const actor = await getSession(); const { id, snapshotId } = await params;
    const snap = await snapshotFor(actor, id, snapshotId);
    await db.systemEvent.create({ data: { clientId: id, actorId: actor!.id, source: 'REPORT_ENGINE', message: 'REPORT_VIEWED', metadata: { snapshot_id: snap.id } } });
    const html = snapshotHtml(snap);
    return new Response(html.replace('<style>', '<link rel="icon" href="data:,"><style>body{max-width:210mm;margin:0 auto;box-shadow:0 0 40px rgba(0,0,0,.15)}.sec{padding:12mm 15mm}'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" } });
  } catch (e) { return fail(e); }
}
