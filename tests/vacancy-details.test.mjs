import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const env = { ALLOWED_ORIGIN: 'https://recursoshumanos-2026.github.io', APPLICATIONS_ENABLED: 'false', PROSPECT_CHANNEL_ID: '8' };
const fixture = [
  { id: 158883, title: 'Analista de Dados Sênior', vacancy_status_id: 1,
    description: '<h3>Responsabilidades</h3><ul><li>Construir pipelines</li></ul>', remote: 1,
    city: null, state: null },
  { id: 158921, title: 'Analista de CS', vacancy_status_id: 1, remote: 1,
    slug: '158921-analista-de-cs-afiliacao', description: null },
  { id: 161288, title: 'Líder Técnico de Dados', vacancy_status_id: 1, remote: 1,
    slug: '161288-lider-tecnico-de-dados', description: null },
  { id: 100, title: 'Vaga encerrada', vacancy_status_id: 3,
    description: '<p>Não deve aparecer</p>' }
];

function publicPage(id, flags = {}) {
  return new Response('<script id="__NEXT_DATA__" type="application/json">'+
    JSON.stringify({ props: { pageProps: { retorno: {
      error: false, finished: false, past: false, closed: false,
      vacancy: { id, description: '<p>Descrição pública</p>' }, ...flags
    } } } })+'</script>', { status: 200 });
}

test('listagem pública preserva descrições disponíveis, não inventa ausentes e exclui encerradas', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/login-api')) return new Response(JSON.stringify({ token: 'fake-token' }), { status: 200 });
    if (String(url).includes('/vacancies/filter')) return new Response(JSON.stringify({ data: fixture }), { status: 200 });
    if (String(url).includes('jobs.recrutei.com.br')) {
      const id = Number(String(url).match(/\/vacancy\/(\d+)-/)?.[1]);
      return publicPage(id, id === 161288 ? { error: true, closed: true, past: true } : {});
    }
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
    assert.equal(body.data.some(v => v.id === 161288), false);
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

test('detalhe consulta Job Description público pelo slug e valida o ID da vaga', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/login-api')) return new Response(JSON.stringify({ token: 'fake-token' }), { status: 200 });
    if (String(url).includes('/vacancies/filter')) return new Response(JSON.stringify({ data: fixture }), { status: 200 });
    if (String(url) === 'https://jobs.recrutei.com.br/gex-corporation/vacancy/158921-analista-de-cs-afiliacao') {
      assert.equal(options.redirect, 'follow');
      assert.equal(options.headers.Authorization, undefined);
      const data = { props: { pageProps: { retorno: { error: false, finished: false, past: false,
        vacancy: { id: 158921, description: '<h2>Sobre a vaga</h2><p>Atendimento aos afiliados.</p>',
          show_regime: 1, regime: { description: 'Pessoa Jurídica' } } } } } };
      return new Response('<!doctype html><script id="__NEXT_DATA__" type="application/json">'+
        JSON.stringify(data)+'</script>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    throw new Error('Unexpected mock fetch: '+url);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.invalid/api/vagas/158921'), env);
    assert.equal(response.status, 200);
    const result = (await response.json()).data;
    assert.equal(result.id, 158921);
    assert.match(result.description, /Atendimento aos afiliados/);
    assert.equal(result.contract_model, 'Pessoa Jurídica');
    assert.equal(calls.filter(call => call.url.includes('jobs.recrutei.com.br')).length, 1);
    assert.equal(calls.filter(call => call.url.includes('/prospects')).length, 0);
  } finally { globalThis.fetch = original; }
});

test('detalhe rejeita dados públicos de outra vaga e não mostra vagas encerradas', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/login-api')) return new Response(JSON.stringify({ token: 'fake-token' }), { status: 200 });
    if (String(url).includes('/vacancies/filter')) return new Response(JSON.stringify({ data: fixture }), { status: 200 });
    if (String(url).includes('jobs.recrutei.com.br')) return new Response(
      '<script id="__NEXT_DATA__" type="application/json">'+
      JSON.stringify({ props: { pageProps: { retorno: {
        vacancy: { id: 999999, description: '<p>Descrição errada</p>' }
      } } } })+'</script>', { status: 200 });
    throw new Error('Unexpected mock fetch');
  };
  try {
    const available = await worker.fetch(new Request('https://worker.invalid/api/vagas/158921'), env);
    assert.equal(available.status, 404);
    const closed = await worker.fetch(new Request('https://worker.invalid/api/vagas/100'), env);
    assert.equal(closed.status, 404);
    const invalid = await worker.fetch(new Request('https://worker.invalid/api/vagas/not-an-id'), env);
    assert.equal(invalid.status, 404);
  } finally { globalThis.fetch = original; }
});

test('vaga publicada na API mas com inscrições encerradas some da lista, dá 404 no detalhe e não aceita candidatura', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/login-api')) return Response.json({token:'fake-token'});
    if (String(url).includes('/vacancies/filter')) return Response.json({data:[
      {id:161288,title:'Líder Técnico de Dados',slug:'161288-lider-tecnico-de-dados',vacancy_status_id:1,
        pipe_stages:[{id:11,order:0}]},
      {id:158928,title:'Analista de Atendimento',slug:'158928-analista-de-atendimento',vacancy_status_id:1}
    ]});
    if (String(url).endsWith('/161288-lider-tecnico-de-dados'))
      return publicPage(161288,{error:true,closed:true,past:true});
    if (String(url).endsWith('/158928-analista-de-atendimento')) return publicPage(158928);
    throw new Error('Não deve criar candidato: '+url);
  };
  try {
    const listing = await worker.fetch(new Request('https://worker.invalid/api/vagas'),env);
    assert.deepEqual((await listing.json()).data.map(v=>v.id),[158928]);
    const detail = await worker.fetch(new Request('https://worker.invalid/api/vagas/161288'),env);
    assert.equal(detail.status,404);
    const apply = await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        name:'Pessoa Fictícia',email:'teste@example.invalid',telephone:'11999999999',vacancy_id:'161288'
      })
    }),{...env,APPLICATIONS_ENABLED:'true'});
    assert.equal(apply.status,400);
    assert.match((await apply.json()).message,/inscrições.*encerradas/);
    assert.equal(calls.some(url=>url.includes('/prospects')),false);
  } finally { globalThis.fetch = original; }
});

test('sem confirmação pública de disponibilidade, não anuncia nem recebe candidatura',async()=>{
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/login-api')) return Response.json({token:'fake-token'});
    if (String(url).includes('/vacancies/filter')) return Response.json({data:[{
      id:161288,title:'Líder Técnico de Dados',slug:'161288-lider-tecnico-de-dados',
      vacancy_status_id:1,pipe_stages:[{id:11,order:0}]
    }]});
    throw new Error('Recrutei temporariamente indisponível');
  };
  try {
    const listing = await worker.fetch(new Request('https://worker.invalid/api/vagas'),env);
    assert.equal(listing.status,503);
    assert.match((await listing.json()).message,/disponibilidade/);
    const apply = await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        name:'Pessoa Fictícia',email:'teste@example.invalid',telephone:'11999999999',vacancy_id:'161288'
      })
    }),{...env,APPLICATIONS_ENABLED:'true'});
    assert.equal(apply.status,503);
    assert.match((await apply.json()).message,/confirmar/);
  } finally { globalThis.fetch = original; }
});
