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
const dataQuestionIds = ['age', 'linkedin', 'social', 'employment', 'start', 'remote', 'pj', 'salary'];
const dataAnswers = () => ({
  age: '35', linkedin: 'https://www.linkedin.com/in/pessoa-teste',
  social: 'https://www.instagram.com/pessoa-teste', employment: 'Sim, PJ',
  start: 'Em até 15 dias', remote: 'Sim',
  pj: ['Sim, já possuo CNPJ', 'Ainda não possuo, mas tenho disponibilidade para abrir'], salary: '12000'
});
const dataPayload = () => ({ ...payload(), vacancy_id: '158883', questionnaire_answers: dataAnswers() });

async function run(input, options = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, url: String(url), init });
    if (path.endsWith('/login-api')) return json({ token: 'fake-test-token' });
    if (path.endsWith('/vacancies/filter')) return json({ data: [
      { id: Number(input.vacancy_id), vacancy_status_id: 1, pipe_stages: [{ id: 10, order: 1 }] }
    ] });
    if (path.endsWith('/prospects')) return json(options.createBody ?? {
      data: { talent: { id: 22, prospect: { id: 44 } }, application: { id: 33 } }
    }, options.createStatus ?? 201);
    if (path === options.throwPath) throw new Error('Simulated network failure');
    if (path === options.failPath) return json(options.failBody ?? { message: 'upstream rejected' }, 422);
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
  assert.equal(result.body.profile_error, undefined);
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
  assert.equal(profile.application_id, 33);
  assert.equal(new URL(result.calls.find(c => c.path.endsWith('/curriculum/filled')).url).searchParams.get('talent_id'), '22');
  assert.equal(profile.basic_infos.length, 4);
  assert.equal(profile.additional.length, 2);
});

test('vaga158883 registra oito perguntas ordenadas, HTML escapado e todas as escolhas PJ', async () => {
  const input = dataPayload();
  input.questionnaire_answers.age = ' 35 ';
  input.questionnaire_answers.linkedin = 'https://example.invalid/perfil?a=1&next="<perfil>"';
  input.questionnaire_answers.social = `<img src=x onerror="alert('x')"> & GEX`;
  input.questionnaire_answers.pj = [
    'Não tenho interesse no modelo PJ',
    'Ainda não possuo, mas tenho disponibilidade para abrir',
    'Sim, já possuo CNPJ'
  ];
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, true);
  assert.deepEqual(questionnaireFor('158883').questions.map(question => question.id), dataQuestionIds);
  const observations = result.calls.filter(call => call.path.endsWith('/talents-observations'));
  assert.equal(observations.length, 1);
  assert.ok(observations[0].init.body instanceof FormData);
  const html = observations[0].init.body.get('description');
  assert.ok(html.includes('GEX Talents | Respostas da candidatura'));
  assert.ok(html.includes('<strong>Vaga:</strong> Analista de Dados Sênior'));
  const expectedQuestions = [
    'Qual sua idade?',
    'LinkedIn (Cole o link do seu perfil)',
    'Compartilhe uma rede social sua (Instagram, TikTok ou outra que utilize).',
    'Atualmente você está trabalhando?',
    'Qual é a sua disponibilidade para início?',
    'Você possui estrutura adequada para trabalho remoto? Computador, internet estável e ambiente adequado para realização das atividades.',
    'Você possui CNPJ ou disponibilidade para atuar no modelo PJ?',
    'Qual é a sua pretensão de remuneração mensal no modelo PJ?'
  ];
  const expectedAnswers = [
    '35', 'https://example.invalid/perfil?a=1&amp;next=&quot;&lt;perfil&gt;&quot;',
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; GEX',
    'Sim, PJ', 'Em até 15 dias', 'Sim', 'Sim, já possuo CNPJ', '12000'
  ];
  const positions = expectedQuestions.map((question, index) => html.indexOf(`${index + 1}. ${question}`));
  for (let index = 0; index < positions.length; index += 1) {
    assert.ok(positions[index] >= 0);
    if (index > 0) assert.ok(positions[index] > positions[index - 1]);
    assert.ok(html.slice(positions[index], positions[index + 1] ?? html.length).includes(expectedAnswers[index]));
  }
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<perfil>'));
  let previous = -1;
  for (const option of [
    'Sim, já possuo CNPJ', 'Ainda não possuo, mas tenho disponibilidade para abrir',
    'Não tenho interesse no modelo PJ'
  ]) {
    const position = html.indexOf(`<li>${option}</li>`);
    assert.ok(position > previous);
    previous = position;
  }
  assert.equal(observations[0].init.body.get('application_id'), '33');
  assert.equal(observations[0].init.body.get('talent_id'), '22');
  assert.equal(observations[0].init.body.get('talent_observation_type_id'), '7');
  assert.equal(observations[0].init.body.get('action'), '1');
  assert.ok(result.calls.findIndex(call => call.path.endsWith('/prospects')) <
    result.calls.findIndex(call => call.path.endsWith('/talents-observations')));
});

for (const id of dataQuestionIds) {
  test(`vaga158883 rejeita pergunta obrigatória ausente ${id} antes de chamadas externas`, async () => {
    const input = dataPayload(); delete input.questionnaire_answers[id];
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  });
}
for (const [name, mutate] of [
  ['questionário ausente', input => delete input.questionnaire_answers],
  ['questionário como array', input => input.questionnaire_answers = []],
  ['idade vazia', input => input.questionnaire_answers.age = ' '],
  ['idade numérica sem texto', input => input.questionnaire_answers.age = 35],
  ['LinkedIn como objeto', input => input.questionnaire_answers.linkedin = {}],
  ['LinkedIn longo', input => input.questionnaire_answers.linkedin = 'x'.repeat(501)],
  ['rede social como array', input => input.questionnaire_answers.social = ['perfil']],
  ['trabalho vazio', input => input.questionnaire_answers.employment = ''],
  ['trabalho como array', input => input.questionnaire_answers.employment = ['Sim, PJ']],
  ['trabalho não listado', input => input.questionnaire_answers.employment = 'Emprego diferente'],
  ['disponibilidade não listada', input => input.questionnaire_answers.start = 'Daqui a dois meses'],
  ['remoto não listado', input => input.questionnaire_answers.remote = 'Talvez'],
  ['PJ vazio', input => input.questionnaire_answers.pj = []],
  ['PJ como texto', input => input.questionnaire_answers.pj = 'Sim, já possuo CNPJ'],
  ['PJ com opção injetada', input => input.questionnaire_answers.pj = ['<script>injetado</script>']],
  ['PJ com opção repetida', input => input.questionnaire_answers.pj = ['Sim, já possuo CNPJ', 'Sim, já possuo CNPJ']],
  ['salário como objeto', input => input.questionnaire_answers.salary = {}]
]) test(`vaga158883 valida ${name} antes de chamadas externas`, async () => {
  const input = dataPayload(); mutate(input);
  const result = await run(input);
  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});

test('respostas da vaga158928 não substituem questionário158883 e vice-versa', async () => {
  const dataInput = dataPayload(); dataInput.questionnaire_answers = answers();
  const supportInput = payload(); supportInput.questionnaire_answers = dataAnswers();
  for (const input of [dataInput, supportInput]) {
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  }
});
test('vaga158928 preserva sete perguntas e não recebe as novas perguntas de dados', async () => {
  const result = await run(payload());
  assert.equal(result.body.observation_completed, true);
  assert.equal(questionnaireFor('158928').questions.length, 7);
  const html = result.calls.find(call => call.path.endsWith('/talents-observations')).init.body.get('description');
  assert.ok(html.includes('<strong>Vaga:</strong> Analista de Atendimento'));
  assert.ok(!html.includes('LinkedIn (Cole o link do seu perfil)'));
  assert.ok(!html.includes('Analista de Dados Sênior'));
});
test('vaga não cadastrada permanece sem questionário, mesmo recebendo respostas de158883', async () => {
  const input = dataPayload(); input.vacancy_id = '999998';
  const result = await run(input);
  assert.equal(questionnaireFor('999998'), null);
  assert.equal(result.status, 201);
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, undefined);
  assert.ok(!result.calls.some(call => call.path.endsWith('/talents-observations')));
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
  const profile = result.calls.find(call => call.path.endsWith('/curriculum/filled'));
  assert.equal(new URL(profile.url).searchParams.get('talent_id'), '22');
  assert.equal(JSON.parse(profile.init.body).talent_id, 22);
  assert.ok(!result.calls.some(call => call.path.startsWith('/api/v1/applications/')));
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
    if (path.includes('curriculum')) {
      assert.deepEqual(result.body.profile_error, { http_status: null, fields: [] });
    } else {
      assert.equal(result.body.profile_error, undefined);
    }
  });
}
test('falha422 do perfil informa status e somente chaves conhecidas, sem valores de validação', async () => {
  const rejectedValue = 'CPF rejeitado: 123.456.789-00; dado privado teste@example.invalid';
  const result = await run(payload(), {
    failPath: '/api/v2/curriculum/filled',
    failBody: {
      message: 'upstream rejected',
      errors: {
        birthday: [rejectedValue],
        ssn: [rejectedValue],
        'basic_infos.1.value': [rejectedValue],
        'additional.0.value': [rejectedValue],
        email: [rejectedValue],
        'basic_infos.*.value': [rejectedValue],
        'basic_infos.1.value.123.456.789-00': [rejectedValue],
        'basic_infos.1.value\n': [rejectedValue]
      },
      rejected_value: rejectedValue
    }
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.profile_completed, false);
  assert.equal(result.body.profile_warning, 'upstream rejected');
  assert.deepEqual(result.body.profile_error, {
    http_status: 422,
    fields: ['birthday', 'ssn', 'basic_infos.1.value', 'additional.0.value']
  });
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, true);
  const publicResponse = JSON.stringify(result.body);
  for (const value of [rejectedValue, '123.456.789-00', 'teste@example.invalid', 'rejected_value']) {
    assert.ok(!publicResponse.includes(value));
  }
  assert.equal(result.calls.filter(c => c.path.endsWith('/prospects')).length, 1);
});
for (const errors of [undefined, null, 'invalid', ['birthday']]) {
  test(`perfil422 com errors ${JSON.stringify(errors)} mantém status sem inferir campos`, async () => {
    const result = await run(payload(), {
      failPath: '/api/v2/curriculum/filled', failBody: { message: 'upstream rejected', errors }
    });
    assert.deepEqual(result.body.profile_error, { http_status: 422, fields: [] });
  });
}
test('IDs ausentes: nenhuma observação com IDs inventados e candidatura permanece criada', async () => {
  const result = await run(payload(), { createBody: { data: {} } });
  assert.equal(result.status, 201); assert.equal(result.body.application_created, true);
  assert.equal(result.body.observation_completed, false);
  assert.deepEqual(result.body.profile_error, { http_status: null, fields: [] });
  assert.ok(!result.calls.some(c => c.path.endsWith('/talents-observations')));
});
test('suporta IDs no formato alternativo já reconhecido pela integração', async () => {
  const result = await run(payload(), { createBody: { data: { application: { id: 33, prospect: { talent_id: 22 } } } } });
  assert.equal(result.body.observation_completed, true);
});
test('perfil mantém ID do talento original sem consulta adicional quando prospecção não retorna', async () => {
  const result = await run(payload(), { createBody: { data: { talent: { id: 22 }, application: { id: 33 } } } });
  assert.equal(result.body.profile_completed, true);
  assert.ok(!result.calls.some(call => call.path.startsWith('/api/v1/applications/')));
  const update = result.calls.find(call => call.path.endsWith('/curriculum/filled'));
  assert.equal(new URL(update.url).searchParams.get('talent_id'), '22');
  assert.equal(JSON.parse(update.init.body).talent_id, 22);
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
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'APPLICATIONS_DISABLED');
  assert.equal(result.body.applications_enabled, false);
  assert.equal(result.body.application_created, false);
  assert.ok(typeof result.body.message === 'string' && result.body.message.length > 0);
  assert.equal(result.calls.length, 0);
});
test('health da prévia informa candidaturas desabilitadas', async () => {
  const response = await worker.fetch(new Request('https://preview.invalid/health'), {
    ...env, APPLICATIONS_ENABLED: 'false'
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applications_enabled, false);
});

const diagnosticEnv = {
  ...env, PROFILE_DIAGNOSTIC_ENABLED: 'true',
  PROFILE_DIAGNOSTIC_APPLICATION_ID: '15905660', PROFILE_DIAGNOSTIC_VACANCY_ID: '158928'
};
const diagnosticApplication = () => ({
  id: 15905660, vacancy_id: 158928, talent_id: 7654321, prospect_id: 2345678,
  talent: {
    id: 7654321, is_prospect: 1, birthday: '1988-04-19', ssn: '111.222.333-44',
    email: 'private-diagnostic@example.invalid', telephone: '11987654321',
    prospect: { id: 2345678, name: 'TESTE 2 — Pessoa reservada', birthday: null },
    professional_profile: { intended_remuneration: '9876.54' }
  }
});
async function runDiagnostic(options = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (new URL(url).pathname.endsWith('/login-api')) return json({ token: 'fake-test-token' });
    if (options.throw) throw new Error('private upstream failure');
    return json(options.body ?? diagnosticApplication(), options.status ?? 200);
  };
  try {
    const response = await worker.fetch(new Request(
      `https://preview.invalid/api/diagnostico-perfil${options.query || ''}`,
      { method: options.method || 'GET' }
    ), options.env ?? diagnosticEnv);
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}
for (const overrides of [
  { PROFILE_DIAGNOSTIC_ENABLED: undefined },
  { PROFILE_DIAGNOSTIC_ENABLED: 'false' },
  { PROFILE_DIAGNOSTIC_APPLICATION_ID: undefined },
  { PROFILE_DIAGNOSTIC_APPLICATION_ID: '-1' },
  { PROFILE_DIAGNOSTIC_VACANCY_ID: '0' },
  { PROFILE_DIAGNOSTIC_APPLICATION_ID: '15905660\n' }
]) test('diagnóstico indisponível sem configuração positiva e explícita: ' + JSON.stringify(overrides), async () => {
  const result = await runDiagnostic({ env: { ...diagnosticEnv, ...overrides } });
  assert.equal(result.status, 404);
  assert.equal(result.calls.length, 0);
});
test('diagnóstico ignora IDs do solicitante e só consulta o teste fixo via GET', async () => {
  const result = await runDiagnostic({ query: '?application_id=999&vacancy_id=999' });
  assert.equal(result.status, 200);
  const reads = result.calls.filter(call => !call.url.endsWith('/login-api'));
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, 'https://api.recrutei.com.br/api/v1/applications/15905660');
  assert.equal(reads[0].init.method, 'GET');
  assert.equal(reads[0].init.headers['Content-Type'], 'application/json');
  assert.equal(reads[0].init.body, undefined);
  assert.equal(result.body.application_matches_config, true);
  assert.equal(result.body.identifiers.application_talent_matches_talent, true);
  assert.equal(result.body.identifiers.application_prospect_matches_talent_prospect, true);
  assert.equal(result.body.identifiers.talent_matches_talent_prospect, false);
  assert.equal(result.body.talent_is_prospect, true);
  assert.deepEqual(result.body.fields['talent.birthday'], { exists: true, has_value: true, type: 'string' });
  assert.deepEqual(result.body.fields['talent.prospect.birthday'], { exists: true, has_value: false, type: 'null' });
  assert.deepEqual(result.body.fields['prospect.birthday'], { exists: false, has_value: false, type: 'missing' });
  const publicResult = JSON.stringify(result.body);
  for (const secret of ['1988-04-19', '111.222.333-44', 'private-diagnostic@example.invalid',
    '11987654321', 'Pessoa reservada', '9876.54', '15905660', '158928', '7654321', '2345678']) {
    assert.ok(!publicResult.includes(secret));
  }
});
test('diagnóstico aceita envelope data e nome em prospect da candidatura', async () => {
  const application = diagnosticApplication();
  delete application.talent.prospect;
  application.prospect = { id: 2345678, name: 'Teste2 Reservado' };
  const result = await runDiagnostic({ body: { data: application } });
  assert.equal(result.status, 200);
  assert.equal(result.body.identifiers.talent_prospect_id_present, false);
  assert.equal(result.body.identifiers.application_prospect_relation_id_present, true);
});
for (const mismatch of ['application', 'vacancy', 'name']) {
  test(`diagnóstico rejeita ${mismatch} divergente sem retornar dados ou matriz`, async () => {
    const application = diagnosticApplication();
    if (mismatch === 'application') application.id = 999;
    if (mismatch === 'vacancy') application.vacancy_id = 999;
    if (mismatch === 'name') application.talent.prospect.name = 'Pessoa real reservada';
    const result = await runDiagnostic({ body: application });
    assert.equal(result.status, 409);
    assert.equal(result.body.fields, undefined);
    assert.equal(result.body.identifiers, undefined);
    assert.ok(!JSON.stringify(result.body).includes('reservada'));
    assert.ok(!JSON.stringify(result.body).includes('1988-04-19'));
  });
}
test('diagnóstico não aceita método POST e não faz chamadas externas', async () => {
  const result = await runDiagnostic({ method: 'POST' });
  assert.equal(result.status, 404);
  assert.equal(result.calls.length, 0);
});
for (const failure of [{ status: 403, body: { message: 'private upstream failure' } }, { throw: true }]) {
  test('falha de consulta diagnóstica retorna somente status e mensagem genérica: ' + JSON.stringify(failure), async () => {
    const result = await runDiagnostic(failure);
    assert.equal(result.status, 502);
    assert.equal(result.body.lookup_http_status, failure.throw ? null : 403);
    assert.ok(!JSON.stringify(result.body).includes('private upstream failure'));
    assert.equal(result.body.fields, undefined);
  });
}

const profileTestEnv = {
  ...diagnosticEnv, PROFILE_DIAGNOSTIC_WRITE_ENABLED: 'true', ALLOWED_ORIGIN: 'https://private-preview.invalid'
};
const profileTestPayload = () => ({ birthday: '2000-02-29', intended_remuneration: '5000.00' });
async function runProfileTest(options = {}) {
  const calls = [];
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ url: String(url), path, init });
    if (path.endsWith('/login-api')) return json({ token: 'fake-test-token' });
    if (path === '/api/v1/applications/15905660' && init.method === 'GET') {
      reads += 1;
      if (reads === 1) return json(options.lookupBody ?? diagnosticApplication());
      if (options.readbackThrows) throw new Error('private read failure');
      const application = diagnosticApplication();
      application.talent.birthday = '2000-02-29';
      application.talent.professional_profile.intended_remuneration = '5000';
      return json(options.readbackBody ?? application);
    }
    if (path === '/api/v2/curriculum/filled' && init.method === 'PUT') {
      return options.rejectUpdate
        ? json({ message: 'private rejected value 2000-02-29 5000.00',
          ...(options.updateStatus === 404 ? {} : { errors: { birthday: ['private value'] } })
        }, options.updateStatus ?? 422)
        : json({ data: { id: 1 } });
    }
    throw new Error(`Unexpected staging write: ${path}`);
  };
  try {
    const response = await worker.fetch(new Request('https://preview.invalid/api/teste-perfil?application_id=999', {
      method: options.method || 'POST',
      headers: { Origin: 'https://private-preview.invalid', 'Content-Type': 'application/json', ...options.headers },
      ...((options.method || 'POST') === 'POST' ? {
        body: options.rawBody ?? JSON.stringify(options.payload ?? profileTestPayload())
      } : {})
    }), options.env ?? profileTestEnv);
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}
for (const overrides of [
  { PROFILE_DIAGNOSTIC_ENABLED: 'false' }, { PROFILE_DIAGNOSTIC_WRITE_ENABLED: undefined },
  { PROFILE_DIAGNOSTIC_WRITE_ENABLED: 'false' }, { PROFILE_DIAGNOSTIC_APPLICATION_ID: '0' },
  { PROFILE_DIAGNOSTIC_VACANCY_ID: undefined }
]) test('reparo de teste fica indisponível sem autorização fixa explícita: ' + JSON.stringify(overrides), async () => {
  const result = await runProfileTest({ env: { ...profileTestEnv, ...overrides } });
  assert.equal(result.status, 404);
  assert.equal(result.calls.length, 0);
});
for (const options of [
  { headers: { Origin: 'https://other.invalid' }, status: 403 },
  { headers: { 'Content-Type': 'text/plain' }, status: 415 },
  { rawBody: 'not json', status: 400 },
  { rawBody: ' '.repeat(2049), status: 413 },
  { payload: { ...profileTestPayload(), application_id: '999' }, status: 400 },
  { payload: { ...profileTestPayload(), ssn: '111.222.333-44' }, status: 400 },
  { payload: { birthday: '2001-02-29', intended_remuneration: '5000' }, status: 400 },
  { payload: { birthday: '2000-13-01', intended_remuneration: '5000' }, status: 400 },
  { payload: { birthday: '29/02/2000', intended_remuneration: '5000' }, status: 400 },
  { payload: { birthday: '2000-02-29', intended_remuneration: 'R$ 5.000,00' }, status: 400 },
  { payload: { birthday: '2000-02-29', intended_remuneration: 5000 }, status: 400 }
]) test('reparo valida antes de chamadas externas: ' + JSON.stringify(options), async () => {
  const result = await runProfileTest(options);
  assert.equal(result.status, options.status);
  assert.equal(result.calls.length, 0);
});
test('reparo atualiza somente currículo do teste fixo e confirma nascimento e salário por leitura', async () => {
  const result = await runProfileTest();
  assert.equal(result.status, 200);
  assert.equal(result.body.application_created, false);
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.birthday_verified, true);
  assert.equal(result.body.salary_verified, true);
  const dataCalls = result.calls.filter(call => !call.path.endsWith('/login-api'));
  assert.deepEqual(dataCalls.map(call => call.init.method), ['GET', 'PUT', 'GET']);
  assert.deepEqual(dataCalls.filter(call => call.init.method === 'GET').map(call => call.url), [
    'https://api.recrutei.com.br/api/v1/applications/15905660',
    'https://api.recrutei.com.br/api/v1/applications/15905660'
  ]);
  const update = dataCalls[1];
  assert.equal(new URL(update.url).searchParams.get('talent_id'), '7654321');
  const sent = JSON.parse(update.init.body);
  assert.equal(sent.talent_id, 7654321);
  assert.equal(sent.application_id, 15905660);
  assert.deepEqual(sent.basic_infos, [{ key: 'birthday', value: '2000-02-29', title: 'Data de nascimento' }]);
  assert.deepEqual(sent.additional, [{ key: 'intended_remuneration', value: '5000.00', title: 'Pretensão salarial' }]);
  const publicResponse = JSON.stringify(result.body);
  for (const value of ['2000-02-29', '5000', '15905660', '7654321', '2345678', 'Pessoa reservada', 'private-diagnostic@example.invalid']) {
    assert.ok(!publicResponse.includes(value));
  }
});
test('reparo rejeita pessoa não identificada como teste antes de qualquer PUT', async () => {
  const application = diagnosticApplication(); application.talent.prospect.name = 'Pessoa real';
  const result = await runProfileTest({ lookupBody: application });
  assert.equal(result.status, 409);
  assert.ok(!result.calls.some(call => call.init.method === 'PUT'));
});
test('reparo com perfil rejeitado não reflete mensagem ou valores externos', async () => {
  const result = await runProfileTest({ rejectUpdate: true });
  assert.equal(result.body.profile_completed, false);
  assert.equal(result.body.application_created, false);
  assert.deepEqual(result.body.profile_error, { http_status: 422, fields: ['birthday'] });
  assert.ok(!JSON.stringify(result.body).includes('private rejected value'));
  assert.ok(!JSON.stringify(result.body).includes('2000-02-29'));
  assert.ok(!JSON.stringify(result.body).includes('5000.00'));
});
test('reparo identifica404 externo sem confirmar preenchimento nem expor valores', async () => {
  const application = diagnosticApplication();
  application.talent.birthday = null;
  application.talent.professional_profile = null;
  const result = await runProfileTest({ rejectUpdate: true, updateStatus: 404, readbackBody: application });
  assert.equal(result.status, 200);
  assert.equal(result.body.application_created, false);
  assert.equal(result.body.profile_completed, false);
  assert.deepEqual(result.body.profile_error, { http_status: 404, fields: [] });
  assert.equal(result.body.birthday_verified, false);
  assert.equal(result.body.salary_verified, null);
  const publicResult = JSON.stringify(result.body);
  assert.ok(!publicResult.includes('private rejected value'));
  assert.ok(!publicResult.includes('2000-02-29'));
  assert.ok(!publicResult.includes('5000.00'));
});
test('reparo não confunde aceitação da API com nascimento realmente persistido', async () => {
  const result = await runProfileTest({ readbackBody: diagnosticApplication() });
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.birthday_verified, false);
  assert.equal(result.body.salary_verified, false);
});
test('reparo informa verificação desconhecida quando leitura posterior falha', async () => {
  const result = await runProfileTest({ readbackThrows: true });
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.birthday_verified, null);
  assert.equal(result.body.salary_verified, null);
});
test('reparo não infere salário ausente nos caminhos conhecidos', async () => {
  const application = diagnosticApplication(); application.talent.professional_profile = null;
  const result = await runProfileTest({ readbackBody: application });
  assert.equal(result.body.salary_verified, null);
});

const affiliationAnswers = () => ({
  pj: 'Sim', salary: '9000', age: '32',
  experience: 'Tenho experiência em mais de uma dessas áreas',
  clickup: 'Já utilizei, mas de forma básica', crm: 'Sim',
  prioritization: 'Organizo por urgência e impacto.\nAcompanho cada retorno no CRM.'
});
const affiliationPayload = () => ({ ...payload(), vacancy_id: '158921', questionnaire_answers: affiliationAnswers() });

test('Afiliação registra as sete respostas, HTML seguro e parágrafos da resposta longa', async () => {
  const input = affiliationPayload();
  input.questionnaire_answers.prioritization = `  Priorizo <script>alert("x")</script> & demandas urgentes.\r\nOrganizo 'retornos'.\nAtualizo o CRM.  `;
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.profile_completed, true);
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, true);
  const observation = result.calls.find(call => call.path.endsWith('/talents-observations'));
  const html = observation.init.body.get('description');
  assert.ok(html.includes('<strong>Vaga:</strong> Analista de CS - Afiliação'));
  const labels = [
    'Aceita vaga PJ?',
    'Qual é a sua pretensão de remuneração mensal no modelo PJ?',
    'Qual sua idade?',
    'Você possui experiência profissional com Customer Success, atendimento ao cliente, suporte ou relacionamento com parceiros?',
    'Você possui experiência utilizando o ClickUp?',
    'Você já trabalhou com alguma ferramenta de CRM?',
    'Em uma rotina com várias solicitações chegando ao mesmo tempo, como você organiza e prioriza os atendimentos?'
  ];
  let previous = -1;
  for (const [index, label] of labels.entries()) {
    const position = html.indexOf(`${index + 1}. ${label}`);
    assert.ok(position > previous); previous = position;
    if (index < 6) assert.ok(html.includes(input.questionnaire_answers[Object.keys(affiliationAnswers())[index]]));
  }
  assert.ok(html.includes('Priorizo &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; demandas urgentes.<br>Organizo &#39;retornos&#39;.<br>Atualizo o CRM.'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('LinkedIn (Cole o link do seu perfil)'));
  assert.equal(observation.init.body.get('talent_id'), '22');
  assert.equal(observation.init.body.get('application_id'), '33');
  assert.equal(observation.init.body.get('talent_observation_type_id'), '7');
  assert.equal(observation.init.body.get('action'), '1');
});

for (const id of Object.keys(affiliationAnswers())) {
  test(`Afiliação exige ${id} antes de qualquer chamada externa`, async () => {
    const input = affiliationPayload(); delete input.questionnaire_answers[id];
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  });
}
for (const [name, mutate] of [
  ['resposta longa vazia', p => p.questionnaire_answers.prioritization = ' \n '],
  ['resposta longa acima do limite', p => p.questionnaire_answers.prioritization = 'x'.repeat(5001)],
  ['resposta longa em array', p => p.questionnaire_answers.prioritization = ['Resposta']],
  ['resposta longa em objeto', p => p.questionnaire_answers.prioritization = {}],
  ['resposta curta acima do limite anterior', p => p.questionnaire_answers.pj = 'x'.repeat(501)],
  ['experiência desconhecida', p => p.questionnaire_answers.experience = 'Outra experiência'],
  ['ClickUp com várias respostas', p => p.questionnaire_answers.clickup = ['Nunca utilizei']],
  ['CRM desconhecido', p => p.questionnaire_answers.crm = 'Talvez']
]) test(`Afiliação valida ${name} sem criar candidatura`, async () => {
  const input = affiliationPayload(); mutate(input);
  const result = await run(input);
  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});
for (const length of [501, 5000]) {
  test(`Afiliação aceita resposta longa de ${length} caracteres`, async () => {
    const input = affiliationPayload(); input.questionnaire_answers.prioritization = 'x'.repeat(length);
    const result = await run(input);
    assert.equal(result.body.observation_completed, true);
    const html = result.calls.find(call => call.path.endsWith('/talents-observations')).init.body.get('description');
    assert.ok(html.includes(`<p>${'x'.repeat(length)}</p>`));
  });
}
test('Afiliação com observação rejeitada confirma criação e pendência, sem repetir cadastro', async () => {
  const result = await run(affiliationPayload(), { failPath: '/api/v2/talents-observations' });
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.observation_completed, false);
  assert.ok(result.body.observation_warning);
  assert.equal(result.calls.filter(call => call.path.endsWith('/prospects')).length, 1);
});
for (const input of [
  { ...affiliationPayload(), questionnaire_answers: dataAnswers() },
  { ...dataPayload(), questionnaire_answers: affiliationAnswers() },
  { ...payload(), questionnaire_answers: affiliationAnswers() }
]) test(`questionário de outra vaga não substitui respostas da vaga ${input.vacancy_id}`, async () => {
  const result = await run(input);
  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});

const videoAnswers = () => ({
  pj: ['Sim'], remote: ['Sim'], age: '30', lipsync: ['Sim'], vsl: 'Sim',
  ai: 'Sim', ads: 'Sim', digital_company: 'Sim', portfolio: 'https://example.invalid/portfolio', salary: '9000'
});
const videoPayload = () => ({ ...payload(), vacancy_id: '158786', questionnaire_answers: videoAnswers() });

test('Editor de Vídeo registra dez respostas em ordem e preserva todas as seleções múltiplas', async () => {
  const input = videoPayload();
  for (const id of ['pj','remote','lipsync']) input.questionnaire_answers[id] = ['Não','Sim'];
  input.questionnaire_answers.portfolio = 'https://example.invalid/?a=<script>&b="perfil"';
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.application_created, true);
  assert.equal(result.body.tag_completed, true);
  assert.equal(result.body.observation_completed, true);
  const observation = result.calls.find(call => call.path.endsWith('/talents-observations'));
  const html = observation.init.body.get('description');
  assert.ok(html.includes('<strong>Vaga:</strong> Editor de Vídeo'));
  const labels = [
    'Você aceita atuar como PJ - Prestador de serviços?',
    'Você possui estrutura ( computador/notebook e internet) para trabalhar remoto / home office?',
    'Qual sua idade?',
    'Você tem experiência com ferramentas de lipsync?',
    'Você tem experiência ou já teve algum contato com edição de VSL&#39;s e criativos de resposta direta?',
    'Você tem experiência com ferramentas de IA? Ex: Heygen, ElevenLabs, SyncLabs',
    'Você tem experiencia com edição de anúncios para venda online? (e-commerce, infoprodutos, etc.)',
    'Já trabalhou com alguma empresa digital anteriormente?',
    'Coloque aqui o seu Instagram, LinkedIn, Portifólio, etc.',
    'Qual sua pretensão salarial para um contrato PJ?'
  ];
  const positions = labels.map((label, index) => html.indexOf(`${index+1}. ${label}`));
  for (let i=0;i<positions.length;i++) assert.ok(positions[i]>=0 && (i===0 || positions[i]>positions[i-1]));
  for (const i of [0,1,3]) {
    const block = html.slice(positions[i], positions[i+1]);
    assert.ok(block.includes('<li>Sim</li><li>Não</li>'));
  }
  assert.ok(html.includes('https://example.invalid/?a=&lt;script&gt;&amp;b=&quot;perfil&quot;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(observation.init.body.get('application_id'), '33');
  assert.equal(observation.init.body.get('talent_id'), '22');
  assert.equal(observation.init.body.get('talent_observation_type_id'), '7');
});
for (const id of ['pj','remote','age','lipsync','vsl','ai','ads','digital_company','salary']) {
  test(`Editor de Vídeo exige ${id} antes de qualquer chamada externa`, async () => {
    const input = videoPayload(); delete input.questionnaire_answers[id];
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  });
}
for (const value of [undefined,null,'',' \n ']) {
  test(`Editor permite portfólio opcional sem conteúdo: ${JSON.stringify(value)}`, async () => {
    const input = videoPayload();
    if (value===undefined) delete input.questionnaire_answers.portfolio;
    else input.questionnaire_answers.portfolio=value;
    const result = await run(input);
    assert.equal(result.status, 201);
    assert.equal(result.body.observation_completed, true);
    const html = result.calls.find(call => call.path.endsWith('/talents-observations')).init.body.get('description');
    assert.ok(html.includes('9. Coloque aqui o seu Instagram, LinkedIn, Portifólio, etc.</strong></p><p>Não informado</p>'));
    assert.ok(html.includes('10. Qual sua pretensão salarial para um contrato PJ?'));
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('<p>null</p>'));
  });
}
for (const invalid of [{},[],123,'x'.repeat(501)]) {
  test(`portfólio opcional ainda rejeita tipo ou tamanho inválido: ${Array.isArray(invalid)?'array':typeof invalid}`, async () => {
    const input = videoPayload(); input.questionnaire_answers.portfolio=invalid;
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  });
}
for (const id of ['pj','remote','lipsync']) {
  test(`múltipla ${id} exige ao menos uma escolha conhecida`, async () => {
    for (const invalid of [[],['Talvez'],'Sim']) {
      const input = videoPayload(); input.questionnaire_answers[id]=invalid;
      const result = await run(input);
      assert.equal(result.status, 400);
      assert.equal(result.calls.length, 0);
    }
  });
}
for (const id of ['vsl','ai','ads','digital_company']) {
  test(`única ${id} rejeita seleção múltipla`, async () => {
    const input = videoPayload(); input.questionnaire_answers[id]=['Sim','Não'];
    const result = await run(input);
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  });
}
test('resposta Não sobre PJ é registrada na observação sem reprovação automática', async () => {
  const input = videoPayload(); input.questionnaire_answers.pj=['Não'];
  const result = await run(input);
  assert.equal(result.status, 201);
  assert.equal(result.body.observation_completed, true);
  assert.ok(result.calls.every(call => ['/api/v1/login-api','/api/v2/vacancies/filter',
    '/api/v2/prospects','/api/v2/curriculum/filled','/api/v2/tags/talent','/api/v2/talents-observations'].includes(call.path)));
});
test('respostas de Editor não substituem questionário de Dados Sênior', async () => {
  const input = dataPayload(); input.questionnaire_answers=videoAnswers();
  const result = await run(input);
  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});
