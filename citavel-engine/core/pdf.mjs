import { redactError } from './store.mjs';

/**
 * PDF renderer (V2, contrato §2). Usa playwright-core com Chromium:
 * process.env.CHROMIUM_PATH (container: /usr/bin/chromium-browser via apk) →
 * fallback channel 'chrome' (host dev). Sem renderer disponível a resposta é
 * {status:'PDF_UNAVAILABLE'} honesta — o HTML executivo continua disponível.
 */
export async function renderPdf(html, outPath, options = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (error) {
    return { status: 'PDF_UNAVAILABLE', note: 'playwright-core não está instalado; HTML executivo permanece disponível. ' + redactError(error) };
  }
  const executablePath = options.executablePath ?? (process.env.CHROMIUM_PATH || null);
  let browser = null;
  try {
    // Chromium do sistema (apk) não carrega o sandbox do Chrome bundled.
    const launch = executablePath ? { executablePath, args: ['--no-sandbox'] } : { channel: 'chrome' };
    browser = await chromium.launch(launch);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: options.timeoutMs ?? 60000 });
    await page.pdf({
      path: outPath, format: 'A4', printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return { status: 'PDF_RENDERED', path: outPath };
  } catch (error) {
    return { status: 'PDF_UNAVAILABLE', note: 'Renderer Chromium indisponível (CHROMIUM_PATH ou Chrome instalado ausente). ' + redactError(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
