import { getSession, assertRequestMutation } from '@/lib/auth';
import { signLink, snapshotFor } from '@/lib/report/service';
import { HttpError } from '@/lib/security';
import { ok, fail } from '../../../../../_utils';
// Issues a 5-minute download URL bound to the requesting user.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    assertRequestMutation(request); const actor = await getSession(); const { id, snapshotId } = await params;
    const snap = await snapshotFor(actor, id, snapshotId);
    if (snap.pdfStatus !== 'READY') throw new HttpError(409, 'O PDF deste relatório não está disponível.', 'PDF_UNAVAILABLE');
    const { exp, sig } = signLink(snap.id, actor!.id);
    return ok({ url: `/api/clients/${id}/report-snapshots/${snap.id}/pdf?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() });
  } catch (e) { return fail(e); }
}
