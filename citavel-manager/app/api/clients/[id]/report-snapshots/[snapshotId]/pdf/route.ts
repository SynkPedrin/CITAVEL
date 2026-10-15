import fs from 'node:fs/promises';
import path from 'node:path';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/security';
import { reportRoot, snapshotFor, verifyLink } from '@/lib/report/service';
import { fail } from '../../../../../_utils';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const actor = await getSession(); const { id, snapshotId } = await params;
    const snap = await snapshotFor(actor, id, snapshotId);
    const u = new URL(request.url);
    if (!verifyLink(snap.id, actor!.id, Number(u.searchParams.get('exp')), u.searchParams.get('sig') || '')) throw new HttpError(403, 'Link de download expirado. Gere um novo link.', 'LINK_EXPIRED');
    if (snap.pdfStatus !== 'READY' || !snap.pdfPath) throw new HttpError(404, 'PDF indisponível.', 'PDF_UNAVAILABLE');
    const root = reportRoot(); const file = path.resolve(root, snap.pdfPath);
    if (!file.startsWith(root + path.sep)) throw new HttpError(404, 'PDF indisponível.', 'PDF_UNAVAILABLE');
    const data = await fs.readFile(file);
    await db.systemEvent.create({ data: { clientId: id, actorId: actor!.id, source: 'REPORT_ENGINE', message: 'REPORT_DOWNLOADED', metadata: { snapshot_id: snap.id, role: actor!.role } } });
    return new Response(new Uint8Array(data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="citavel-${snap.client.clientKey}-${snap.periodStart}-${snap.periodEnd}.pdf"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (e) { return fail(e); }
}
