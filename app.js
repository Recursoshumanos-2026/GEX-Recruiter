import { questionnaireFor, validateAnswers } from './questionnaires.js?v=5';

const CONFIG = window.GEX_TALENTS_CONFIG || {};

let jobs = [];
let applicationsEnabled = false;

const DEFAULT_TITLE = 'GEX Recruiter | Carreiras';
const DEFAULT_DESCRIPTION =
  'GEX Recruiter — oportunidades para construir o próximo capítulo com a GEX.';

const grid = document.querySelector('#jobsGrid');
const empty = document.querySelector('#jobsEmpty');
const search = document.querySelector('#jobSearch');
const locationFilter = document.querySelector('#jobLocation');
const statusPill = document.querySelector('#integrationStatus');

const jobsHeading =
  document.querySelector('.jobs-heading');

const jobsToolbar =
  document.querySelector('.jobs-toolbar');

const jobsSection =
  document.querySelector('#vagas');

const talentPool =
  document.querySelector('.talent-pool');

const main =
  document.querySelector('main');

const dialog =
  document.querySelector('#applyDialog');

const form =
  document.querySelector('#applyForm');

const formMessage =
  document.querySelector('#formMessage');


function workMode(job) {
  return Number(job.remote) === 1
    ? 'Remoto'
    : Number(job.remote) === 3
      ? 'Híbrido'
      : Number(job.remote) === 2
        ? 'Presencial ou remoto'
        : 'Presencial';
}


function locationLabel(job) {
  return job.city
    ? `${job.city}${job.state ? `, ${job.state}` : ''}`
    : '';
}


function safe(value = '') {
  return String(value).replace(
    /[&<>'"]/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character]
  );
}


function specificVacancyId() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const queryId =
    params.get('vaga');

  if (
    queryId &&
    /^\d+$/.test(queryId)
  ) {
    return queryId;
  }

  const oldHash =
    window.location.hash.match(
      /^#vaga-(\d+)$/
    );

  return oldHash
    ? oldHash[1]
    : null;
}


function vacancyUrl(id) {
  const url =
    new URL(
      `${window.location.origin}${window.location.pathname}`
    );

  url.searchParams.set(
    'vaga',
    id
  );

  return url.toString();
}


function allJobsUrl() {
  return (
    `${window.location.origin}${window.location.pathname}`
  );
}


async function copyText(text) {
  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(
      text
    );

    return;
  }

  const field =
    document.createElement(
      'textarea'
    );

  field.value = text;

  field.style.position =
    'fixed';

  field.style.opacity =
    '0';

  document.body.appendChild(
    field
  );

  field.focus();
  field.select();

  document.execCommand(
    'copy'
  );

  field.remove();
}


async function shareVacancy(
  id,
  button
) {
  const url =
    vacancyUrl(id);

  const originalText =
    button.textContent;

  try {
    await copyText(url);

    button.textContent =
      'Link copiado ✓';

    button.classList.add(
      'share-success'
    );

    setTimeout(() => {
      button.textContent =
        originalText;

      button.classList.remove(
        'share-success'
      );
    }, 2200);

  } catch (error) {
    console.error(
      'Não foi possível copiar o link:',
      error
    );

    window.prompt(
      'Copie o link desta vaga:',
      url
    );
  }
}


function bindJobActions() {

  grid
    .querySelectorAll(
      '[data-apply]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {
          openApply(
            button.dataset.apply
          );
        }
      );

    });


  grid
    .querySelectorAll(
      '[data-share]'
    )
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          shareVacancy(
            button.dataset.share,
            button
          );

        }
      );

    });
}


// Render rich text from the ATS with a strict element/attribute allowlist.
// No fetched HTML attributes or active content are copied into the page.
function safeJobDescription(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  const parsed = new DOMParser().parseFromString(input, 'text/html');
  const allowed = new Set(['P','H2','H3','H4','UL','OL','LI','STRONG','B','EM','I','BR','BLOCKQUOTE','A']);
  const blocked = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','FORM','INPUT','BUTTON','VIDEO','AUDIO','IMG','META','LINK']);
  const clean = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName)) return document.createDocumentFragment();
    const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
    if (node.tagName === 'A' && target.nodeType === Node.ELEMENT_NODE) {
      const href = node.getAttribute('href') || '';
      try {
        const url = new URL(href, window.location.origin);
        if (['https:', 'http:'].includes(url.protocol)) {
          target.setAttribute('href', url.toString());
          target.setAttribute('target', '_blank');
          target.setAttribute('rel', 'noopener noreferrer');
        }
      } catch (_) {}
    }
    for (const child of node.childNodes) target.appendChild(clean(child));
    return target;
  };
  const container = document.createElement('div');
  for (const child of parsed.body.childNodes) container.appendChild(clean(child));
  return container.innerHTML.trim();
}

function vacancyBenefitsMarkup() {
  const original = document.querySelector('body > main > #beneficios');
  const benefits = original?.querySelector('.benefits-grid');
  return benefits ? `<section class="vacancy-benefits benefits-section" aria-labelledby="vacancyBenefitsTitle">
    <h3 id="vacancyBenefitsTitle">Benefícios GEX</h3>
    <div class="benefits-grid">${benefits.innerHTML}</div>
  </section>` : '';
}

function vacancyApplyButton(id, extraClass = '') {
  return `<button type="button" class="btn btn-primary ${extraClass}" data-apply="${safe(id)}"
    ${applicationsEnabled ? '' : 'disabled'}>${applicationsEnabled ? 'Quero me candidatar →' : 'Candidatura em breve'}</button>`;
}

function renderGeneralJobs() {
  document.body.classList.remove("vacancy-detail-mode");

  if (main && talentPool) {
  main.insertBefore(
    jobsSection,
    talentPool
  );
}
  jobsSection.classList.remove(
    'specific-vacancy-section'
  );

  grid.classList.remove(
    'jobs-grid--specific'
  );


  jobsHeading.style.display =
    '';

  jobsToolbar.style.display =
    '';


  if (talentPool) {
    talentPool.hidden =
      false;
  }


  document.title =
    DEFAULT_TITLE;


  const description =
    document.querySelector(
      'meta[name="description"]'
    );


  if (description) {
    description.content =
      DEFAULT_DESCRIPTION;
  }


  statusPill.textContent =
    'Vagas atualizadas';


  const term =
    search.value
      .toLowerCase()
      .trim();


  const selectedLocation =
    locationFilter.value;


  const filtered =
    jobs
      .filter(
        job =>
          Number(
            job.vacancy_status_id
          ) === 1
      )
      .filter(job => {

        if (!term) {
          return true;
        }

        const text = `
          ${job.title || ''}
          ${job.city || ''}
          ${job.state || ''}
          ${job.department || ''}
        `.toLowerCase();

        return text.includes(
          term
        );

      })
      .filter(job => {

        if (!selectedLocation) {
          return true;
        }

        const location =
          locationLabel(job) ||
          workMode(job);

        return (
          location ===
          selectedLocation
        );

      });


  grid.innerHTML =
    filtered
      .map(job => {

        const location =
          locationLabel(job);

        return `
          <article
            class="job-card"
            id="vaga-${safe(job.id)}"
          >

            <span class="job-code">
              #${safe(job.id)}
            </span>

            <span class="job-area">
              ${safe(
                job.department ||
                'GEX CORPORATION'
              )}
            </span>

            <h3><a class="job-title-link" href="${safe(vacancyUrl(job.id))}">${safe(job.title)}</a></h3>

            <div class="job-meta">

              <span>
                ${safe(
                  workMode(job)
                )}
              </span>

              ${
                location
                  ? `
                    <span>
                      ${safe(location)}
                    </span>
                  `
                  : ''
              }

            </div>

            <p>
              Conheça a oportunidade e candidate-se para fazer parte da GEX.
            </p>

            <div class="job-actions">

              <div class="job-action-buttons">

                <button
                  type="button"
                  class="job-share-button"
                  data-share="${safe(job.id)}"
                >
                  Compartilhar
                </button>

                <a class="job-apply-button job-details-link" href="${safe(vacancyUrl(job.id))}">Ver detalhes →</a>

              </div>

            </div>

          </article>
        `;

      })
      .join('');


  empty.hidden =
    filtered.length > 0;


  bindJobActions();
}


function renderSpecificVacancy(id) {
  document.body.classList.add('vacancy-detail-mode');
  if (main) main.prepend(jobsSection);
  jobsHeading.style.display = 'none';
  jobsToolbar.style.display = 'none';
  jobsSection.classList.add('specific-vacancy-section');
  grid.classList.add('jobs-grid--specific');
  if (talentPool) talentPool.hidden = true;

  const job = jobs.find(item => String(item.id) === String(id) &&
    Number(item.vacancy_status_id) === 1);
  if (!job) {
    empty.hidden = false;
    grid.innerHTML = '';
    empty.querySelector('h3').textContent = 'Esta oportunidade não está mais disponível.';
    empty.querySelector('p').innerHTML = `Confira <a href="${safe(allJobsUrl())}">todas as oportunidades abertas</a> na GEX.`;
    return;
  }
  empty.hidden = true;
  document.title = `${job.title} | GEX Recruiter`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = `${job.title} — oportunidade na GEX Corporation.`;

  const description = safeJobDescription(job.description);
  const location = locationLabel(job);
  // Contract model must only be displayed when actually supplied by the ATS.
  const contract = typeof job.contract_model === 'string' ? job.contract_model : '';
  grid.innerHTML = `
    <article class="vacancy-landing" id="vaga-${safe(job.id)}">
      <div class="vacancy-landing-top">
        <a class="vacancy-back-link" href="${safe(allJobsUrl())}#vagas">← Todas as oportunidades</a>
        <button type="button" class="vacancy-share-top" data-share="${safe(job.id)}">Compartilhar vaga</button>
      </div>
      <div class="vacancy-landing-content vacancy-landing-content--single">
        <div class="vacancy-main-content vacancy-main-content--wide">
          <span class="eyebrow">• OPORTUNIDADE NA GEX</span>
          <span class="vacancy-department">${safe(job.department || 'GEX CORPORATION')}</span>
          <h1 class="vacancy-title">${safe(job.title)}</h1>
          <div class="vacancy-meta-large">
            <span><strong>Modalidade</strong>${safe(workMode(job))}</span>
            ${location ? `<span><strong>Localidade</strong>${safe(location)}</span>` : ''}
            ${contract ? `<span><strong>Contratação</strong>${safe(contract)}</span>` : ''}
            <span><strong>Oportunidade</strong>#${safe(job.id)}</span>
          </div>
          <div class="vacancy-top-apply">${vacancyApplyButton(job.id, 'vacancy-apply-main')}</div>
          <section class="vacancy-description" aria-label="Descrição da vaga">
            <h2>Sobre a oportunidade</h2>
            ${description ? `<div class="vacancy-description-content">${description}</div>` :
              '<p class="vacancy-description-missing">A descrição completa desta oportunidade ainda não está disponível. Consulte novamente em breve.</p>'}
          </section>
          ${vacancyBenefitsMarkup()}
          <div class="vacancy-primary-action vacancy-bottom-action">
            <div><span class="vacancy-cta-label">FAÇA PARTE DA GEX</span>
              <h3>Gostou desta oportunidade?</h3>
              <p>Envie sua candidatura diretamente pelo GEX Recruiter.</p>
            </div>
            ${vacancyApplyButton(job.id, 'vacancy-apply-main')}
          </div>
        </div>
      </div>
    </article>`;
  bindJobActions();
}

function render() {

  const vacancyId =
    specificVacancyId();


  if (vacancyId) {

    renderSpecificVacancy(
      vacancyId
    );

    return;
  }


  renderGeneralJobs();
}


function populateLocations() {

  const locations = [
    ...new Set(
      jobs
        .map(
          job =>
            locationLabel(job) ||
            workMode(job)
        )
        .filter(Boolean)
    )
  ].sort();


  locationFilter.innerHTML =
    '<option value="">Todas as localidades</option>' +
    locations
      .map(
        value =>
          `<option value="${safe(value)}">${safe(value)}</option>`
      )
      .join('');
}


async function readBackendStatus() {

  try {

    const response =
      await fetch(
        `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/health`
      );


    if (!response.ok) {

      applicationsEnabled =
        false;

      return;
    }


    const body =
      await response.json();


    applicationsEnabled =
      Boolean(
        body.applications_enabled
      );


  } catch (error) {

    applicationsEnabled =
      false;

  }
}


async function loadJobs() {

  try {

    await readBackendStatus();


    const response =
      await fetch(
        `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/vagas`
      );


    if (!response.ok) {
      throw new Error(
        'Falha ao carregar vagas'
      );
    }


    const body =
      await response.json();


    jobs =
      body.data || [];


  } catch (error) {

    jobs = [];


    statusPill.textContent =
      'Não foi possível carregar as vagas agora';

  }


  populateLocations();

  render();
}


function openApply(id) {

  const job =
    jobs.find(
      item =>
        String(item.id) ===
        String(id)
    );


  if (
    !job ||
    !applicationsEnabled
  ) {
    return;
  }


  form.reset();
  form.dataset.applicationCreated = '';
  form.querySelector('.submit-btn').disabled = false;

  formMessage.hidden =
    true;

  formMessage.textContent =
    '';


  document.querySelector(
    '#applyJobTitle'
  ).textContent =
    job.title;


  document.querySelector(
    '#vacancyId'
  ).value =
    job.id;


  renderQuestionnaire(job.id);

  dialog.showModal();
}


function renderQuestionnaire(vacancyId) {
  const section = document.querySelector('#vacancyQuestionnaire');
  const questionnaire = questionnaireFor(vacancyId);
  section.replaceChildren();
  section.hidden = !questionnaire;
  if (!questionnaire) return;
  section.innerHTML = `
    <div class="application-section-heading">
      <span>03</span>
      <div><h3 id="vacancyQuestionnaireTitle">Perguntas da vaga</h3>
      <p>${questionnaire.questions.some(question => question.required === false)
        ? 'Responda às perguntas obrigatórias para concluir sua candidatura.'
        : 'Responda a todas as perguntas para concluir sua candidatura.'}</p></div>
    </div>
    <div class="application-grid questionnaire-grid">
      ${questionnaire.questions.map((question, index) => {
        const name = `question_${question.id}`;
        const required = question.required !== false;
        const label = `${index + 1}. ${safe(question.label)}${required ? ' *' : ' (opcional)'}`;
        if (question.type === 'text') {
          return `<label>${label}<input name="${name}" ${required ? 'required' : ''} maxlength="500" /></label>`;
        }
        if (question.type === 'long') {
          return `<label class="questionnaire-long">${label}<textarea name="${name}" ${required ? 'required' : ''} maxlength="5000" rows="6"></textarea></label>`;
        }
        return `<fieldset data-question="${safe(question.id)}"><legend>${label}</legend>
          ${question.type === 'multiple' ? '<p class="questionnaire-hint">Selecione uma ou mais alternativas.</p>' : ''}
          ${question.options.map(option => `<label class="questionnaire-option">
            <input type="${question.type === 'single' ? 'radio' : 'checkbox'}" name="${name}"
              value="${safe(option)}" ${question.type === 'single' && required ? 'required' : ''} />
            <span>${safe(option)}</span></label>`).join('')}
        </fieldset>`;
      }).join('')}
    </div>`;
  section.addEventListener('change', validateQuestionnaireControls);
}

function validateQuestionnaireControls() {
  const questionnaire = questionnaireFor(form.elements.vacancy_id.value);
  if (!questionnaire) return;
  for (const question of questionnaire.questions) {
    const controls = [...form.querySelectorAll(`[name="question_${question.id}"]`)];
    if (question.type === 'multiple') {
      controls[0].setCustomValidity(question.required === false || controls.some(control => control.checked)
        ? '' : 'Selecione ao menos uma alternativa.');
    } else if (question.type === 'text' || question.type === 'long') {
      controls[0].setCustomValidity(question.required === false || controls[0].value.trim() ? '' : 'Preencha esta resposta.');
    }
  }
}


function normalizeFormPayload() {

  const formData =
    new FormData(form);


  const payload =
    Object.fromEntries(
      formData.entries()
    );


  delete payload.privacy;

  const questionnaire = questionnaireFor(payload.vacancy_id);
  if (questionnaire) {
    const answers = {};
    for (const question of questionnaire.questions) {
      const name = `question_${question.id}`;
      answers[question.id] = question.type === 'multiple'
        ? formData.getAll(name) : formData.get(name);
      delete payload[name];
    }
    payload.questionnaire_answers = validateAnswers(payload.vacancy_id, answers);
  }


  return payload;
}


form.addEventListener('input', validateQuestionnaireControls);

form.addEventListener(
  'submit',
  async event => {

    event.preventDefault();


    formMessage.hidden =
      true;

    validateQuestionnaireControls();

    if (
      !form.reportValidity()
    ) {
      return;
    }


    if (
      !applicationsEnabled
    ) {

      formMessage.className =
        'form-message error';


      formMessage.textContent =
        'As candidaturas online não estão disponíveis neste momento.';


      formMessage.hidden =
        false;


      return;
    }


    const payload =
      normalizeFormPayload();


    const button =
      form.querySelector(
        '.submit-btn'
      );


    button.disabled =
      true;


    button.textContent =
      'Enviando candidatura...';


    try {

      const response =
        await fetch(
          `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/candidatar`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );


      const body =
        await response
          .json()
          .catch(
            () => ({})
          );


      if (!response.ok && body.code === 'APPLICATIONS_DISABLED') {
        applicationsEnabled = false;
        formMessage.className = 'form-message error';
        formMessage.textContent = 'O envio de candidaturas está desativado neste ambiente. Nenhuma nova candidatura foi criada nesta tentativa.';
        formMessage.hidden = false;
        render();
        return;
      }


      if (
        !response.ok
      ) {

        throw new Error(
          body.message ||
          'Não foi possível enviar sua candidatura.'
        );

      }


      if (questionnaireFor(payload.vacancy_id)) {
        form.dataset.applicationCreated = 'true';
      }

      formMessage.className =
        'form-message success';


      formMessage.textContent =
        'Candidatura enviada com sucesso! Seus dados foram recebidos pela GEX.';


      formMessage.hidden =
        false;


      if (
        body.profile_completed ===
        false
      ) {

        console.warn(
          'Candidatura criada, mas houve uma pendência na atualização dos dados complementares.',
          body.profile_warning || ''
        );

      }


      if (
        body.tag_completed ===
        false
      ) {

        console.warn(
          'Candidatura criada, mas a tag do processo não foi adicionada.',
          body.tag_warning || ''
        );

      }


      if (questionnaireFor(payload.vacancy_id) && body.observation_completed !== true) {
        formMessage.className = 'form-message error';
        formMessage.textContent = 'Sua candidatura foi criada, mas não foi possível confirmar o registro das respostas da vaga. Não reenvie a candidatura. Entre em contato com o RH da GEX para regularizar as respostas.';
        // Preserve as respostas para o candidato poder encaminhá-las ao RH.
        return;
      }

      form.reset();


      document.querySelector(
        '#vacancyId'
      ).value =
        payload.vacancy_id;


    } catch (error) {

      console.error(
        'Erro ao enviar candidatura:',
        error
      );


      formMessage.className =
        'form-message error';


      formMessage.textContent =
        'Não foi possível enviar sua candidatura agora. Tente novamente em alguns instantes.';


      formMessage.hidden =
        false;


    } finally {

      button.disabled = !applicationsEnabled || form.dataset.applicationCreated === 'true';


      button.textContent =
        'Enviar candidatura';

    }
  }
);


search.addEventListener(
  'input',
  render
);


locationFilter.addEventListener(
  'change',
  render
);


document
  .querySelector(
    '#closeDialog'
  )
  .addEventListener(
    'click',
    () =>
      dialog.close()
  );


dialog.addEventListener(
  'click',
  event => {

    if (
      event.target ===
      dialog
    ) {
      dialog.close();
    }

  }
);


loadJobs();
