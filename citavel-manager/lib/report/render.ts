// PDF renderer inside the Manager (no dependency on manual patches in other containers).
// Chromium runs with JavaScript disabled and every network request blocked except inline data: assets.
let browserPromise: Promise<any> | null = null;
async function browser() {
  if (!browserPromise) browserPromise = (async () => {
    const { chromium } = await import('playwright-core');
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    return chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : { channel: 'chrome' });
  })().catch(e => { browserPromise = null; throw e; });
  return browserPromise;
}
export async function renderPdf(html: string): Promise<Buffer> {
  const b = await browser();
  const context = await b.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    await context.route('**/*', (route: any) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally { await context.close().catch(() => {}); }
}
