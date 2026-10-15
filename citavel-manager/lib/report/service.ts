// Report Engine orchestration: SNAPSHOT → HTML TEMPLATE → Chromium (Engine) → PDF in private storage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, hkdfSync } from 'node:crypto';
import { db } from '../db';
import { Actor, HttpError, permitsClient, secretMatches } from '../security';
import { createSnapshot, type SectionId } from './snapshot';
import { renderReportHtml, footerTemplate } from './template';
import { createSnapshotV2, type ReportRequest } from './snapshot-v2';
import { renderReportHtmlV2 } from './template-v2';
import { renderPdf } from './render';

// Private storage outside public/ and outside the Engine's served folders; files are 0600.
export const reportRoot = () => path.resolve(process.env.REPORT_STORAGE_DIR || path.join(process.cwd(), '.runtime', 'reports'));
export function pdfPathFor(clientId: string, snapshotId: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(clientId) || !/^[a-z0-9]{10,40}$/i.test(snapshotId)) throw new Error('INVALID_ID');
  return path.join(reportRoot(), clientId, `${snapshotId}.pdf`);
}

export async function generateReport(clientId: string, actor: Actor, opts: { reportType: 'EXECUTIVO' | 'TECNICO' | 'COMPLETO'; language: 'pt-BR' | 'en'; sections: SectionId[]; period?: string; from?: string; to?: string; propertyId?: string }, render: (html: string, footer: string) => Promise<Buffer> = renderViaEngine) {
  const snap = await createSnapshot(clientId, actor.id, opts);
  const html = renderReportHtml(snap.content, { snapshotId: snap.id, hash: snap.contentHash });
  try {
    const pdf = await render(html, footerTemplate(snap.content));
    const file = pdfPathFor(clientId, snap.id);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, pdf, { mode: 0o600, flag: 'wx' });
    await db.reportSnapshot.update({ where: { id: snap.id }, data: { pdfStatus: 'READY', pdfPath: path.relative(reportRoot(), file) } });
    await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'REPORT_ENGINE', message: 'REPORT_GENERATED', metadata: { snapshot_id: snap.id, type: opts.reportType, period: { start: snap.periodStart, end: snap.periodEnd }, hash: snap.contentHash } } });
    return { snapshotId: snap.id, pdfStatus: 'READY' };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : 'PDF_FAILED';
    await db.reportSnapshot.update({ where: { id: snap.id }, data: { pdfStatus: 'FAILED', pdfError: detail } });
    return { snapshotId: snap.id, pdfStatus: 'FAILED', error: detail };
  }
}

async function renderViaEngine(html: string, footer: string) {
  const engine = (process.env.CITAVEL_ENGINE_URL || 'http://localhost:8788').replace(/\/$/, '');
  const r = await fetch(`${engine}/v1/render/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, footer_html: footer }), signal: AbortSignal.timeout(120_000), cache: 'no-store' });
  if (!r.ok || r.headers.get('content-type') !== 'application/pdf') { let note = ''; try { note = ((await r.json()) as any).note || ''; } catch { /* */ } throw new Error(`ENGINE_PDF_${r.status} ${note}`.trim()); }
  return Buffer.from(await r.arrayBuffer());
}

// ---- Temporary download links: HMAC over snapshot + actor + expiry; still requires the same logged-in user. ----
const linkKey = () => Buffer.from(hkdfSync('sha256', process.env.SESSION_SECRET || '', 'citavel-report-link', 'v1', 32));
export const LINK_TTL_MS = 5 * 60_000;
export function signLink(snapshotId: string, actorId: string, now = Date.now()) {
  const exp = now + LINK_TTL_MS; const sig = createHmac('sha256', linkKey()).update(`${snapshotId}.${actorId}.${exp}`).digest('base64url');
  return { exp, sig };
}
export function verifyLink(snapshotId: string, actorId: string, exp: number, sig: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp < now || exp > now + LINK_TTL_MS + 1000) return false;
  const expected = createHmac('sha256', linkKey()).update(`${snapshotId}.${actorId}.${exp}`).digest('base64url');
  return secretMatches(sig, expected);
}

export async function snapshotFor(actor: Actor | null, clientId: string, snapshotId: string) {
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  const snap = await db.reportSnapshot.findUnique({ where: { id: snapshotId }, include: { client: { select: { id: true, organizationId: true, clientKey: true } } } });
  if (!snap || snap.clientId !== clientId) throw new HttpError(404, 'Relatório não encontrado.', 'NOT_FOUND');
  if (!permitsClient(actor, snap.client)) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
  return snap;
}

/** Renders any stored snapshot (v1 legacy or v2) to HTML. */
export function snapshotHtml(snap: { id: string; content: any; contentHash: string }) {
  return snap.content?.schema === 'citavel-report-snapshot/v2' ? renderReportHtmlV2(snap.content, { snapshotId: snap.id, hash: snap.contentHash }) : renderReportHtml(snap.content, { snapshotId: snap.id, hash: snap.contentHash });
}

/** Manager 2.0 generation: snapshot v2 → HTML → Chromium in the Manager (Engine only as fallback) → private storage. */
export async function generateReportV2(clientId: string, actor: Actor, req: ReportRequest, render: (html: string) => Promise<Buffer> = renderLocalOrEngine) {
  const snap = await createSnapshotV2(clientId, actor.id, req);
  try {
    const pdf = await render(snapshotHtml(snap));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('RENDER_OUTPUT_NOT_PDF');
    const file = pdfPathFor(clientId, snap.id);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, pdf, { mode: 0o600, flag: 'wx' });
    await db.reportSnapshot.update({ where: { id: snap.id }, data: { pdfStatus: 'READY', pdfPath: path.relative(reportRoot(), file) } });
    await db.systemEvent.create({ data: { clientId, actorId: actor.id, source: 'REPORT_ENGINE', message: 'REPORT_GENERATED', metadata: { snapshot_id: snap.id, kind: req.kind, format: req.format, period: { start: snap.periodStart, end: snap.periodEnd }, ai_measurements: (snap.content as any).ai_measurement_versions, hash: snap.contentHash } } });
    return { snapshotId: snap.id, pdfStatus: 'READY' };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : 'PDF_FAILED';
    await db.reportSnapshot.update({ where: { id: snap.id }, data: { pdfStatus: 'FAILED', pdfError: detail } });
    return { snapshotId: snap.id, pdfStatus: 'FAILED', error: detail };
  }
}
async function renderLocalOrEngine(html: string) {
  try { return await renderPdf(html); }
  catch (local) { try { return await renderViaEngine(html, ''); } catch { throw local; } }
}
