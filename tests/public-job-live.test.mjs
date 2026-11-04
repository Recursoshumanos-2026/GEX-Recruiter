import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

// Read-only integration test: private ATS endpoints are mocked. The only real
// network operation is GET on a publicly published GEX job page.
test('public GEX job page exposes real description to details endpoint', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET' });
    if (target === 'https://api.recrutei.com.br/api/v1/login-api') {
      return new Response(JSON.stringify({ token: 'mock-only' }), { status: 200 });
    }
    if (target.startsWith('https://api.recrutei.com.br/api/v2/vacancies/filter')) {
      return new Response(JSON.stringify({ data: [{
        id: 158883, title: 'Analista de Dados Sênior',
        slug: '158883-analista-de-dados-senior', vacancy_status_id: 1, remote: 1
      }] }), { status: 200 });
    }
    if (target === 'https://jobs.recrutei.com.br/gex-corporation/vacancy/158883-analista-de-dados-senior') {
      return realFetch(url, options);
    }
    throw new Error('Unexpected network target: ' + target);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.invalid/api/vagas/158883'),
      { RECRUTEI_API_KEY: 'mock', RECRUTEI_API_SECRET: 'mock',
        RECRUTEI_EMAIL: 'mock@example.invalid', RECRUTEI_PASSWORD: 'mock' });
    assert.equal(response.status, 200);
    const body = (await response.json()).data;
    assert.equal(body.id, 158883);
    assert.ok(body.description && body.description.includes('O time de Dados da GEX'),
      'The public Recrutei vacancy must include its real Job Description');
    assert.equal(body.contract_model, 'Pessoa Jurídica');
    assert.equal(calls.filter(c => c.url.includes('jobs.recrutei.com.br')).length, 1);
    assert.equal(calls.some(c => c.url.includes('/prospects')), false);
    console.log('PASS: real public description is available, matching the numeric vacancy ID.');
  } finally {
    globalThis.fetch = realFetch;
  }
});
