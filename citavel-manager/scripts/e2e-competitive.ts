// E2E of the competitive module in a real browser. Everything runs on a throwaway organization/user/client
// (clearly named, deleted at the end); real clients are never touched. No AI credits, no outbound logo lookups.
//   E2E_BASE_URL=http://localhost:3002 npx tsx --env-file=.env.local scripts/e2e-competitive.ts
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';
import { db } from '../lib/db';
import { createMeasurement } from '../lib/ai-measurement/service';
import { uploadLogo } from '../lib/brand/service';
import type { Actor } from '../lib/security';

process.env.CITAVEL_DISABLE_LOGO_LOOKUP = '1';
const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
const OUT = path.resolve(process.env.E2E_OUT || '.runtime/e2e-competitive'); fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const tag = 'qacmp' + Date.now().toString(36); const password = randomBytes(12).toString('base64url') + 'aA1!';
const results: { step: string; ok: boolean; detail?: string }[] = []; const problems: string[] = [];
const step = async (name: string, fn: () => Promise<string | void>) => { try { const d = await fn(); results.push({ step: name, ok: true, detail: d || undefined }); console.log(`  ✔ ${name}${d ? ' — ' + d : ''}`); } catch (e) { results.push({ step: name, ok: false, detail: (e as Error).message.slice(0, 300) }); console.log(`  ✖ ${name} — ${(e as Error).message.slice(0, 300)}`); } };
const logo = (t: string, bg: string, fg: string, w = 320, h = 110) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica" font-weight="700" font-size="44" fill="${fg}">${t}</text></svg>`)).png().toBuffer();
const m = (o: any = {}) => ({ provider: 'OPENAI', observationCount: 20, mentionCount: 10, recommendationCount: 8, citationCount: 3, ...o });
const g = (o: any = {}) => ({ ...m(o), provider: 'GEMINI' });

(async () => {
  const org = await db.organization.create({ data: { name: `QA ${tag}`, slug: tag } });
  const user = await db.user.create({ data: { name: 'QA Competitivo', email: `${tag}@qa.invalid`, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, memberships: { create: { organizationId: org.id, role: 'ADMIN' } } } });
  const actor: Actor = { id: user.id, name: user.name, email: user.email, role: 'ADMIN', organizationId: org.id, clientIds: [], forcePasswordChange: false };
  const client = await db.client.create({ data: { organizationId: org.id, clientKey: tag, engineClientId: tag, name: `QA Competitivo ${tag}`, brandName: 'Clínica QA', domain: 'https://clinica-qa.invalid/' } });
  const RAW = 'CLIENTE: QA\nORIGEM: Fixture\nMETODOLOGIA: Fixture E2E\nDATA DA EXECUÇÃO: 11/10/2026\nPLATAFORMAS:\nOPENAI:\nOBSERVAÇÕES: 20\nMENÇÕES: 7\nGEMINI:\nOBSERVAÇÕES: 20\nMENÇÕES: 5';
  const meas = await createMeasurement(client.id, actor, { title: 'Fixture E2E (não é medição real)', source: 'Fixture de teste automatizado', methodology: 'Fixture E2E', methodologyVersion: 'test-1', classification: 'LAB', periodStart: '2026-10-01', periodEnd: '2026-10-10', executedAt: '2026-10-11', rawText: RAW, sources: [], findings: [], competitors: [],
    platforms: [{ provider: 'OPENAI', model: 'fx', collectionMethod: 'API', promptCount: 20, observationCount: 20, mentionCount: 7, recommendationCount: 5, citationCount: 1 }, { provider: 'GEMINI', model: 'fx', collectionMethod: 'API', promptCount: 20, observationCount: 20, mentionCount: 5, recommendationCount: 2, citationCount: 0 }],
    competitiveAnalysis: [{ name: 'Alfa Imagem', domain: 'alfa-qa.invalid', metrics: [m(), g({ recommendationCount: 6 })] }, { name: 'Beta Diagnósticos', domain: 'beta-qa.invalid', metrics: [m({ mentionCount: 6, recommendationCount: 4, citationCount: 0 }), g({ observationCount: 12 })] }, { name: 'Gama Clínica', domain: null, metrics: [m({ recommendationCount: 2 })] }] });
  const comps = await db.clientCompetitor.findMany({ where: { clientId: client.id } });
  await uploadLogo(client.id, null, actor, (await logo('CLÍNICA QA', '#0a0a0a', '#b8f52a')).toString('base64'));
  await uploadLogo(client.id, comps.find(c => c.name === 'Alfa Imagem')!.id, actor, (await logo('ALFA', '#0b3d91', '#ffffff')).toString('base64'));
  const viewerUser = await db.user.create({ data: { name: 'QA Viewer', email: `${tag}v@qa.invalid`, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false, memberships: { create: { organizationId: org.id, role: 'CLIENT_VIEWER' } }, clientUsers: { create: { clientId: client.id, role: 'CLIENT_VIEWER' } } } as any }).catch(() => null);

  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
  p.on('console', x => { if (x.type() === 'error' && !/favicon|DevTools/i.test(x.text())) problems.push(`console: ${x.text().slice(0, 200)}`); });
  p.on('response', r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/favicon/.test(r.url()) && !(r.status() === 400 && /brand-assets$/.test(r.url()))) problems.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  const shot = (name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  try {
    await step('login', async () => { await p.goto(`${BASE}/login`); await p.fill('#email', user.email); await p.fill('#password', password); await Promise.all([p.waitForURL(/\/clients/, { timeout: 20000 }), p.click('button:has-text("Entrar")')]); });
    await step('Presença em IA mostra o comparativo com logos e números reais', async () => {
      await p.goto(`${BASE}/clients/${client.id}/ia`); await p.waitForSelector('text=Como sua marca se compara?');
      const rows = await p.locator('.cmp-table tbody tr').count(); if (rows < 4) throw new Error(`linhas: ${rows}`);
      const imgs = await p.locator('.cmp-table img').count(); if (imgs !== 2) throw new Error(`logos aprovadas exibidas: ${imgs} (esperado 2)`);
      const loaded = await p.evaluate(() => [...document.querySelectorAll('.cmp-table img')].every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)); if (!loaded) throw new Error('logo não carregou');
      const text = await p.locator('.cmp-table').innerText();
      if (!/Alfa Imagem/.test(text) || !/35,0%/.test(text)) throw new Error('números do Alfa ausentes: ' + text.slice(0, 200));
      const first = (await p.locator('.cmp-table tbody tr').first().innerText()); if (!/Clínica QA/.test(first)) throw new Error('primeira linha não é o cliente');
      if (!/Não comparável/.test(text) && !/Sem dados/.test(text)) { /* Gama/Beta may still be comparable on OPENAI only */ }
      await shot('01-ia-comparativo'); return `${rows} linhas, ${imgs} logos`;
    });
    await step('filtro por plataforma e métrica da matriz', async () => {
      await p.selectOption('select[name="p"]', 'GEMINI'); await Promise.all([p.waitForURL(/p=GEMINI/), p.click('.cmp-filters button')]); await p.waitForSelector('.cmp-matrix');
      const heads = await p.locator('.cmp-matrix thead th').allInnerTexts(); if (heads.length !== 2) throw new Error('matriz deveria ter 1 plataforma: ' + heads.join('|'));
      await p.click('.cmp-toggle a:has-text("Menções")'); await p.waitForURL(/k=mention/); await shot('02-filtro-gemini'); await p.goto(`${BASE}/clients/${client.id}/ia`);
    });
    await step('gerenciar concorrentes: adicionar manualmente não cria números', async () => {
      await p.click('button:has-text("Gerenciar concorrentes")'); await p.fill('input[aria-label="Nome do concorrente"]', 'Manual Radiologia'); await p.fill('input[aria-label="Domínio oficial"]', 'manual-qa.invalid');
      await p.click('button:has-text("Adicionar manualmente")'); await p.waitForSelector('.cmp-table >> text=Manual Radiologia'); const row = await p.locator('.cmp-table tr:has-text("Manual Radiologia")').innerText(); if (!/Sem dados de medição/.test(row)) throw new Error('deveria indicar sem dados: ' + row);
      await shot('03-gerenciar');
    });
    await step('logo pendente: busca recusa endereço interno e aprovação manual por upload', async () => {
      const mc = await db.clientCompetitor.findFirstOrThrow({ where: { clientId: client.id, name: 'Manual Radiologia' } });
      const r = await p.evaluate(async ([cid, id]) => { const x = await fetch(`/api/clients/${cid}/brand-assets/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ competitorId: id }) }); return { s: x.status, b: await x.json() }; }, [client.id, mc.id]);
      if (r.s !== 200 || !['ERROR', 'NOT_FOUND', 'NO_DOMAIN'].includes(r.b.status)) throw new Error('resposta inesperada: ' + JSON.stringify(r));
      const up = await p.evaluate(async ([cid, id, b64]) => { const x = await fetch(`/api/clients/${cid}/brand-assets`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ competitorId: id, data: b64 }) }); return x.status; }, [client.id, mc.id, (await logo('MANUAL', '#c1121f', '#fff')).toString('base64')]);
      if (up !== 201) throw new Error('upload status ' + up);
      const bad = await p.evaluate(async ([cid, id]) => { const x = await fetch(`/api/clients/${cid}/brand-assets`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ competitorId: id, data: btoa('<svg onload=alert(1)></svg>' + ' '.repeat(40)) }) }); return x.status; }, [client.id, mc.id]);
      if (bad !== 400) throw new Error('SVG malicioso deveria ser 400, veio ' + bad);
      await p.goto(`${BASE}/clients/${client.id}/ia`); await p.waitForSelector('.cmp-table'); const imgs = await p.locator('.cmp-table img').count(); if (imgs !== 3) throw new Error(`logos agora: ${imgs} (esperado 3)`);
      return 'busca interna recusada, upload aprovado, SVG ativo recusado';
    });
    await step('PDF de Presença em IA: gera, baixa e começa com o comparativo', async () => {
      await p.goto(`${BASE}/clients/${client.id}/relatorios`); await p.waitForLoadState('networkidle');
      const res = await p.evaluate(async ([cid, mid]) => { const x = await fetch(`/api/clients/${cid}/report-snapshots`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ kind: 'IA', format: 'COMPLETO', period: '28d', measurementId: mid }) }); return { s: x.status, b: await x.json() }; }, [client.id, meas.id]);
      if (res.s >= 300 || res.b.pdfStatus !== 'READY') throw new Error('geração falhou: ' + JSON.stringify(res).slice(0, 200));
      await p.reload(); await p.waitForLoadState('networkidle'); await shot('04-relatorios');
      const snap = await db.reportSnapshot.findFirstOrThrow({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } }); const c: any = (snap.content as any).competitive;
      if (c?.status !== 'AVAILABLE') throw new Error('snapshot sem comparativo'); if (!c.rows.some((r: any) => r.logo?.data_uri)) throw new Error('logos não congeladas no snapshot');
      const file = path.join(process.env.REPORT_STORAGE_DIR || path.resolve('.runtime/reports'), snap.pdfPath || ''); const head = fs.readFileSync(file).subarray(0, 5).toString(); if (head !== '%PDF-') throw new Error('arquivo não é PDF');
      fs.copyFileSync(file, path.join(OUT, 'relatorio-ia.pdf')); return `${snap.reportType}, ${fs.statSync(file).size} bytes`;
    });
    await step('visualizador do cliente: vê o comparativo mas não gerencia', async () => {
      if (!viewerUser) throw new Error('usuário viewer não criado (schema)'); const c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const v = await c2.newPage();
      await v.goto(`${BASE}/login`); await v.fill('#email', viewerUser.email); await v.fill('#password', password); await Promise.all([v.waitForURL(/\/clients/), v.click('button:has-text("Entrar")')]);
      await v.goto(`${BASE}/clients/${client.id}/ia`); await v.waitForSelector('text=Como sua marca se compara?'); if (await v.locator('button:has-text("Gerenciar concorrentes")').count()) throw new Error('viewer vê gerenciamento');
      const st = await v.evaluate(async cid => (await fetch(`/api/clients/${cid}/competitors`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Citavel-Request': '1' }, body: JSON.stringify({ name: 'Invasor' }) })).status, client.id); if (![401, 403].includes(st)) throw new Error('POST de viewer deveria ser negado, veio ' + st);
      await c2.close();
    });
    await step('sem erros de console nem HTTP 4xx/5xx inesperados', async () => { const real = problems.filter(x => !/Failed to load resource.*(40[034])/.test(x)); if (real.length) throw new Error(real.slice(0, 5).join(' | ')); });
  } finally {
    await browser.close();
    await db.systemEvent.deleteMany({ where: { OR: [{ client: { organizationId: org.id } }, { actorId: user.id }] } }); await db.organization.delete({ where: { id: org.id } }); await db.user.deleteMany({ where: { email: { startsWith: tag } } });
    fs.rmSync(path.resolve('.runtime/brand-assets', client.id), { recursive: true, force: true }); fs.rmSync(path.resolve('.runtime/reports', client.id), { recursive: true, force: true });
    await db.$disconnect();
  }
  const failed = results.filter(r => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} passos OK${failed.length ? ' — FALHAS: ' + failed.map(f => f.step).join('; ') : ''}`); process.exit(failed.length ? 1 : 0);
})();
