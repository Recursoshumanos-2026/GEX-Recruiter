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
    (a, b) =>
      Number(a.order ?? 999) -
      Number(b.order ?? 999)
  );

  return stages[0]?.id || null;
}

async function listVacancies(env) {
  return (await rawVacancies(env))
    .filter(v => Number(v.vacancy_status_id) === 1)
    .map(publicVacancy);
}

async function createProspect(env, payload) {
  if (env.APPLICATIONS_ENABLED !== 'true') {
    throw new Error(
      'Candidaturas diretas ainda não estão habilitadas.'
    );
  }

  const required = [
    'name',
    'email',
    'telephone',
    'vacancy_id'
  ];

  for (const key of required) {
    if (!payload[key]) {
      throw new Error(`Campo obrigatório ausente: ${key}`);
    }
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

  const body = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.message ||
      `Falha ao criar candidatura (${response.status})`
    );
  }

  return {
    ok: true,
    message: 'Candidatura enviada com sucesso.'
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
        return json(
          await createProspect(
            env,
            await request.json()
          ),
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
              Boolean(env.PROSPECT_CHANNEL_ID)
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
            error.message || 'Erro interno'
        },
        500,
        env
      );
    }
  }
};
