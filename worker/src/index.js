import { questionnaireFor, validateAnswers } from '../../questionnaires.js';

const API_BASE = 'https://api.recrutei.com.br';
let tokenCache = { token: null, expiresAt: 0 };

function cors(env) {
  return {
    'Access-Control-Allow-Origin':
      env.ALLOWED_ORIGIN || 'https://recursoshumanos-2026.github.io',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors(env)
    }
  });
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

async function getBearer(env) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  const response = await fetch(`${API_BASE}/api/v1/login-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.RECRUTEI_API_KEY,
      'x-api-secret': env.RECRUTEI_API_SECRET
    },
    body: JSON.stringify({
      email: env.RECRUTEI_EMAIL,
      password: env.RECRUTEI_PASSWORD
    })
  });

  if (!response.ok) {
    throw new Error(`Falha de autenticação Recrutei (${response.status})`);
  }

  const body = await response.json();

  tokenCache = {
    token: body.token,
    expiresAt:
      Date.now() +
      Math.min(
        Number(body.expires_in || 3600) * 1000,
        12 * 60 * 60 * 1000
      )
  };

  return body.token;
}

async function recrutei(env, path, options = {}) {
  const token = await getBearer(env);

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

async function rawVacancies(env) {
  const response = await recrutei(
    env,
    '/api/v2/vacancies/filter?page=1&perPage=100',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        orderBy: {
          field: 'created_at',
          type: 'DESC'
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Falha ao listar vagas (${response.status})`);
  }

  const body = await response.json();
  return body.data || [];
}

function publicVacancy(v) {
  return {
    id: v.id,
    title: v.title,
    city: v.city ?? null,
    state: v.state ?? null,
    remote: v.remote,
    vacancy_status_id: v.vacancy_status_id,
    slug: v.slug ?? null,
    department: v.department ?? null
  };
}

function firstPipeStageId(vacancy) {
  const stages = [...(vacancy.pipe_stages || [])].sort(
    (a, b) => Number(a.order ?? 999) - Number(b.order ?? 999)
  );

  return stages[0]?.id || null;
}

async function listVacancies(env) {
  return (await rawVacancies(env))
    .filter(v => Number(v.vacancy_status_id) === 1)
    .map(publicVacancy);
}

function profileIds(body, vacancyId) {
  const talentId =
    body?.data?.talent?.id ||
    body?.data?.application?.prospect?.talent_id ||
    body?.data?.application?.talent_id ||
    null;

  const applicationId =
    body?.data?.application?.id ||
    body?.data?.talent?.applications?.find(
      item => String(item.vacancy_id) === String(vacancyId)
    )?.id ||
    null;

  return { talentId, applicationId };
}

function buildProfilePayload(payload, talentId, applicationId) {
  const basicInfos = [];
  const additional = [];

  if (clean(payload.birthday)) {
    basicInfos.push({
      key: 'birthday',
      value: clean(payload.birthday),
      title: 'Data de nascimento'
    });
  }

  if (clean(payload.ssn)) {
    basicInfos.push({
      key: 'ssn',
      value: clean(payload.ssn),
      title: 'CPF'
    });
  }

  if (clean(payload.linkedin_url)) {
    basicInfos.push({
      key: 'linkedin_url',
      value: clean(payload.linkedin_url),
      title: 'LinkedIn'
    });
  }

  const city = clean(payload.city);
  const state = clean(payload.state);

  if (city || state) {
    basicInfos.push({
      key: 'city',
      value: [city, state].filter(Boolean).join(' - '),
      title: 'Cidade'
    });
  }

  if (clean(payload.intended_remuneration)) {
    additional.push({
      key: 'intended_remuneration',
      value: String(clean(payload.intended_remuneration)),
      title: 'Pretensão salarial'
    });
  }

  if (clean(payload.available)) {
    additional.push({
      key: 'available',
      value: String(clean(payload.available)),
      title: 'Disponibilidade para início'
    });
  }

  return {
    talent_id: Number(talentId),
    application_id: Number(applicationId),
    basic_infos: basicInfos,
    additional
  };
}

function profileValidationFields(body) {
  const errors = body?.errors;
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
    return [];
  }

  // Somente nomes conhecidos: mensagens e valores rejeitados ficam no backend.
  const allowed = /^(?:talent_id|application_id|birthday|ssn|city|linkedin_url|intended_remuneration|available|(?:basic_infos|additional)(?:\.[0-9]+(?:\.(?:key|value|title))?)?)$/;
  return Object.keys(errors).filter(field =>
    field === field.trim() && allowed.test(field)
  );
}

function diagnosticField(object, key) {
  const exists = object != null && Object.hasOwn(object, key);
  const value = exists ? object[key] : undefined;
  return {
    exists,
    has_value: exists && value != null &&
      (typeof value !== 'string' || value.trim().length > 0),
    type: !exists ? 'missing' : value === null ? 'null' :
      Array.isArray(value) ? 'array' : typeof value
  };
}

async function diagnoseProspectProfile(env) {
  const applicationId = String(env.PROFILE_DIAGNOSTIC_APPLICATION_ID || '');
  const vacancyId = String(env.PROFILE_DIAGNOSTIC_VACANCY_ID || '');
  const positiveId = value => value === value.trim() && /^[1-9][0-9]*$/.test(value) &&
    Number.isSafeInteger(Number(value));
  if (env.PROFILE_DIAGNOSTIC_ENABLED !== 'true' ||
      !positiveId(applicationId) || !positiveId(vacancyId)) {
    return json({ message: 'Rota não encontrada' }, 404, env);
  }

  let lookupStatus = null;
  try {
    const response = await recrutei(env, `/api/v1/applications/${applicationId}`, {
      method: 'GET', headers: { 'Content-Type': 'application/json' }
    });
    lookupStatus = response.status;
    if (!response.ok) throw new Error('Lookup failed');
    const body = await response.json();
    const application = body?.data ?? body;
    const talent = application?.talent;
    const prospect = talent?.prospect;
    const name = prospect?.name || application?.prospect?.name || talent?.user?.name;
    const applicationMatches = String(application?.id) === applicationId;
    const vacancyMatches = String(application?.vacancy_id) === vacancyId;
    if (!applicationMatches || !vacancyMatches || typeof name !== 'string' ||
        !/^teste(?:\s|\d|$)/i.test(name.trim())) {
      return json({
        ok: false, lookup_http_status: lookupStatus,
        application_matches_config: applicationMatches,
        vacancy_matches_config: vacancyMatches,
        message: 'O registro retornado não corresponde ao teste configurado.'
      }, 409, env);
    }

    const hasId = value => positiveId(String(value || ''));
    const sameId = (left, right) => hasId(left) && hasId(right)
      ? String(left) === String(right) : null;
    return json({
      ok: true, lookup_http_status: lookupStatus,
      application_matches_config: true, vacancy_matches_config: true,
      identifiers: {
        application_talent_id_present: hasId(application.talent_id),
        talent_id_present: hasId(talent?.id),
        application_talent_matches_talent: sameId(application.talent_id, talent?.id),
        application_prospect_id_present: hasId(application.prospect_id),
        talent_prospect_id_present: hasId(prospect?.id),
        application_prospect_matches_talent_prospect: sameId(application.prospect_id, prospect?.id),
        talent_matches_talent_prospect: sameId(talent?.id, prospect?.id),
        application_prospect_relation_id_present: hasId(application.prospect?.id),
        talent_prospect_matches_application_prospect: sameId(prospect?.id, application.prospect?.id)
      },
      talent_is_prospect: [true, 1, '1'].includes(talent?.is_prospect) ? true :
        [false, 0, '0'].includes(talent?.is_prospect) ? false : null,
      fields: {
        'talent.birthday': diagnosticField(talent, 'birthday'),
        'talent.prospect.birthday': diagnosticField(prospect, 'birthday'),
        'prospect.birthday': diagnosticField(application.prospect, 'birthday'),
        'talent.professional_profile.intended_remuneration': diagnosticField(talent?.professional_profile, 'intended_remuneration'),
        'talent.professional_profile.intended': diagnosticField(talent?.professional_profile, 'intended'),
        'talent.prospect.intended_remuneration': diagnosticField(prospect, 'intended_remuneration'),
        'prospect.intended_remuneration': diagnosticField(application.prospect, 'intended_remuneration')
      }
    }, 200, env);
  } catch {
    return json({
      ok: false, lookup_http_status: lookupStatus,
      message: 'Não foi possível consultar o registro de teste.'
    }, 502, env);
  }
}

async function updateProspectProfile(env, payload, createBody) {
  const { talentId, applicationId } = profileIds(
    createBody,
    payload.vacancy_id
  );

  if (!talentId || !applicationId) {
    return {
      ok: false,
      reason: 'IDs do talento/candidatura não retornados pela Recrutei.'
    };
  }

  const profilePayload = buildProfilePayload(
    payload,
    talentId,
    applicationId
  );

  if (
    !profilePayload.basic_infos.length &&
    !profilePayload.additional.length
  ) {
    return { ok: true };
  }

  const response = await recrutei(
    env,
    `/api/v2/curriculum/filled?talent_id=${encodeURIComponent(talentId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(profilePayload)
    }
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      reason:
        body?.message ||
        `Falha ao complementar perfil (${response.status})`,
      diagnostics: {
        http_status: response.status,
        fields: profileValidationFields(body)
      }
    };
  }

  return { ok: true };
}

async function addGexTalentsTag(env, payload, createBody) {
  const { talentId, applicationId } = profileIds(
    createBody,
    payload.vacancy_id
  );

  if (!talentId || !applicationId) {
    return {
      ok: false,
      reason:
        'IDs do talento/candidatura não retornados para criação da tag.'
    };
  }

  const response = await recrutei(
    env,
    '/api/v2/tags/talent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        application_id: Number(applicationId),
        talent_id: Number(talentId),
        key: 'generic',
        value: 'GEX Talents',
        color: '#1e6fd9'
      })
    }
  );

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      reason:
        body.message ||
        `Falha ao adicionar tag GEX Talents (${response.status})`
    };
  }

  return { ok: true };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function addQuestionnaireObservation(env, payload, createBody, answers) {
  const questionnaire = questionnaireFor(payload.vacancy_id);
  const { talentId, applicationId } = profileIds(createBody, payload.vacancy_id);
  if (![talentId, applicationId].every(id => /^[1-9]\d*$/.test(String(id)))) {
    return { ok: false, reason: 'IDs do talento/candidatura não retornados para a observação.' };
  }
  const description = '<p><strong>GEX Talents | Respostas da candidatura</strong></p>' +
    `<p><strong>Vaga:</strong> ${escapeHtml(questionnaire.title)}</p>` +
    questionnaire.questions.map((question, index) => {
      const answer = answers[question.id];
      const html = Array.isArray(answer)
        ? `<ul>${answer.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p>${escapeHtml(answer)}</p>`;
      return `<p><strong>${index + 1}. ${escapeHtml(question.label)}</strong></p>${html}`;
    }).join('');
  const form = new FormData();
  form.set('application_id', applicationId);
  form.set('talent_id', talentId);
  form.set('talent_observation_type_id', '7');
  form.set('description', description);
  form.set('action', '1');
  const response = await recrutei(env, '/api/v2/talents-observations', {
    method: 'POST', body: form
  });
  // Não refletir mensagens externas ou dados pessoais no retorno público.
  return response.ok ? { ok: true } : {
    ok: false, reason: `Não foi possível confirmar o registro da observação (${response.status}).`
  };
}

async function completeApplicationStep(operation) {
  try {
    return await operation();
  } catch {
    // A candidatura já existe: uma falha de rede não pode virar erro de criação.
    return { ok: false, reason: 'Não foi possível confirmar esta etapa após a criação da candidatura.' };
  }
}


async function createProspect(env, rawPayload) {
  if (env.APPLICATIONS_ENABLED !== 'true') {
    const error = new Error('O envio de candidaturas está desativado neste ambiente.');
    error.status = 503;
    error.code = 'APPLICATIONS_DISABLED';
    throw error;
  }

  const payload = Object.fromEntries(
    Object.entries(rawPayload || {}).map(([key, value]) => [
      key,
      clean(value)
    ])
  );

  const required = [
    'name',
    'email',
    'telephone',
    'vacancy_id'
  ];

  const completeForm =
    String(payload.form_version) === '2';

  if (completeForm) {
    required.push(
      'birthday',
      'intended_remuneration'
    );
  }

  for (const key of required) {
    if (!payload[key]) {
      throw new Error(
        `Campo obrigatório ausente: ${key}`
      );
    }
  }

  let answers;
  try {
    answers = validateAnswers(payload.vacancy_id, payload.questionnaire_answers);
  } catch (error) {
    error.status = 400;
    throw error;
  }

  if (!env.PROSPECT_CHANNEL_ID) {
    throw new Error(
      'Canal de aquisição ainda não configurado.'
    );
  }

  const vacancies = await rawVacancies(env);

  const vacancy = vacancies.find(
    v =>
      String(v.id) === String(payload.vacancy_id) &&
      Number(v.vacancy_status_id) === 1
  );

  if (!vacancy) {
    throw new Error(
      'Vaga não encontrada ou não está publicada.'
    );
  }

  const pipeStageId = firstPipeStageId(vacancy);

  if (!pipeStageId) {
    throw new Error(
      'Não foi possível identificar a etapa inicial da vaga.'
    );
  }

  const form = new FormData();

  form.set(
    'prospect_acquisition_channel_id',
    env.PROSPECT_CHANNEL_ID
  );

  form.set('name', payload.name);
  form.set('email', payload.email);
  form.set('telephone', payload.telephone);
  form.set('vacancy_id', vacancy.id);
  form.set('pipe_stage_id', pipeStageId);

  const response = await recrutei(
    env,
    '/api/v2/prospects',
    {
      method: 'POST',
      body: form
    }
  );

  const createBody = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      createBody.message ||
      `Falha ao criar candidatura (${response.status})`
    );
  }

  let profileCompleted = true;
  let profileWarning = null;
  let profileError = null;

  if (completeForm) {
    const profileResult = await completeApplicationStep(() =>
      updateProspectProfile(env, payload, createBody)
    );

    if (!profileResult.ok) {
      profileCompleted = false;
      profileWarning = profileResult.reason;
      profileError = profileResult.diagnostics || { http_status: null, fields: [] };

      console.error(
        'GEX Talents: candidatura criada, mas perfil complementar falhou:',
        profileResult.reason
      );
    }
  }

  const tagResult = await completeApplicationStep(() =>
    addGexTalentsTag(env, payload, createBody)
  );

  let tagCompleted = true;
  let tagWarning = null;

  if (!tagResult.ok) {
    tagCompleted = false;
    tagWarning = tagResult.reason;

    console.error(
      'GEX Talents: candidatura criada, mas a tag não foi adicionada:',
      tagResult.reason
    );
  }

  const observationResult = answers
    ? await completeApplicationStep(() =>
        addQuestionnaireObservation(env, payload, createBody, answers))
    : null;

  return {
    ok: true,
    application_created: true,
    ...(observationResult ? {
      observation_completed: observationResult.ok,
      ...(!observationResult.ok ? { observation_warning: observationResult.reason } : {})
    } : {}),
    message: 'Candidatura enviada com sucesso.',
    profile_completed: profileCompleted,
    tag_completed: tagCompleted,
    ...(profileWarning
      ? { profile_warning: profileWarning }
      : {}),
    ...(!profileCompleted ? { profile_error: profileError } : {}),
    ...(tagWarning
      ? { tag_warning: tagWarning }
      : {})
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors(env)
      });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/diagnostico-perfil') {
        return diagnoseProspectProfile(env);
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/api/vagas'
      ) {
        return json(
          {
            data: await listVacancies(env)
          },
          200,
          env
        );
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/api/candidatar'
      ) {
        const contentType =
          request.headers.get('content-type') || '';

        const payload =
          contentType.includes('application/json')
            ? await request.json()
            : Object.fromEntries(
                (await request.formData()).entries()
              );

        return json(
          await createProspect(env, payload),
          201,
          env
        );
      }

      if (url.pathname === '/health') {
        return json(
          {
            ok: true,
            applications_enabled:
              env.APPLICATIONS_ENABLED === 'true' &&
              Boolean(env.PROSPECT_CHANNEL_ID),
            candidate_form_version: 2,
            curriculum_storage: false,
            gex_talents_tag: true
          },
          200,
          env
        );
      }

      return json(
        {
          message: 'Rota não encontrada'
        },
        404,
        env
      );
    } catch (error) {
      return json(
        {
          message:
            error.message || 'Erro interno',
          ...(error.code === 'APPLICATIONS_DISABLED' ? {
            code: 'APPLICATIONS_DISABLED',
            applications_enabled: false,
            application_created: false
          } : {})
        },
        [400, 503].includes(error.status) ? error.status : 500,
        env
      );
    }
  }
};
