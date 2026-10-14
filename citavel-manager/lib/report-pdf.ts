import path from 'node:path';
import fs from 'node:fs/promises';
import { Actor, HttpError, permitsClient } from './security';

export function resolveClientPdfPath(engineRoot: string, engineClientId: string, filePath: string): string | null {
  if (!filePath || path.isAbsolute(filePath)) return null;
  const base = path.resolve(engineRoot, 'clients', engineClientId);
  const resolved = path.resolve(base, filePath);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

export interface ReportPdfDb {
  report: { findUnique(args: any): Promise<any> };
}
interface ReportPdfDeps {
  actor: Actor | null;
  clientId: string;
  reportId: string;
  db: ReportPdfDb;
  engineRoot: string;
  readFile?: (file: string) => Promise<Buffer>;
}

export async function getReportPdf({ actor, clientId, reportId, db, engineRoot, readFile }: ReportPdfDeps) {
  if (!actor) throw new HttpError(401, 'Faça login para continuar.', 'AUTH_REQUIRED');
  const report = await db.report.findUnique({ where: { id: reportId }, include: { client: { select: { id: true, organizationId: true, engineClientId: true, clientKey: true } } } });
  if (!report || report.clientId !== clientId) throw new HttpError(404, 'Relatório não encontrado.', 'NOT_FOUND');
  if (!permitsClient(actor, report.client)) throw new HttpError(403, 'Este cliente não está disponível para sua conta.', 'TENANT_FORBIDDEN');
  const filePath = typeof report.filePath === 'string' ? report.filePath : '';
  const resolved = filePath.endsWith('.pdf') ? resolveClientPdfPath(engineRoot, report.client.engineClientId, filePath) : null;
  if (!resolved) throw new HttpError(404, 'PDF_UNAVAILABLE', 'PDF_UNAVAILABLE');
  let data: Buffer;
  try { data = await (readFile || fs.readFile)(resolved); }
  catch { throw new HttpError(404, 'PDF_UNAVAILABLE', 'PDF_UNAVAILABLE'); }
  const period = report.periodStart ? new Date(report.periodStart).toISOString().slice(0, 10) : String(report.externalId || 'report');
  return { data, filename: `citavel-${report.client.clientKey}-${period}.pdf` };
}
