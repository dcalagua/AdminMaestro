// Genera el PDF del manual desde el HTML local (mismas capturas).
import { chromium } from 'playwright';
const [html, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, colorScheme: 'light' });
await page.goto(`file://${html}`, { waitUntil: 'networkidle' });
// Fuerza la carga de todas las imágenes diferidas antes de imprimir.
await page.evaluate(async () => {
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => i.setAttribute('loading', 'eager'));
  await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
  await document.fonts.ready;
});
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: out, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font:8.5px Arial,sans-serif;color:#5d6b7e;padding:0 14mm;display:flex;justify-content:space-between"><span>Manual del Admin Maestro · EBIM · QAS · 12-nov-2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('ok', out);
