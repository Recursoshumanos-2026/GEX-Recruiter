import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const env = { ALLOWED_ORIGIN: 'https://recursoshumanos-2026.github.io', APPLICATIONS_ENABLED: 'false', PROSPECT_CHANNEL_ID: '8' };
const fixture = [
  { id: 158883, title: 'Analista de Dados Sênior', vacancy_status_id: 1,
    description: '<h3>Responsabilidades</h3><ul><li>Construir pipelines</li></ul>', remote: 1,
    city: null, state: null },
  { id: 158921, title: 'Analista de CS', vacancy_status_id: 1, remote: 1,
    description: null },
  { id: 100, title: 'Vaga encerrada', vacancy_status_id: 3,
    description: '<p>Não deve aparecer</p>' }
];

test('listagem pública preserva descrições disponíveis, não inventa ausentes e exclui encerradas', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/login-api')) return new Response(JSON.stringify({ token: 'fake-token' }), { status: 200 });
    if (String(url).includes('/vacancies/filter')) return new Response(JSON.stringify({ data: fixture }), { status: 200 });
    throw new Error('Unexpected upstream request: ' + url);
  };
  try {
    const request = new Request('https://worker.invalid/api/vagas', {
      headers: { Origin: env.ALLOWED_ORIGIN }
    });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].id, 158883);
    assert.equal(body.data[0].description, fixture[0].description);
    assert.equal(body.data[1].description, null);
    assert.equal(body.data.some(v => v.id === 100), false);
    assert.equal(calls.filter(call => call.url.includes('/vacancies/filter')).length, 1);
    assert.equal(calls.some(call => call.url.includes('/prospects')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sem campo description no filtro, frontend deve informar indisponibilidade', async () => {
  // Contract check: an omitted field is not treated as a successful synchronization.
  const source = await (await import('node:fs/promises')).readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /safeJobDescription\(job\.description\)/);
  assert.match(source, /A descrição completa desta oportunidade ainda não está disponível/);
  assert.match(source, /function vacancyBenefitsMarkup\(/);
  assert.match(source, /class="job-apply-button job-details-link"/);
  assert.match(source, /function renderQuestionnaire\(/);
  assert.doesNotMatch(source, /document\.write\(/);
});
