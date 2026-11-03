import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { questionnaireFor } from '../questionnaires.js';

const env = { APPLICATIONS_ENABLED: 'true', PROSPECT_CHANNEL_ID: '8' };
const answers = () => Object.fromEntries(questionnaireFor('158928').questions.map(q => [q.id,
  q.type === 'text' ? 'Resposta teste' : q.type === 'single' ? q.options[0] : q.options.slice(0, 2)
]));
const payload = () => ({ name: 'Pessoa Teste', email: 'teste@example.invalid', telephone: '11999999999',
  vacancy_id: '158928', form_version: '2', birthday: '1990-01-01', intended_remuneration: '5000',
  city: 'Cidade teste', state: 'SP', ssn: '000.000.000-00', available: 'Imediata',
  linkedin_url: 'https://example.invalid/perfil', questionnaire_answers: answers() });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function run(input, options = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path.endsWith('/login-api')) return json({ token: 'fake-test-token' });
    if (path.endsWith('/vacancies/filter')) return json({ data: [
      { id: Number(input.vacancy_id), vacancy_status_id: 1, pipe_stages: [{ id: 10, order: 1 }] }
    ] });
    if (path.endsWith('/prospects')) return json(options.createBody ?? {
      data: { talent: { id: 22 }, application: { id: 33 } }
    }, options.createStatus ?? 201);
    if (path === options.throwPath) throw new Error('Simulated network failure');
    if (path === options.failPath) return json({ message: 'upstream rejected' }, 422);
    if (['/api/v2/curriculum/filled', '/api/v2/tags/talent', '/api/v2/talents-observations'].includes(path)) {
      return json({ data: { id: 1 } }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.invalid/api/candidatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    }), options.env ?? env);
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}

test('cria observação multipart ordenada, preservando perfil e tag', async () => {
  const input = payload();
  input.questionnaire_answers.pj = `  <script>alert("x")</script> & 'PJ'  `;
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, true);
  const paths = result.calls.map(c => c.path);
  assert.ok(paths.indexOf('/api/v2/prospects') < paths.indexOf('/api/v2/talents-observations'));
  const observation = result.calls.find(c => c.path.endsWith('/talents-observations'));
  assert.ok(observation.init.body instanceof FormData);
  assert.equal(observation.init.headers['Content-Type'], undefined);
  assert.equal(observation.init.headers.Authorization, 'Bearer fake-test-token');
  assert.deepEqual(Object.fromEntries([...observation.init.body].filter(([k]) => k !== 'description')), {
    application_id: '33', talent_id: '22', talent_observation_type_id: '7', action: '1'
  });
  const html = observation.init.body.get('description');
  assert.ok(html.includes('GEX Talents | Respostas da candidatura'));
  assert.ok(html.includes('<strong>Vaga:</strong> Analista de Atendimento'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;PJ&#39;'));
  assert.ok(!html.includes('<script>'));
  let last = -1;
  for (const [index, q] of questionnaireFor(input.vacancy_id).questions.entries()) {
    const position = html.indexOf(`${index + 1}. ${q.label}`);
    assert.ok(position > last); last = position;
    if (q.type === 'multiple') for (const option of input.questionnaire_answers[q.id]) {
      assert.ok(html.includes(`<li>${option}</li>`));
    }
  }
  const tag = result.calls.find(c => c.path.endsWith('/tags/talent'));
  assert.equal(JSON.parse(tag.init.body).value, 'GEX Talents');
  const profile = JSON.parse(result.calls.find(c => c.path.endsWith('/curriculum/filled')).init.body);
  assert.equal(profile.talent_id, 22);
  assert.equal(profile.basic_infos.length, 4);
  assert.equal(profile.additional.length, 2);
});

for (const question of questionnaireFor('158928').questions) {
  test(`rejeita resposta obrigatória ausente: ${question.id}, antes de qualquer chamada externa`, async () => {
    const input = payload(); delete input.questionnaire_answers[question.id];
    const result = await run(input);
    assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  });
}
for (const [name, mutate] of [
  ['questionário ausente', p => delete p.questionnaire_answers],
  ['questionário como array', p => p.questionnaire_answers = []],
  ['texto em branco', p => p.questionnaire_answers.pj = '   '],
  ['texto longo', p => p.questionnaire_answers.salary = 'x'.repeat(501)],
  ['objeto no texto', p => p.questionnaire_answers.age = {}],
  ['escolha única inválida', p => p.questionnaire_answers.experience = 'qualquer'],
  ['escolha única como array', p => p.questionnaire_answers.experience = ['Tenho pouca experiência']],
  ['múltipla vazia', p => p.questionnaire_answers.channels = []],
  ['múltipla como string', p => p.questionnaire_answers.retention = 'Não'],
  ['alternativa injetada', p => p.questionnaire_answers.metrics = ['<img src=x>']],
  ['alternativa repetida', p => p.questionnaire_answers.channels = ['CRM', 'CRM']]
]) test(`validação: ${name}`, async () => {
  const input = payload(); mutate(input);
  const result = await run(input);
  assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
});

test('outra vaga mantém perfil/tag e não envia observação, mesmo com respostas extras', async () => {
  const input = payload(); input.vacancy_id = '999999';
  input.questionnaire_answers = { channels: ['injetado'] };
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.observation_completed, undefined);
  assert.ok(!result.calls.some(c => c.path.endsWith('/talents-observations')));
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.tag_completed, true);
});

for (const type of ['failPath', 'throwPath']) {
  test(`observação com ${type} retorna candidatura criada e pendência explícita`, async () => {
    const result = await run(payload(), { [type]: '/api/v2/talents-observations' });
    assert.equal(result.status, 201);
    assert.equal(result.body.application_created, true);
    assert.equal(result.body.observation_completed, false);
    assert.ok(result.body.observation_warning);
    assert.equal(result.calls.filter(c => c.path.endsWith('/prospects')).length, 1);
  });
}
for (const path of ['/api/v2/curriculum/filled', '/api/v2/tags/talent']) {
  test(`falha de rede em ${path} não impede observação nem mascara criação`, async () => {
    const result = await run(payload(), { throwPath: path });
    assert.equal(result.status, 201);
    assert.equal(result.body.observation_completed, true);
    assert.equal(result.body[path.includes('curriculum') ? 'profile_completed' : 'tag_completed'], false);
  });
}
test('IDs ausentes: nenhuma observação com IDs inventados e candidatura permanece criada', async () => {
  const result = await run(payload(), { createBody: { data: {} } });
  assert.equal(result.status, 201); assert.equal(result.body.application_created, true);
  assert.equal(result.body.observation_completed, false);
  assert.ok(!result.calls.some(c => c.path.endsWith('/talents-observations')));
});
test('suporta IDs no formato alternativo já reconhecido pela integração', async () => {
  const result = await run(payload(), { createBody: { data: { application: { id: 33, prospect: { talent_id: 22 } } } } });
  assert.equal(result.body.observation_completed, true);
});
test('falha na criação nunca envia perfil, tag ou observação', async () => {
  const result = await run(payload(), { createStatus: 422 });
  assert.equal(result.status, 500);
  assert.ok(!result.calls.some(c => /curriculum|tags\/talent|talents-observations/.test(c.path)));
});

test('remover form_version não permite contornar as perguntas obrigatórias', async () => {
  const input = payload(); delete input.form_version; delete input.questionnaire_answers;
  const result = await run(input);
  assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
});
test('registra todas as alternativas selecionadas em cada grupo múltiplo', async () => {
  const input = payload();
  for (const q of questionnaireFor(input.vacancy_id).questions) {
    if (q.type === 'multiple') input.questionnaire_answers[q.id] = [...q.options].reverse();
  }
  const result = await run(input);
  const observation = result.calls.find(c => c.path.endsWith('/talents-observations'));
  const html = observation.init.body.get('description');
  for (const q of questionnaireFor(input.vacancy_id).questions) {
    if (q.type === 'multiple') for (const option of q.options) assert.ok(html.includes(`<li>${option}</li>`));
  }
  const httpRequest = new Request('https://api.invalid/observations', observation.init);
  assert.ok(httpRequest.headers.get('content-type').startsWith('multipart/form-data; boundary='));
});
test('vaga sem questionário aceita o payload original sem campos adicionais', async () => {
  const input = payload(); input.vacancy_id = '999999'; delete input.questionnaire_answers;
  const result = await run(input);
  assert.equal(result.status, 201); assert.equal(result.body.observation_completed, undefined);
});

test('prévia com candidaturas desabilitadas bloqueia criação antes de chamar a Recrutei', async () => {
  const result = await run(payload(), { env: { ...env, APPLICATIONS_ENABLED: 'false' } });
  assert.equal(result.status, 500);
  assert.match(result.body.message, /não estão habilitadas/);
  assert.equal(result.calls.length, 0);
});
test('health da prévia informa candidaturas desabilitadas', async () => {
  const response = await worker.fetch(new Request('https://preview.invalid/health'), {
    ...env, APPLICATIONS_ENABLED: 'false'
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applications_enabled, false);
});
