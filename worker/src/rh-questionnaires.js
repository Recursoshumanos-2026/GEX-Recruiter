import { questionnaireFor, validateQuestionnaireAnswers } from '../../questionnaires.js';
import { renderRhAdminPage } from './rh-admin-page.js';

// All administrator endpoints are confined to /rh/. Cloudflare Access must
// authenticate the path, AND these two application-level checks must pass.
// Neither a caller-supplied email header nor an unverified JWT is trusted.
export async function authorizedRhUser(env, ctx) {
  if (env?.QUESTIONNAIRE_ADMIN_ENABLED !== 'true' ||
      !env.QUESTIONNAIRE_ACCESS_AUD || !env.QUESTIONNAIRE_RH_EMAILS ||
      !ctx?.access || ctx.access.aud !== env.QUESTIONNAIRE_ACCESS_AUD ||
      typeof ctx.access.getIdentity !== 'function') return null;
  const identity = await ctx.access.getIdentity();
  const email = String(identity?.email || '').trim().toLowerCase();
  const allowed = String(env.QUESTIONNAIRE_RH_EMAILS).split(',')
    .map(value => value.trim().toLowerCase()).filter(Boolean);
  return email && allowed.includes(email) ? email : null;
}

function validId(value) {
  return /^[1-9][0-9]*$/.test(String(value)) &&
    Number.isSafeInteger(Number(value));
}

export function normalizeQuestionnaire(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      typeof raw.title !== 'string' || raw.title.trim().length < 3 ||
      raw.title.trim().length > 150 || !Array.isArray(raw.questions) ||
      raw.questions.length < 1 || raw.questions.length > 20) {
    throw new Error('Informe um título e de 1 a 20 perguntas.');
  }
  const ids = new Set();
  const questions = raw.questions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Pergunta ${index + 1} inválida.`);
    }
    const id = String(item.id || '').trim();
    const label = String(item.label || '').trim();
    const type = String(item.type || '');
    if (!/^[a-z][a-z0-9_]{0,48}$/i.test(id) || ids.has(id) ||
        label.length < 5 || label.length > 300 ||
        !['text', 'long', 'single', 'multiple'].includes(type) ||
        typeof item.required !== 'boolean') {
      throw new Error(`Verifique o texto, o tipo e o identificador da pergunta ${index + 1}.`);
    }
    ids.add(id);
    if (type === 'single' || type === 'multiple') {
      if (!Array.isArray(item.options) || item.options.length < 2 ||
          item.options.length > 20 || item.options.some(option =>
            typeof option !== 'string' || option.trim().length < 1 ||
            option.trim().length > 150) ||
          new Set(item.options.map(option => option.trim().toLowerCase())).size !==
            item.options.length) {
        throw new Error(`A pergunta ${index + 1} precisa de 2 a 20 alternativas distintas.`);
      }
      return { id, label, type, required: item.required,
        options: item.options.map(value => value.trim()) };
    }
    return { id, label, type, required: item.required };
  });
  return { title: raw.title.trim(), questions };
}

const NO_TABLE = /no such table|missing d1 table/i;
const DB_ERROR = 'Não foi possível consultar os questionários agora.';

function database(env) {
  return typeof env?.RESUME_DB?.prepare === 'function' ? env.RESUME_DB : null;
}

async function ensureTables(env) {
  const db = database(env);
  if (!db) throw new Error('Banco D1 não configurado.');
  await db.prepare(`CREATE TABLE IF NOT EXISTS gex_questionnaires (
    vacancy_id TEXT PRIMARY KEY, document TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS gex_questionnaire_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL,
    updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
  )`).run();
}

function parseStored(row) {
  if (!row) return { questionnaire: undefined, version: 0, updated_at: null };
  if (Number(row.disabled) === 1) {
    return { questionnaire: null, version: Number(row.version), updated_at: row.updated_at };
  }
  return {
    questionnaire: normalizeQuestionnaire(JSON.parse(row.document)),
    version: Number(row.version), updated_at: row.updated_at
  };
}

export async function loadVacancyQuestionnaire(env, vacancyId) {
  if (!database(env)) return questionnaireFor(vacancyId);
  try {
    const row = await env.RESUME_DB.prepare(
      'SELECT document, disabled, version, updated_at FROM gex_questionnaires WHERE vacancy_id = ?'
    ).bind(String(vacancyId)).first();
    const stored = parseStored(row);
    return stored.questionnaire === undefined ? questionnaireFor(vacancyId) :
      stored.questionnaire;
  } catch (error) {
    // A never-initialized table means the legacy site has not opted in yet.
    if (NO_TABLE.test(String(error?.message))) return questionnaireFor(vacancyId);
    // Do not silently bypass RH's questions after a database outage.
    const failure = new Error(DB_ERROR);
    failure.status = 503;
    throw failure;
  }
}

export async function publicQuestionnaires(env, activeVacancies) {
  if (!database(env) || !activeVacancies.length) return {};
  try {
    const result = await env.RESUME_DB.prepare(
      'SELECT vacancy_id, document, disabled, version, updated_at FROM gex_questionnaires'
    ).all();
    const allowed = new Set(activeVacancies.map(item => String(item.id)));
    const definitions = {};
    for (const row of result?.results || []) {
      if (!allowed.has(String(row.vacancy_id))) continue;
      definitions[String(row.vacancy_id)] = parseStored(row).questionnaire;
    }
    return definitions;
  } catch (error) {
    if (NO_TABLE.test(String(error?.message))) return {};
    const failure = new Error(DB_ERROR);
    failure.status = 503;
    throw failure;
  }
}

function reply(data, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  }});
}

function reject(status, message) {
  return reply({ message }, status);
}

async function readAdminDefinition(env, vacancyId) {
  const row = await env.RESUME_DB.prepare(
    'SELECT document, disabled, version, updated_at, updated_by FROM gex_questionnaires WHERE vacancy_id = ?'
  ).bind(vacancyId).first();
  const data = parseStored(row);
  return { vacancy_id: vacancyId, ...data, source: row ? 'rh' : 'legacy',
    updated_by: row?.updated_by || null,
    ...(row ? {} : { questionnaire: questionnaireFor(vacancyId) }) };
}

async function writeDefinition(env, id, questionnaire, disabled, expectedVersion, email) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return reject(400, 'Versão de edição inválida. Atualize o painel.');
  }
  const current = await readAdminDefinition(env, id);
  if (current.version !== expectedVersion) {
    return reject(409, 'Este questionário foi alterado em outra sessão. Atualize a página.');
  }
  const document = JSON.stringify(questionnaire || { title: current.questionnaire?.title || 'Questionário desativado', questions: [] });
  const now = new Date().toISOString();
  if (current.version === 0) {
    await env.RESUME_DB.prepare(
      'INSERT INTO gex_questionnaires (vacancy_id,document,disabled,version,updated_at,updated_by) VALUES (?,?,?,1,?,?)'
    ).bind(id, document, Number(disabled), now, email).run();
  } else {
    const result = await env.RESUME_DB.prepare(
      'UPDATE gex_questionnaires SET document=?,disabled=?,version=version+1,updated_at=?,updated_by=? WHERE vacancy_id=? AND version=?'
    ).bind(document, Number(disabled), now, email, id, expectedVersion).run();
    if (result?.meta?.changes === 0) {
      return reject(409, 'Este questionário foi alterado em outra sessão. Atualize a página.');
    }
  }
  return reply({ saved: true, version: expectedVersion + 1,
    questionnaire: disabled ? null : questionnaire });
}

async function jsonBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error('Envie um documento JSON.');
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 64 * 1024) throw new Error('Questionário muito grande.');
  const raw = await request.text();
  if (raw.length > 64 * 1024) throw new Error('Questionário muito grande.');
  return JSON.parse(raw);
}

export async function handleRhRequest(request, env, ctx, loadVacancies) {
  const email = await authorizedRhUser(env, ctx);
  if (!email) return reject(403, 'Acesso reservado a usuários autorizados do RH.');
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && (path === '/rh' || path === '/rh/' ||
      path === '/rh/perguntas')) {
    return renderRhAdminPage(email);
  }
  if (!path.startsWith('/rh/api/')) return reject(404, 'Página não encontrada.');
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(request.method)) {
    return reject(405, 'Método não permitido.');
  }
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    return reject(403, 'Origem não autorizada.');
  }
  try {
    await ensureTables(env);
    if (request.method === 'GET' && path === '/rh/api/vagas') {
      const vacancies = await loadVacancies();
      const { results } = await env.RESUME_DB.prepare(
        'SELECT vacancy_id,disabled FROM gex_questionnaires'
      ).all();
      const saved = new Map((results || []).map(row => [String(row.vacancy_id),row]));
      const list = vacancies.map(vacancy => {
        const id = String(vacancy.id);
        const row = saved.get(id);
        return { id, title: vacancy.title,
          questionnaire_status: row ? (row.disabled ? 'disabled' : 'configured') :
            questionnaireFor(id) ? 'legacy' : 'missing' };
      });
      return reply({ vacancies: list, email });
    }
    const vacancyMatch = path.match(/^\/rh\/api\/questionarios\/([1-9][0-9]*)$/);
    if (vacancyMatch && validId(vacancyMatch[1])) {
      const id = vacancyMatch[1];
      if (request.method === 'GET') return reply(await readAdminDefinition(env,id));
      // An unavailable / closed vacancy cannot receive a new live questionnaire.
      const vacancies = await loadVacancies();
      if (!vacancies.some(v => String(v.id) === id)) {
        return reject(404, 'Esta vaga não está disponível na Recrutei.');
      }
      const body = await jsonBody(request);
      if (request.method === 'PUT') {
        const document = normalizeQuestionnaire(body.questionnaire);
        return writeDefinition(env,id,document,false,body.expected_version,email);
      }
      if (request.method === 'DELETE') {
        return writeDefinition(env,id,null,true,body.expected_version,email);
      }
      return reject(405, 'Método não permitido.');
    }
    if (path === '/rh/api/modelos' && request.method === 'GET') {
      const { results } = await env.RESUME_DB.prepare(
        'SELECT id,name,updated_at FROM gex_questionnaire_templates ORDER BY name LIMIT 100'
      ).all();
      return reply({ templates: results || [] });
    }
    if (path === '/rh/api/modelos' && request.method === 'POST') {
      const body = await jsonBody(request);
      const name = String(body.name || '').trim();
      if (name.length < 3 || name.length > 120) {
        return reject(400, 'Dê um nome de 3 a 120 caracteres ao modelo.');
      }
      const questionnaire = normalizeQuestionnaire(body.questionnaire);
      const id = crypto.randomUUID();
      await env.RESUME_DB.prepare(
        'INSERT INTO gex_questionnaire_templates (id,name,document,updated_at,updated_by) VALUES (?,?,?,?,?)'
      ).bind(id,name,JSON.stringify(questionnaire),new Date().toISOString(),email).run();
      return reply({ saved: true, id },201);
    }
    const templateMatch = path.match(/^\/rh\/api\/modelos\/([a-f0-9-]{36})$/);
    if (templateMatch && request.method === 'GET') {
      const row = await env.RESUME_DB.prepare(
        'SELECT document,name FROM gex_questionnaire_templates WHERE id=?'
      ).bind(templateMatch[1]).first();
      if (!row) return reject(404, 'Modelo não encontrado.');
      return reply({ name: row.name, questionnaire: normalizeQuestionnaire(JSON.parse(row.document)) });
    }
    return reject(404, 'Rota não encontrada.');
  } catch (error) {
    if (error?.status) return reject(error.status, error.message);
    if (error instanceof SyntaxError || /pergunta|título|alternativa|Questionário|JSON/.test(error?.message || '')) {
      return reject(400, error.message);
    }
    console.warn('GEX RH: falha na configuração do questionário (sem conteúdo pessoal).');
    return reject(503, 'Não foi possível concluir esta operação. Tente novamente.');
  }
}
