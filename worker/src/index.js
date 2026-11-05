import { questionnaireFor, validateAnswers } from '../../questionnaires.js';
import { resumeAvailable, convertResume, assertResumeDatabase, storeResume, resumeField } from './resumes.js';
import { cleanupExpiredResumes, RETENTION_CRON } from './retention.js';
import { smokeResume } from './smoke.js';

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

function positiveId(value) {
  const id = String(value ?? '');
  return id === id.trim() && /^[1-9][0-9]*$/.test(id) &&
    Number.isSafeInteger(Number(id));
}

// Formulários brasileiros aceitam R$ 8.000,00; a API exige "8000.00".
function normalizeRemuneration(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  let normalized;
  if (/^[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?$/.test(input)) {
    normalized = input.replace(/\./g, '').replace(',', '.');
  } else if (/^[0-9]+(?:,[0-9]{1,2})?$/.test(input)) {
    normalized = input.replace(',', '.');
  } else if (/^[0-9]+(?:\.[0-9]{1,2})?$/.test(input)) {
    normalized = input;
  } else {
    return null;
  }
  return Number.isFinite(Number(normalized)) && Number(normalized) > 0
    ? normalized : null;
}

function validBirthday(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
      Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    department: v.department ?? null,
    // Recrutei fields are passed through only when provided as strings.
    // Never guess missing job descriptions or expose arbitrary ATS objects.
    description: typeof v.description === 'string' ? v.description :
      typeof v.job_description === 'string' ? v.job_description : null,
    contract_model: typeof v.contract_model === 'string' ? v.contract_model : null
  };
}


/**
 * Availability and Job Description from the public GEX Recrutei vacancy page.
 * The private vacancies/filter response marks expired jobs as "published" (1),
 * without exposing the application deadline. The public page distinguishes
 * closed applications with `past`/`closed` even when the status is still 1.
 * Fetches only a fixed company domain/path and reads the public Next.js data;
 * no ATS credentials or personal data are sent to the public host.
 */
const PUBLIC_CAREERS_ROOT = 'https://jobs.recrutei.com.br/gex-corporation/vacancy/';
// Confirmed public JD snapshot, used only when the public Recrutei HTML is unavailable.
const PUBLIC_JD_SNAPSHOTS = Object.freeze({
  '158928': "<h2>Sobre a vaga</h2><p>O time de Atendimento da GEX é responsável por garantir uma experiência positiva aos nossos clientes, atuando de forma próxima, ágil e resolutiva em cada contato.</p><p>Como Analista de Atendimento ao Cliente, sua missão será atender e acompanhar as demandas dos clientes, esclarecer dúvidas, solucionar problemas e contribuir para a retenção e satisfação da nossa base.</p><h2>Como será o seu dia a dia</h2><ul><li>Realizar atendimento aos clientes por meio dos canais disponibilizados pela operação.</li><li>Esclarecer dúvidas e orientar os clientes sobre produtos, processos e demais solicitações.</li><li>Identificar necessidades e buscar soluções de forma ágil e eficiente.</li><li>Acompanhar as demandas até a resolução, garantindo que o cliente receba o devido retorno.</li><li>Atuar na retenção de clientes, buscando compreender os motivos de insatisfação e apresentar alternativas quando aplicável.</li><li>Identificar oportunidades de oferta de outros produtos de acordo com o perfil e a necessidade do cliente.</li><li>Registrar corretamente os atendimentos e manter as informações atualizadas nos sistemas utilizados pela operação.</li><li>Seguir os processos, orientações e padrões de qualidade estabelecidos pela área.</li><li>Contribuir para uma experiência positiva e para o alcance dos resultados da operação.</li></ul><h2>O que esperamos de você</h2><ul><li>Experiência com atendimento ao cliente, Customer Service, retenção ou áreas relacionadas.</li><li>Excelente comunicação verbal e escrita.</li><li>Perfil empático, paciente e resolutivo.</li><li>Facilidade para lidar com clientes insatisfeitos e situações de objeção.</li><li>Organização e responsabilidade com os acompanhamentos.</li><li>Agilidade para lidar com diferentes demandas ao longo do dia.</li><li>Facilidade para trabalhar com sistemas e ferramentas digitais.</li><li>Foco em qualidade de atendimento e resultados.</li><li>Autonomia e comprometimento com a rotina de trabalho.</li></ul><h2>Diferenciais que vão te destacar</h2><ul><li>Experiência anterior com retenção de clientes.</li><li>Vivência em operações de atendimento remoto ou digital.</li><li>Experiência com metas e indicadores de atendimento.</li><li>Conhecimento em ferramentas de CRM.</li><li>Experiência com vendas ou oferta de produtos durante o atendimento.</li><li>Inglês será considerado um diferencial, principalmente para operações com clientes internacionais.</li></ul><h2>Como será nosso combinado</h2><ul><li>Tipo de contratação: PJ.</li><li>Modelo de trabalho: 100% remoto.</li><li>Horário: flexível.</li></ul>",
  '161497': "<h2>Sobre a posição</h2><p>Na GEX, o e-mail é um dos nossos principais canais de receita.</p><p>Nossa operação internacional exige uma infraestrutura de envio robusta, inteligente e preparada para grandes volumes, garantindo que nossas mensagens cheguem ao lugar certo, com consistência e performance.</p><p>Buscamos um(a) Especialista Sênior em Email Deliverability para assumir a responsabilidade pela reputação, estabilidade e evolução da nossa operação de e-mails.</p><p>Aqui, não buscamos apenas alguém que saiba fazer os e-mails chegarem à caixa de entrada.</p><p>Queremos alguém que consiga antecipar riscos, proteger nossa infraestrutura, desenvolver estratégias de entregabilidade e transformar eficiência técnica em receita previsível.</p><p>Você terá autonomia para tomar decisões, estruturar processos e atuar diretamente em um dos canais mais estratégicos do nosso negócio.</p><h2>Como será o seu dia a dia</h2><ul><li>Assumir a gestão da reputação de IPs, domínios e subdomínios de envio, garantindo alta entregabilidade e estabilidade.</li><li>Desenvolver estratégias de segmentação de tráfego entre fluxos transacionais, promocionais e de recuperação.</li><li>Planejar e executar estratégias de warm-up, ramp-up e migração entre plataformas de envio.</li><li>Estruturar planos de contingência para garantir a continuidade da operação diante de bloqueios ou incidentes.</li><li>Monitorar indicadores de reputação e inbox placement nos principais provedores, como Gmail, Microsoft e Yahoo.</li><li>Diagnosticar e solucionar problemas relacionados a blocklists, throttling, spam placement e quedas de reputação.</li><li>Garantir a correta configuração e manutenção dos protocolos SPF, DKIM, DMARC, BIMI e Return-Path.</li><li>Preparar a infraestrutura de envio para campanhas de alto volume, lançamentos e períodos sazonais.</li><li>Trabalhar em parceria com o squad para desenvolver estratégias de engajamento, segmentação e higiene da base.</li><li>Garantir conformidade com as regulamentações e boas práticas internacionais de envio.</li><li>Analisar indicadores e propor melhorias que conectem entregabilidade, engajamento e resultados financeiros.</li></ul><h2>Requisitos técnicos</h2><ul><li>Experiência mínima de 7 anos em Email Deliverability, com atuação em operações de alto volume.</li><li>Vivência com operações de 10 milhões ou mais de envios por mês, preferencialmente em e-commerce B2C ou DTC.</li><li>Domínio avançado de SPF, DKIM, DMARC, BIMI e autenticação de e-mails.</li><li>Experiência comprovada com warm-up de IPs dedicados, novos domínios e estratégias de inbox placement.</li><li>Conhecimento prático de Google Postmaster Tools, Microsoft SNDS/JMRP e feedback loops.</li><li>Experiência na recuperação de incidentes críticos, bloqueios e problemas de reputação.</li><li>Conhecimento das regras de bulk sender de Google, Yahoo e Microsoft.</li><li>Capacidade analítica para trabalhar com SQL, planilhas avançadas e ferramentas de BI.</li><li>Inglês intermediário a avançado para comunicação técnica com provedores internacionais.</li></ul><h2>Será um diferencial</h2><ul><li>Experiência com PowerMTA e/ou KumoMTA em ambientes Linux.</li><li>Vivência com plataformas como GetResponse, ActiveCampaign, Braze ou Salesforce Marketing Cloud.</li><li>Conhecimento em observabilidade e automações utilizando Grafana, Splunk, n8n, APIs ou scripts.</li><li>Familiaridade com novas tecnologias e tendências de entregabilidade.</li><li>Experiência com o mercado internacional de nutracêuticos e suplementos, especialmente nos Estados Unidos.</li><li>Participação em produção de conteúdo técnico, treinamentos ou palestras sobre entregabilidade.</li></ul><h2>O perfil que buscamos</h2><p>Mais do que experiência técnica, buscamos alguém que combine com o nosso jeito de trabalhar.</p><ul><li>Senso de dono: assume responsabilidades, acompanha resultados e não espera alguém dizer o que precisa ser feito.</li><li>Visão preventiva: identifica riscos antes que se tornem problemas e atua de maneira estratégica.</li><li>Mentalidade analítica: toma decisões baseadas em dados e entende como suas ações impactam o negócio.</li><li>Autonomia e protagonismo: tem segurança para tomar decisões e conduzir soluções de ponta a ponta.</li><li>Agilidade e resolução de problemas: consegue atuar em cenários complexos, com objetividade e foco na solução.</li><li>Melhoria contínua: questiona processos, propõe evoluções e busca constantemente elevar a performance.</li><li>Comunicação e colaboração: consegue traduzir questões técnicas em impactos de negócio e trabalhar em conjunto com outras áreas.</li></ul><h2>Nosso combinado</h2><ul><li>Contratação: Pessoa Jurídica (PJ)</li><li>Modelo de trabalho: 100% remoto</li><li>Horário: flexível / comercial</li><li>Remuneração: fixa em dólar + comissão por metas alcançadas</li><li>Área: Squad Email Automação</li></ul><p>Se você domina entregabilidade, gosta de resolver problemas complexos e quer transformar tecnologia, reputação e performance em resultados reais, essa oportunidade é para você!</p><p>Aqui, buscamos pessoas que assumem a responsabilidade, têm autonomia para construir soluções e fazem acontecer.</p><p>Vem construir com a GEX.</p>",
  '161288': "<h2>Sobre a vaga</h2><p>Buscamos um(a) Líder Técnico de Dados para assumir a frente técnica de Engenharia de Dados, garantindo a continuidade, a confiabilidade e a evolução da nossa estrutura de dados.</p><p>Essa pessoa terá atuação prática na construção, manutenção e melhoria de pipelines, arquitetura e processos de dados, além de apoiar o desenvolvimento técnico da equipe e trabalhar em parceria com a liderança de Tecnologia.</p><p>Procuramos alguém com forte capacidade de execução, autonomia, visão crítica e senso de responsabilidade, que consiga equilibrar velocidade de entrega, qualidade técnica e impacto no negócio.</p><h2>Principais responsabilidades</h2><h3>Engenharia de Dados e Arquitetura</h3><ul><li>Assumir a manutenção e evolução dos pipelines de dados existentes, garantindo continuidade operacional e qualidade das entregas.</li><li>Projetar, desenvolver e otimizar pipelines escaláveis, seguros e performáticos.</li><li>Definir e aplicar boas práticas de arquitetura, modelagem, processamento e organização dos dados.</li><li>Desenvolver soluções considerando idempotência, reprocessamento, consistência dos dados e tratamento de falhas.</li><li>Atuar na investigação e resolução de problemas técnicos em ambientes produtivos.</li></ul><h3>Qualidade, Confiabilidade e Eficiência</h3><ul><li>Implementar padrões de qualidade, testes, monitoramento e observabilidade dos pipelines.</li><li>Conduzir revisões de código e estabelecer boas práticas de desenvolvimento.</li><li>Evoluir processos de CI/CD, automação e infraestrutura como código.</li><li>Identificar gargalos, riscos técnicos e oportunidades de melhoria, priorizando ações de maior impacto.</li><li>Manter documentação técnica clara e atualizada.</li></ul><h3>IA e Aceleração de Entregas</h3><ul><li>Utilizar ferramentas de Inteligência Artificial para acelerar o desenvolvimento e aumentar a produtividade técnica.</li><li>Aplicar práticas de desenvolvimento orientado por especificações, critérios de aceite e testes.</li><li>Garantir revisão crítica do código gerado por IA antes da utilização em produção.</li><li>Avaliar os resultados do uso de IA considerando produtividade, qualidade, retrabalho e confiabilidade das entregas.</li></ul><h3>Liderança Técnica e Desenvolvimento do Time</h3><ul><li>Apoiar o desenvolvimento técnico e a evolução profissional do time de dados.</li><li>Orientar o(a) Analista de Dados na resolução de problemas, aplicação de boas práticas e desenvolvimento de autonomia.</li><li>Compartilhar conhecimento, estabelecer padrões técnicos e incentivar a melhoria contínua.</li><li>Trabalhar em parceria com a liderança de Tecnologia e demais áreas para alinhar prioridades, dependências e entregas.</li><li>Contribuir com o planejamento técnico, a priorização de demandas e a redução de débitos técnicos.</li></ul><h2>Requisitos obrigatórios</h2><ul><li>Experiência sólida em Engenharia de Dados, preferencialmente a partir de 5 anos de atuação.</li><li>Experiência prévia em liderança técnica, definição de arquitetura ou orientação de profissionais de dados.</li><li>Domínio de Python e SQL avançado.</li><li>Experiência com processamento de dados em escala, utilizando PySpark ou tecnologias equivalentes.</li><li>Conhecimento de modelagem dimensional, otimização de consultas e bancos de dados relacionais, especialmente MySQL.</li><li>Experiência com plataformas de nuvem, como AWS, GCP ou Azure.</li><li>Conhecimento de infraestrutura como código, preferencialmente Terraform.</li><li>Experiência com CI/CD, automação, testes e práticas de DevOps.</li><li>Experiência com investigação e resolução de problemas em ambientes produtivos.</li><li>Uso prático de ferramentas de IA no desenvolvimento de software, com revisão crítica e validação das entregas.</li><li>Capacidade de trabalhar com autonomia, priorizar demandas e comunicar riscos técnicos de forma clara.</li></ul><h2>Diferenciais</h2><ul><li>Experiência com Apache Iceberg, Delta Lake ou Apache Hudi.</li><li>Conhecimento de ferramentas de orquestração e transformação, como Airflow e dbt.</li><li>Experiência em operações de e-commerce, transações financeiras ou negócios digitais.</li><li>Participação em projetos de migração, modernização ou reestruturação de plataformas de dados.</li><li>Inglês técnico ou avançado.</li></ul><h2>Perfil que buscamos</h2><ul><li>Garra: enfrenta desafios com iniciativa e persistência.</li><li>Aprende fazendo: testa, aprende, aplica e evolui continuamente.</li><li>Se envolve: assume responsabilidade pelas entregas e pelo resultado coletivo.</li><li>Foco no resultado: prioriza o que gera impacto real para o negócio.</li><li>Liberdade Extrema: trabalha com autonomia, responsabilidade e transparência.</li><li>Auto Pressão: mantém um alto padrão de execução e busca melhoria contínua sem depender de cobrança constante.</li></ul><h2>Modelo de contratação</h2><ul><li>Contratação PJ.</li><li>Trabalho 100% remoto.</li><li>Horários flexíveis, com responsabilidade sobre as entregas.</li></ul><h2>Como será o sucesso nessa posição?</h2><p>Esperamos que essa pessoa assuma a operação técnica de dados com segurança, estabilize e evolua os pipelines existentes, aumente a confiabilidade das entregas e contribua para o desenvolvimento do time. Tudo isso com autonomia, colaboração e foco no impacto para o negócio.</p>"
});
function publicJobSlug(v) {
  const id = String(v.id);
  let slug = typeof v.slug === 'string' ? v.slug : '';
  if (!slug) {
    const titleSlug = String(v.title || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    slug = id + '-' + titleSlug;
  }
  return new RegExp('^' + id + '-[a-z0-9-]{1,160}$').test(slug) ? slug : null;
}

async function publicRecruteiDetails(v) {
  const slug = publicJobSlug(v);
  if (!slug) return null;
  try {
    const response = await fetch(PUBLIC_CAREERS_ROOT + slug, {
      method: 'GET', redirect: 'follow',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
      // A short edge cache prevents repeated Recrutei page downloads while
      // keeping publication and expiry changes visible automatically.
      cf: { cacheEverything: true, cacheTtl: 60 }
    });
    if (!response.ok ||
        Number(response.headers.get('content-length') || 0) > 500000) return null;
    const html = await response.text();
    if (html.length > 500000) return null;
    const nextData = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!nextData) return null;
    const page = JSON.parse(nextData[1])?.props?.pageProps?.retorno;
    const job = page?.vacancy;
    if (!job || String(job.id) !== String(v.id)) return null;
    const acceptingApplications = !(
      page?.error || page?.finished || page?.past || page?.closed
    );
    if (!acceptingApplications) return { acceptingApplications: false };
    const description = typeof job.description === 'string' &&
      job.description.length < 100000 ? job.description : null;
    const regime = Number(job.show_regime) === 1 &&
      typeof job.regime?.description === 'string'
      ? job.regime.description : null;
    return { acceptingApplications: true, description, contract_model: regime };
  } catch (_) {
    // Unknown availability must never silently enable a closed vacancy.
    return null;
  }
}

async function getVacancyDetails(env, id) {
  if (!positiveId(id)) return null;
  const candidate = (await rawVacancies(env)).find(v =>
    String(v.id) === String(id) && Number(v.vacancy_status_id) === 1);
  if (!candidate) return null;
  const data = publicVacancy(candidate);
  const publicDetails = await publicRecruteiDetails(candidate);
  if (publicDetails?.acceptingApplications !== true) return null;
  return {
    ...data,
    description: publicDetails?.description || data.description || PUBLIC_JD_SNAPSHOTS[String(candidate.id)] || null,
    contract_model: data.contract_model || publicDetails?.contract_model ||
      (['161497', '161288'].includes(String(candidate.id)) ? 'Pessoa Jurídica' : null)
  };
}
function firstPipeStageId(vacancy) {
  const stages = [...(vacancy.pipe_stages || [])].sort(
    (a, b) => Number(a.order ?? 999) - Number(b.order ?? 999)
  );

  return stages[0]?.id || null;
}

async function listVacancies(env) {
  const published = (await rawVacancies(env))
    .filter(v => Number(v.vacancy_status_id) === 1);
  const available = [];
  let unavailableChecks = 0;
  // Keep a modest level of parallelism when more vacancies are published.
  for (let i = 0; i < published.length; i += 8) {
    const batch = published.slice(i, i + 8);
    const statuses = await Promise.all(batch.map(publicRecruteiDetails));
    for (let j = 0; j < batch.length; j++) {
      if (statuses[j]?.acceptingApplications === true) {
        available.push(publicVacancy(batch[j]));
      } else if (statuses[j] === null) {
        unavailableChecks++;
      }
    }
  }
  if (published.length && !available.length && unavailableChecks) {
    const error = new Error('Não foi possível atualizar a disponibilidade das vagas na Recrutei. Tente novamente mais tarde.');
    error.status = 503;
    throw error;
  }
  return available;
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

  // O ID da prospecção é distinto do ID do talento. O endpoint
  // /curriculum/filled/{id} recebe data.talent.id, nunca prospect.id.
  const prospectId =
    body?.data?.talent?.prospect?.id ||
    body?.data?.application?.prospect?.id ||
    body?.data?.application?.prospect_id ||
    body?.data?.prospect?.id ||
    null;

  return { talentId, applicationId, prospectId };
}

function buildProfilePayload(payload, applicationId, resumeMarkdown = null) {
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
    application_id: Number(applicationId),
    basic_infos: basicInfos,
    additional,
    ...(resumeMarkdown ? { informations: [resumeField(resumeMarkdown)] } : {})
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

function profileDiagnosticConfig(env, write = false) {
  const applicationId = String(env.PROFILE_DIAGNOSTIC_APPLICATION_ID || '');
  const vacancyId = String(env.PROFILE_DIAGNOSTIC_VACANCY_ID || '');
  if (env.PROFILE_DIAGNOSTIC_ENABLED !== 'true' ||
      (write && env.PROFILE_DIAGNOSTIC_WRITE_ENABLED !== 'true') ||
      !positiveId(applicationId) || !positiveId(vacancyId)) {
    return null;
  }
  return { applicationId, vacancyId };
}

async function lookupApplication(env, applicationId) {
  let lookupStatus = null;
  try {
    const response = await recrutei(env, `/api/v1/applications/${applicationId}`, {
      method: 'GET', headers: { 'Content-Type': 'application/json' }
    });
    lookupStatus = response.status;
    if (!response.ok) throw new Error('Lookup failed');
    const body = await response.json();
    const application = body?.data ?? body;
    return { ok: true, application, lookup_http_status: lookupStatus };
  } catch {
    return { ok: false, lookup_http_status: lookupStatus };
  }
}

async function lookupConfiguredTestApplication(env, config) {
  const result = await lookupApplication(env, config.applicationId);
  if (!result.ok) return result;
  const application = result.application;
  const name = application?.talent?.prospect?.name || application?.prospect?.name ||
    application?.talent?.user?.name;
  const applicationMatches = String(application?.id) === config.applicationId;
  const vacancyMatches = String(application?.vacancy_id) === config.vacancyId;
  if (!applicationMatches || !vacancyMatches || typeof name !== 'string' ||
      !/^teste(?:\s|\d|$)/i.test(name.trim())) {
    return {
      ok: false, mismatch: true, lookup_http_status: result.lookup_http_status,
      application_matches_config: applicationMatches,
      vacancy_matches_config: vacancyMatches
    };
  }
  return result;
}

function diagnosticLookupFailure(result, env) {
  return json({
    ok: false, lookup_http_status: result.lookup_http_status,
    ...(result.mismatch ? {
      application_matches_config: result.application_matches_config,
      vacancy_matches_config: result.vacancy_matches_config
    } : {}),
    message: result.mismatch ? 'O registro retornado não corresponde ao teste configurado.' :
      'Não foi possível consultar o registro de teste.'
  }, result.mismatch ? 409 : 502, env);
}

async function diagnoseProspectProfile(env) {
  const config = profileDiagnosticConfig(env);
  if (!config) return json({ message: 'Rota não encontrada' }, 404, env);
  const result = await lookupConfiguredTestApplication(env, config);
  if (!result.ok) return diagnosticLookupFailure(result, env);
  const application = result.application;
  const talent = application?.talent;
  const prospect = talent?.prospect;

    const hasId = value => positiveId(String(value || ''));
    const sameId = (left, right) => hasId(left) && hasId(right)
      ? String(left) === String(right) : null;
    return json({
      ok: true, lookup_http_status: result.lookup_http_status,
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
}

async function updateProspectProfile(env, payload, createBody, resumeMarkdown = null) {
  const { talentId, applicationId } = profileIds(
    createBody,
    payload.vacancy_id
  );

  if (!positiveId(talentId) || !positiveId(applicationId)) {
    return {
      ok: false,
      reason: 'IDs do talento/candidatura não retornados pela Recrutei.'
    };
  }

  const profilePayload = buildProfilePayload(
    payload,
    applicationId,
    resumeMarkdown
  );

  if (
    !profilePayload.basic_infos.length &&
    !profilePayload.additional.length &&
    !profilePayload.informations?.length
  ) {
    return { ok: true };
  }

  const response = await recrutei(
    env,
    `/api/v2/curriculum/filled/${encodeURIComponent(talentId)}`,
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
    if (response.status === 406) {
      return {
        ok: false,
        reason: 'A Recrutei não permite alterar o perfil de um candidato que já possui conta própria.',
        diagnostics: { http_status: 406, fields: [] }
      };
    }
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

async function testProspectProfile(request, env) {
  const config = profileDiagnosticConfig(env, true);
  if (!config) return json({ message: 'Rota não encontrada' }, 404, env);
  if (!env.ALLOWED_ORIGIN || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
    return json({ message: 'Origem não permitida.' }, 403, env);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ message: 'Envie somente JSON.' }, 415, env);
  }
  let payload;
  try {
    const text = await request.text();
    if (text.length > 2048) return json({ message: 'Solicitação muito extensa.' }, 413, env);
    payload = JSON.parse(text);
  } catch {
    return json({ message: 'JSON inválido.' }, 400, env);
  }
  const birthday = payload?.birthday;
  const salary = payload?.intended_remuneration;
  const date = typeof birthday === 'string' ? new Date(`${birthday}T00:00:00.000Z`) : null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 2 ||
      !Object.keys(payload).every(key => ['birthday', 'intended_remuneration'].includes(key)) ||
      typeof birthday !== 'string' || birthday !== birthday.trim() ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthday) || Number(birthday.slice(0, 4)) < 1 ||
      !Number.isFinite(date?.getTime()) || date.toISOString().slice(0, 10) !== birthday ||
      typeof salary !== 'string' || salary !== salary.trim() ||
      !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(salary) || !Number.isFinite(Number(salary))) {
    return json({ message: 'Informe somente nascimento válido e pretensão salarial numérica.' }, 400, env);
  }

  const lookup = await lookupConfiguredTestApplication(env, config);
  if (!lookup.ok) return diagnosticLookupFailure(lookup, env);
  const application = lookup.application;
  const talentId = application.talent?.id ?? application.talent_id;
  if (!positiveId(talentId) ||
      (application.talent_id != null && String(application.talent_id) !== String(talentId))) {
    return json({ message: 'Não foi possível confirmar o talento do registro de teste.' }, 409, env);
  }
  const profileResult = await completeApplicationStep(() => updateProspectProfile(env, {
    vacancy_id: config.vacancyId, birthday, intended_remuneration: salary
  }, { data: { talent: { id: talentId, prospect: application.talent?.prospect },
    application: { id: config.applicationId, prospect: application.prospect,
      prospect_id: application.prospect_id } } }));
  const readback = await lookupConfiguredTestApplication(env, config);
  const verified = readback.ok &&
    String(readback.application?.talent?.id ?? readback.application?.talent_id) === String(talentId);
  let salaryVerified = null;
  if (verified) {
    const talent = readback.application.talent;
    const prospects = [talent?.professional_profile, talent?.prospect, readback.application.prospect];
    const values = prospects.flatMap(group => [group?.intended_remuneration, group?.intended])
      .filter(value => value != null && String(value).trim() !== '');
    const numbers = values.map(value => String(value).trim().replace(',', '.'))
      .filter(value => /^[0-9]+(?:\.[0-9]+)?$/.test(value) && Number.isFinite(Number(value)));
    if (numbers.length) salaryVerified = numbers.some(value => Number(value) === Number(salary));
  }
  return json({
    ok: profileResult.ok, application_created: false,
    profile_completed: profileResult.ok,
    birthday_verified: verified ? readback.application.talent?.birthday === birthday : null,
    salary_verified: salaryVerified,
    ...(!profileResult.ok ? {
      profile_warning: 'Não foi possível complementar o perfil do registro de teste.',
      profile_error: profileResult.diagnostics || { http_status: null, fields: [] }
    } : {})
  }, 200, env);
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
      const unanswered = question.required === false &&
        (!answer || (Array.isArray(answer) && !answer.length));
      const html = unanswered ? '<p>Não informado</p>' : Array.isArray(answer)
        ? `<ul>${answer.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p>${question.type === 'long' ? escapeHtml(answer).replace(/\r\n?|\n/g, '<br>') : escapeHtml(answer)}</p>`;
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

// If the documented Recrutei custom-field endpoint rejects the update,
 // keep the curriculum readable in a candidate observation, never as a public R2 link.
async function addResumeObservation(env, payload, createBody, markdown) {
  const { talentId, applicationId } = profileIds(createBody, payload.vacancy_id);
  if (!positiveId(talentId) || !positiveId(applicationId)) {
    return { ok: false, reason: 'IDs da candidatura não retornados para o currículo.' };
  }
  const limit = 24000;
  const excerpt = markdown.slice(0, limit);
  const trailer = markdown.length > limit
    ? '\n[Conteúdo abreviado na observação; versão integral armazenada privadamente na GEX.]'
    : '';
  const form = new FormData();
  form.set('application_id', String(applicationId));
  form.set('talent_id', String(talentId));
  form.set('talent_observation_type_id', '7');
  form.set('action','1');
  form.set('description',
    '<p><strong>GEX Talents | Currículo convertido em Markdown</strong></p>' +
    '<p>Texto extraído do currículo enviado pelo candidato. Conteúdo armazenado nesta observação da Recrutei.</p>' +
    '<pre>' + escapeHtml(excerpt + trailer) + '</pre>');
  const response = await recrutei(env, '/api/v2/talents-observations', {
    method:'POST', body:form
  });
  return response.ok ? { ok:true } :
    { ok:false, reason:'Não foi possível registrar o currículo na observação da Recrutei.' };
}

// HTTP 406: perfis criados pelo próprio candidato não são editáveis pela API.
// Preserva os dois dados confirmados pelo suporte em uma observação restrita ao RH.
async function addReadOnlyProfileObservation(env, payload, createBody) {
  const { talentId, applicationId } = profileIds(createBody, payload.vacancy_id);
  if (!positiveId(talentId) || !positiveId(applicationId)) {
    return { ok: false, reason: 'IDs da candidatura não retornados para a observação.' };
  }
  const form = new FormData();
  form.set('application_id', String(applicationId));
  form.set('talent_id', String(talentId));
  form.set('talent_observation_type_id', '7');
  form.set('action', '1');
  form.set('description',
    '<p><strong>GEX Talents | Dados complementares</strong></p>' +
    '<p>Este candidato possui um perfil próprio na Recrutei (HTTP 406). ' +
    'A integração não pode alterar os dados do perfil.</p>' +
    `<p><strong>Data de nascimento:</strong> ${escapeHtml(payload.birthday || 'Não informada')}</p>` +
    `<p><strong>Pretensão salarial:</strong> ${escapeHtml(payload.intended_remuneration || 'Não informada')}</p>`);
  const response = await recrutei(env, '/api/v2/talents-observations', {
    method: 'POST', body: form
  });
  return response.ok ? { ok: true } : {
    ok: false, reason: 'Não foi possível registrar os dados complementares na Recrutei.'
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

  // Once enabled for new candidate applications, curriculum is mandatory.
  if (resumeAvailable(env) && String(rawPayload?.form_version) === '2' &&
      !rawPayload?.resume) {
    const error = new Error('Anexe seu currículo em PDF ou DOCX.');
    error.status = 400;
    throw error;
  }

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

  if (completeForm) {
    if (!validBirthday(payload.birthday)) {
      const error = new Error('Informe uma data de nascimento válida.');
      error.status = 400;
      throw error;
    }
    const salary = normalizeRemuneration(payload.intended_remuneration);
    if (!salary) {
      const error = new Error('Informe uma pretensão salarial válida.');
      error.status = 400;
      throw error;
    }
    payload.intended_remuneration = salary;
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

  const publicStatus = await publicRecruteiDetails(vacancy);
  if (publicStatus?.acceptingApplications !== true) {
    const error = new Error(publicStatus?.acceptingApplications === false
      ? 'As inscrições para esta vaga foram encerradas.'
      : 'Não foi possível confirmar se esta vaga ainda recebe candidaturas. Tente novamente mais tarde.');
    error.status = publicStatus?.acceptingApplications === false ? 400 : 503;
    throw error;
  }

  const pipeStageId = firstPipeStageId(vacancy);

  if (!pipeStageId) {
    throw new Error(
      'Não foi possível identificar a etapa inicial da vaga.'
    );
  }

  // Convert before creating a candidate: invalid / unconvertible resumes
  // must never create partial applications.
  const resumeFile = payload.resume;
  if (resumeFile) await assertResumeDatabase(env);
  const markdown = resumeFile ? await convertResume(env, resumeFile) : null;

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

  let resumeStored = false;
  let resumeStoreWarning = null;
  if (markdown) {
    const { applicationId } = profileIds(createBody, payload.vacancy_id);
    const stored = await completeApplicationStep(() =>
      storeResume(env, markdown, applicationId, payload.vacancy_id)
        .then(() => ({ ok:true })));
    resumeStored = stored.ok;
    if (!stored.ok) resumeStoreWarning = 'Não foi possível armazenar o currículo na GEX.';
  }

  let profileCompleted = true;
  let profileWarning = null;
  let profileError = null;

  if (completeForm || markdown) {
    const profileResult = await completeApplicationStep(() =>
      updateProspectProfile(env, payload, createBody, markdown)
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

  // Keep one HR-readable observation even if the custom field succeeds:
  // this is the safest way to keep the curriculum visible in Recrutei when
  // profile updates are silently ignored or unsupported for prospects.
  const resumeObservation = markdown
    ? await completeApplicationStep(() =>
        addResumeObservation(env, payload, createBody, markdown))
    : null;
  const readOnlyProfileObservation = profileError?.http_status === 406
    ? await completeApplicationStep(() =>
        addReadOnlyProfileObservation(env, payload, createBody))
    : null;
  const resumeLinked = Boolean(markdown) &&
    (profileCompleted || resumeObservation?.ok === true);

  return {
    ok: true,
    application_created: true,
    ...(markdown ? {
      resume_stored: resumeStored,
      resume_custom_field_completed: profileCompleted,
      resume_observation_completed: Boolean(resumeObservation?.ok),
      resume_completed: Boolean(resumeStored && resumeLinked),
      ...(!resumeLinked ? { resume_warning: resumeStoreWarning ||
        'Currículo recebido, mas não foi possível confirmar seu vínculo na Recrutei.' } : {})
    } : {}),
    ...(observationResult ? {
      observation_completed: observationResult.ok,
      ...(!observationResult.ok ? { observation_warning: observationResult.reason } : {})
    } : {}),
    ...(readOnlyProfileObservation ? {
      profile_fallback_observation_completed: readOnlyProfileObservation.ok,
      ...(!readOnlyProfileObservation.ok ? {
        profile_fallback_warning: readOnlyProfileObservation.reason
      } : {})
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
  async scheduled(controller, env) {
    if (controller.cron !== RETENTION_CRON) return;
    const report = await cleanupExpiredResumes(env, { now:controller.scheduledTime });
    // No resume content, names, emails or IDs in logs.
    console.info('GEX Talents | retenção D1:', report.status,
      report.status === 'dry_run' ? report.eligible : report.deleted);
  },
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
      if (request.method === 'POST' && url.pathname === '/api/teste-perfil') {
        return testProspectProfile(request, env);
      }

      const detailId = request.method === 'GET' &&
        url.pathname.startsWith('/api/vagas/')
          ? url.pathname.slice('/api/vagas/'.length)
          : null;
      if (detailId && positiveId(detailId)) {
        const result = await getVacancyDetails(env, detailId);
        if (!result) return json({ message: 'Vaga não disponível' }, 404, env);
        const reply = json({ data: result }, 200, env);
        // A vaga pode fechar enquanto o visitante navega; evite detalhe obsoleto.
        reply.headers.set('Cache-Control', 'no-store');
        return reply;
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
        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > 6 * 1024 * 1024) {
          return json({ message:'O currículo deve ter até 5 MB.' },413,env);
        }
        let payload;
        if (contentType.includes('multipart/form-data')) {
          // Do not accept untrusted cross-origin browser file submissions.
          if (request.headers.get('Origin') !==
              (env.ALLOWED_ORIGIN || 'https://recursoshumanos-2026.github.io')) {
            return json({ message:'Origem não permitida.' },403,env);
          }
          if (!resumeAvailable(env)) {
            return json({ message:'O envio de currículos não está habilitado neste ambiente.' },503,env);
          }
          const formData = await request.formData();
          payload = Object.fromEntries(formData.entries());
          if (typeof payload.questionnaire_answers === 'string') {
            try { payload.questionnaire_answers = JSON.parse(payload.questionnaire_answers); }
            catch { return json({ message:'Respostas da vaga inválidas.' },400,env); }
          }
        } else if (contentType.includes('application/json')) {
          payload = await request.json();
        } else {
          return json({ message:'Formato de candidatura não suportado.' },415,env);
        }

        return json(
          await createProspect(env, payload),
          201,
          env
        );
      }

      if (request.method === 'GET' && url.pathname === '/health' &&
          url.searchParams.get('check') === 'conversion' &&
          env.RESUME_DIAGNOSTIC_ENABLED === 'true') {
        // One-shot synthetic test: no real candidate and no Recrutei API writes.
        const result = await smokeResume(env);
        const response = json(result,result.ok ? 200 : 503,env);
        response.headers.set('Cache-Control','no-store');
        return response;
      }

      if (request.method === 'GET' && url.pathname === '/health' &&
          url.searchParams.get('check') === 'resume' &&
          env.RESUME_DIAGNOSTIC_ENABLED === 'true') {
        const status = {
          ok: true,
          environment: 'preview',
          resume_upload_enabled: resumeAvailable(env),
          // Presence only; never expose API keys, passwords, identities or values.
          recrutei_credentials_configured: [
            'RECRUTEI_API_KEY','RECRUTEI_API_SECRET',
            'RECRUTEI_EMAIL','RECRUTEI_PASSWORD'
          ].every(key => typeof env?.[key] === 'string' && env[key].length > 0),
          d1_table_ready: false,
          pdf_supported: false,
          docx_supported: false
        };
        if (typeof env?.RESUME_DB?.prepare === 'function') {
          try {
            // Probes table readiness without retrieving or returning candidate data.
            await env.RESUME_DB.prepare('SELECT id FROM candidate_resumes LIMIT 1').first();
            status.d1_table_ready = true;
          } catch {}
        }
        if (typeof env?.AI?.toMarkdown === 'function') {
          try {
            const supported = await env.AI.toMarkdown().supported();
            const formats = Array.isArray(supported) ? supported :
              Array.isArray(supported?.results) ? supported.results : [];
            status.pdf_supported = formats.some(item =>
              item.extension === '.pdf' || item.extension === 'pdf');
            status.docx_supported = formats.some(item =>
              item.extension === '.docx' || item.extension === 'docx');
          } catch {}
        }
        const response = json(status,200,env);
        response.headers.set('Cache-Control','no-store');
        return response;
      }

      if (url.pathname === '/health') {
        return json(
          {
            ok: true,
            applications_enabled:
              env.APPLICATIONS_ENABLED === 'true' &&
              Boolean(env.PROSPECT_CHANNEL_ID),
            candidate_form_version: 2,
            // Marcador público, sem dados pessoais, para confirmar o deploy da correção.
            profile_update_endpoint: 'talent_path_v2',
            vacancy_availability_check: 'recrutei_public_close_flags_v1',
            curriculum_storage: resumeAvailable(env),
            // Safe, non-sensitive connection diagnostics. These only report
            // whether bindings exist; they never access candidate data.
            resume_connections: {
              workers_ai: typeof env?.AI?.toMarkdown === 'function',
              d1_database: typeof env?.RESUME_DB?.prepare === 'function'
            },
            resume_upload_enabled: resumeAvailable(env),
            resume_required: resumeAvailable(env),
            resume_formats: ['pdf','docx'],
            resume_max_bytes: 5242880,
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
        [400, 413, 415, 422, 503].includes(error.status) ? error.status : 500,
        env
      );
    }
  }
};

