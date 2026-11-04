import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const screenshotDir = process.env.SCREENSHOT_DIR || 'screenshots';
await mkdir(resolve(root, screenshotDir), { recursive: true });
const vacancy = { id: 158883, title: 'Analista de Dados Sênior',
  vacancy_status_id: 1, remote: 1, department: 'Dados',
  description: '<h3>Principais responsabilidades</h3><ul><li>Desenvolver pipelines de dados</li></ul><p>Atuação estratégica.</p><script>window.__injected=true</script><a href="javascript:alert(1)">Link inválido</a>' };
const requests = [];
const contentTypes = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    if (path.startsWith('/mock-api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (path === '/mock-api/health') return res.end(JSON.stringify({ applications_enabled: true }));
      if (path === '/mock-api/api/vagas') return res.end(JSON.stringify({ data: [vacancy] }));
      if (path === '/mock-api/api/candidatar') {
        requests.push(req.url);
        res.writeHead(500);return res.end(JSON.stringify({ message:'Not allowed in visual smoke test' }));
      }
      res.writeHead(404);return res.end('{}');
    }
    const safePath = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1));
    if (safePath.includes('..') || !/^[a-zA-Z0-9_.\/-]+$/.test(safePath)) {
      res.writeHead(404);return res.end('Not Found');
    }
    if (safePath === 'config.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`window.GEX_TALENTS_CONFIG = { API_BASE_URL: 'http://127.0.0.1:${server.address().port}/mock-api' };`);
    }
    res.setHeader('Content-Type', contentTypes[extname(safePath)] || 'application/octet-stream');
    return res.end(await readFile(resolve(root, safePath)));
  } catch (_) { res.writeHead(404);res.end('Not Found'); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport:{ width, height: 900 }, reducedMotion:'reduce' });
    const errors = [];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/*', route=>route.request().url().startsWith(base) ? route.continue() : route.abort());

    await page.goto(base);
    await page.locator('#jobsGrid .job-card').waitFor();
    assert.equal(await page.locator('.job-title-link').count(),1);
    await page.locator('.job-details-link').click();
    await page.locator('.vacancy-title').waitFor();
    assert.equal(await page.locator('.vacancy-title').textContent(), 'Analista de Dados Sênior');
    assert.match(page.url(), /vaga=158883/);
    assert.equal(await page.locator('.vacancy-description-content li').textContent(), 'Desenvolver pipelines de dados');
    assert.equal(await page.evaluate(()=>window.__injected), undefined);
    assert.equal(await page.locator('.vacancy-description-content script').count(),0);
    assert.equal(await page.locator('.vacancy-description-content a[href^="javascript"]').count(),0);
    assert.equal(await page.locator('.vacancy-benefits .benefit-card').count(),5);
    assert.equal(await page.locator('body > main > #sobre').isVisible(), false);
    assert.equal(await page.locator('body > main > #cultura').isVisible(), false);
    assert.equal(await page.locator('body > main > #beneficios').isVisible(), false);
    assert.equal(await page.locator('[data-apply="158883"]').count(),2);
    await page.locator('.vacancy-top-apply [data-apply="158883"]').click();
    assert.equal(await page.locator('#applyDialog').isVisible(),true);
    assert.equal(await page.locator('#vacancyId').inputValue(),'158883');
    assert.equal(await page.locator('[name="question_age"]').count(),1);
    await page.locator('#closeDialog').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:resolve(root,screenshotDir,`vaga-dados-${width}.png`),fullPage:true,animations:'disabled'});
    await page.close();
  }
  assert.equal(requests.length,0);
  console.log('PASS: navegação, descrição sanitizada, benefícios, questionário, responsividade e capturas desktop/mobile');
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
