import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { questionnaireFor } from '../questionnaires.js';

// Servidor e API inteiramente locais: nenhuma candidatura chega à Recrutei.
const root = resolve(import.meta.dirname, '..');
const requests = [];
let observationCompleted = true;
const jobs = [
  { id: 158928, title: 'Analista de Atendimento', vacancy_status_id: 1, remote: 1 },
  { id: 999999, title: 'Outra oportunidade', vacancy_status_id: 1, remote: 1 }
];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/mock-api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.endsWith('/health')) return res.end(JSON.stringify({ applications_enabled: true }));
      if (url.pathname.endsWith('/api/vagas')) return res.end(JSON.stringify({ data: jobs }));
      if (url.pathname.endsWith('/api/candidatar')) {
        let data = ''; for await (const chunk of req) data += chunk;
        requests.push(JSON.parse(data));
        res.statusCode = 201;
        return res.end(JSON.stringify({ application_created: true, profile_completed: true,
          tag_completed: true, observation_completed: observationCompleted }));
      }
      throw new Error('Unexpected API route');
    }
    const baseline = url.pathname.startsWith('/baseline/');
    const path = decodeURIComponent(url.pathname).replace(/^\/(baseline|current)\//, '') || 'index.html';
    if (path.includes('..') || !/^[\w/.-]+$/.test(path)) { res.writeHead(404); return res.end(); }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    if (path === 'config.js') return res.end(`window.GEX_TALENTS_CONFIG={API_BASE_URL:'http://127.0.0.1:${server.address().port}/mock-api'};`);
    const contents = baseline ? execFileSync('git', ['show', `${process.env.GEX_BASELINE_REF || '253641126defebd7761443fb913fb2550a32262b'}:${path}`], { cwd: root }) : await readFile(resolve(root, path));
    res.end(contents);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const open = async (version, id = 158928) => {
    await page.goto(`${base}/${version}/index.html?vaga=${id}`);
    await page.locator(`[data-apply="${id}"]`).click();
  };
  const fillBase = async () => {
    await page.locator('[name="name"]').fill('Pessoa Teste');
    await page.locator('[name="email"]').fill('teste@example.invalid');
    await page.locator('[name="telephone"]').fill('11999999999');
    await page.locator('[name="birthday"]').fill('1990-01-01');
    await page.locator('[name="intended_remuneration"]').fill('5000');
    await page.locator('[name="privacy"]').check();
  };
  const submit = () => page.locator('.submit-btn').click();
  await open('baseline', 999999);
  await page.evaluate(() => document.fonts.ready);
  const before = await page.screenshot();
  await open('current', 999999);
  await page.evaluate(() => document.fonts.ready);
  const after = await page.screenshot();
  assert.ok(before.equals(after), 'Outra vaga deve manter aparência idêntica à base aprovada');
  assert.equal(await page.locator('#vacancyQuestionnaire').isVisible(), false);
  assert.equal(await page.locator('[name^="question_"]').count(), 0);
  await fillBase(); await submit();
  await page.getByText('Candidatura enviada com sucesso! Seus dados foram recebidos pela GEX.').waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].questionnaire_answers, undefined);
  assert.equal(await page.locator('.submit-btn').isEnabled(), true);
  console.log('OK: outra vaga visualmente idêntica à base, sem questionário e com fluxo original.');

  await open('current');
  assert.equal(await page.locator('#vacancyQuestionnaire input[type="text"], #vacancyQuestionnaire input:not([type])').count(), 3);
  assert.equal(await page.locator('[name="question_experience"][type="radio"]').count(), 3);
  assert.equal(await page.locator('[name="question_channels"][type="checkbox"]').count(), 7);
  await fillBase(); await submit();
  assert.equal(requests.length, 1, 'Obrigatórias ausentes não podem enviar');
  for (const question of questionnaireFor('158928').questions) {
    const controls = page.locator(`[name="question_${question.id}"]`);
    if (question.type === 'text') await controls.fill(question.id === 'pj' ? '   ' : 'Resposta teste');
    else await controls.first().check();
  }
  await submit();
  assert.equal(requests.length, 1, 'Espaços não podem valer como resposta');
  await page.locator('[name="question_pj"]').fill('Sim');
  for (const id of ['retention', 'metrics', 'channels']) {
    const controls = page.locator(`[name="question_${id}"]`);
    await controls.first().uncheck();
    await submit();
    assert.equal(requests.length, 1, `Grupo ${id} exige ao menos uma resposta`);
    await controls.first().check();
    await controls.nth(1).check();
  }
  await page.locator('[name="question_experience"]').evaluateAll(inputs => inputs.forEach(input => input.checked = false));
  await submit();
  assert.equal(requests.length, 1, 'Escolha única obrigatória não pode ficar vazia');
  await page.locator('[name="question_experience"]').nth(1).check();
  await page.locator('[name="question_experience"]').first().check();
  assert.equal(await page.locator('[name="question_experience"]:checked').count(), 1);
  await submit();
  await page.getByText('Candidatura enviada com sucesso! Seus dados foram recebidos pela GEX.').waitFor();
  assert.equal(requests.length, 2);
  for (const id of ['retention', 'metrics', 'channels']) assert.equal(requests[1].questionnaire_answers[id].length, 2);
  assert.equal(await page.locator('.submit-btn').isDisabled(), true);
  console.log('OK: validação de texto, escolha única e cada grupo múltiplo; todas as seleções enviadas.');

  await page.locator('#closeDialog').click();
  await page.locator('[data-apply="158928"]').click();
  assert.equal(await page.locator('[name="question_pj"]').inputValue(), '');
  await fillBase();
  for (const question of questionnaireFor('158928').questions) {
    const controls = page.locator(`[name="question_${question.id}"]`);
    if (question.type === 'text') await controls.fill('Resposta preservada');
    else await controls.first().check();
  }
  observationCompleted = false;
  await submit();
  await page.getByText(/Sua candidatura foi criada, mas/).waitFor();
  assert.equal(await page.locator('.submit-btn').isDisabled(), true);
  assert.equal(await page.locator('[name="question_pj"]').inputValue(), 'Resposta preservada');
  assert.equal(requests.length, 3);
  assert.ok((await page.locator('#formMessage').textContent()).includes('Não reenvie'));
  console.log('OK: pendência da observação visível, respostas preservadas e reenvio bloqueado.');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator('#applyDialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Modal cabe na tela');
    assert.equal(await page.locator('#applyDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/questionario-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('OK: telas de 390 e 1440px sem overflow; nenhum erro JavaScript.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
