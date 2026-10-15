import fs from 'node:fs/promises';
import { requireSession, assertClient } from '@/lib/auth';
import { HttpError } from '@/lib/security';
import { db } from '@/lib/db';
import { assetFile } from '@/lib/brand/service';
import { fail } from '../../../../_utils';
// Serves a stored logo to authorized users of THIS client. Pending logos are visible to operators for review only.
export async function GET(_r: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const actor = await requireSession(); const { id, assetId } = await params; await assertClient(actor, id);
    const a = await db.brandAsset.findUnique({ where: { id: assetId } });
    if (!a || a.clientId !== id || a.verificationStatus === 'REJECTED') throw new HttpError(404, 'Logo não encontrada.', 'NOT_FOUND');
    if (a.verificationStatus !== 'APPROVED' && ['CLIENT_ADMIN', 'CLIENT_VIEWER'].includes(actor.role)) throw new HttpError(404, 'Logo não encontrada.', 'NOT_FOUND');
    const body = await fs.readFile(assetFile(a.storageKey));
    return new Response(new Uint8Array(body), { headers: { 'content-type': a.mimeType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'content-disposition': 'inline' } });
  } catch (e) { return fail(e); }
}
