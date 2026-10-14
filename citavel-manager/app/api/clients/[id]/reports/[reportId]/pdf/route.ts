import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { fail } from '../../../../../_utils';
import { getReportPdf } from '@/lib/report-pdf';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  try {
    const actor = await requireSession();
    const { id, reportId } = await params;
    const engineRoot = process.env.CITAVEL_ENGINE_PATH || '/Users/pedro/Documents/CITAVEL/citavel-engine';
    const { data, filename } = await getReportPdf({ actor, clientId: id, reportId, db, engineRoot });
    return new Response(new Uint8Array(data), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"` },
    });
  } catch (error) { return fail(error); }
}
