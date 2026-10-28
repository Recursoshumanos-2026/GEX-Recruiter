const CONFIG = window.GEX_TALENTS_CONFIG || {};

let jobs = [];
let applicationsEnabled = false;

const DEFAULT_TITLE = 'GEX Talents | Carreiras';
const DEFAULT_DESCRIPTION =
  'GEX Talents — oportunidades para construir o próximo capítulo com a GEX.';

const grid = document.querySelector('#jobsGrid');
const empty = document.querySelector('#jobsEmpty');
const search = document.querySelector('#jobSearch');
const locationFilter = document.querySelector('#jobLocation');
const statusPill = document.querySelector('#integrationStatus');
const jobsHeading = document.querySelector('.jobs-heading');
const jobsToolbar = document.querySelector('.jobs-toolbar');
const jobsSection = document.querySelector('#vagas');
const talentPool = document.querySelector('.talent-pool');

const dialog = document.querySelector('#applyDialog');
const form = document.querySelector('#applyForm');
const formMessage = document.querySelector('#formMessage');

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
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get('vaga');

  if (queryId && /^\d+$/.test(queryId)) {
    return queryId;
  }

  const oldHash = window.location.hash.match(/^#vaga-(\d+)$/);

  return oldHash ? oldHash[1] : null;
}

function vacancyUrl(id) {
  const url = new URL(
    `${window.location.origin}${window.location.pathname}`
  );

  url.searchParams.set('vaga', id);

  return url.toString();
}

function allJobsUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';

  document.body.appendChild(field);
  field.focus();
  field.select();

  document.execCommand('copy');
  field.remove();
}

async function shareVacancy(id, button) {
  const url = vacancyUrl(id);
  const originalText = button.textContent;

  try {
    await copyText(url);

    button.textContent = 'Link copiado ✓';
    button.classList.add('share-success');

    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('share-success');
    }, 2200);

  } catch (error) {
    console.error('Não foi possível copiar o link:', error);

    window.prompt(
      'Copie o link desta vaga:',
      url
    );
  }
}

function bindJobActions() {
  grid
    .querySelectorAll('[data-apply]')
    .forEach(button => {
      button.addEventListener('click', () => {
        openApply(button.dataset.apply);
      });
    });

  grid
    .querySelectorAll('[data-share]')
    .forEach(button => {
      button.addEventListener('click', () => {
        shareVacancy(
          button.dataset.share,
          button
        );
      });
    });
}

function renderGeneralJobs() {
  jobsSection.classList.remove(
    'specific-vacancy-section'
  );

  grid.classList.remove(
    'jobs-grid--specific'
  );

jobsHeading.style.display = '';
jobsToolbar.style.display = '';

  if (talentPool) {
    talentPool.hidden = false;
  }

  document.title = DEFAULT_TITLE;

  const description = document.querySelector(
    'meta[name="description"]'
  );

  if (description) {
    description.content = DEFAULT_DESCRIPTION;
  }

  statusPill.textContent =
    'Vagas atualizadas';

  const term =
    search.value.toLowerCase().trim();

  const selectedLocation =
    locationFilter.value;

  const filtered = jobs
    .filter(
      job =>
        Number(job.vacancy_status_id) === 1
    )
    .filter(job => {
      if (!term) return true;

      const text = `
        ${job.title || ''}
        ${job.city || ''}
        ${job.state || ''}
        ${job.department || ''}
      `.toLowerCase();

      return text.includes(term);
    })
    .filter(job => {
      if (!selectedLocation) {
        return true;
      }

      const location =
        locationLabel(job) || workMode(job);

      return location === selectedLocation;
    });

  grid.innerHTML = filtered
    .map(job => {
      const location = locationLabel(job);

      return `
        <article
          class="job-card"
          id="vaga-${safe(job.id)}"
        >
          <span class="job-area">
            ${safe(
              job.department ||
              'GEX CORPORATION'
            )}
          </span>

          <h3>
            ${safe(job.title)}
          </h3>

          <div class="job-meta">
            <span>
              ${safe(workMode(job))}
            </span>

            ${
              location
                ? `<span>${safe(location)}</span>`
                : ''
            }
          </div>

          <p>
            Conheça a oportunidade e candidate-se para fazer parte da GEX.
          </p>

          <div class="job-actions">
            <small>
              #${safe(job.id)}
            </small>

            <div class="job-action-buttons">
              <button
                type="button"
                class="job-share-button"
                data-share="${safe(job.id)}"
              >
                Compartilhar
              </button>

              <button
                type="button"
                class="job-apply-button"
                data-apply="${safe(job.id)}"
                ${applicationsEnabled ? '' : 'disabled'}
              >
                ${
                  applicationsEnabled
                    ? 'Quero me candidatar →'
                    : 'Candidatura em breve'
                }
              </button>
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
  const job = jobs.find(
    item =>
      String(item.id) === String(id) &&
      Number(item.vacancy_status_id) === 1
  );

  jobsHeading.style.display = 'none';
jobsToolbar.style.display = 'none';

  jobsSection.classList.add(
    'specific-vacancy-section'
  );

  grid.classList.add(
    'jobs-grid--specific'
  );

  if (talentPool) {
    talentPool.hidden = true;
  }

  if (!job) {
    empty.hidden = false;

    grid.innerHTML = '';

    empty.querySelector('h3').textContent =
      'Esta oportunidade não está mais disponível.';

    empty.querySelector('p').innerHTML =
      `Confira <a href="${safe(allJobsUrl())}">todas as oportunidades abertas</a> na GEX.`;

    return;
  }

  empty.hidden = true;

  document.title =
    `${job.title} | GEX Talents`;

  const description = document.querySelector(
    'meta[name="description"]'
  );

  if (description) {
    description.content =
      `${job.title} — oportunidade na GEX Corporation.`;
  }

  const location = locationLabel(job);

  grid.innerHTML = `
    <article
      class="vacancy-landing"
      id="vaga-${safe(job.id)}"
    >
      <div class="vacancy-landing-top">
        <a
          class="vacancy-back-link"
          href="${safe(allJobsUrl())}"
        >
          ← Todas as oportunidades
        </a>

        <button
          type="button"
          class="vacancy-share-top"
          data-share="${safe(job.id)}"
        >
          Compartilhar vaga
        </button>
      </div>

      <div class="vacancy-landing-content">
        <div class="vacancy-main-content">
          <span class="eyebrow">
            • OPORTUNIDADE NA GEX
          </span>

          <span class="vacancy-department">
            ${safe(
              job.department ||
              'GEX CORPORATION'
            )}
          </span>

          <h2>
            ${safe(job.title)}
          </h2>

          <div class="vacancy-meta-large">
            <span>
              <strong>Modelo</strong>
              ${safe(workMode(job))}
            </span>

            ${
              location
                ? `
                  <span>
                    <strong>Localidade</strong>
                    ${safe(location)}
                  </span>
                `
                : ''
            }

            <span>
              <strong>Oportunidade</strong>
              #${safe(job.id)}
            </span>
          </div>

          <div class="vacancy-about">
            <h3>
              Seu próximo desafio pode começar aqui.
            </h3>

            <p>
              Estamos em busca de pessoas que queiram construir,
              aprender rápido e assumir protagonismo junto com a GEX.
              Se esta oportunidade combina com o seu momento,
              queremos conhecer você.
            </p>
          </div>
        </div>

        <aside class="vacancy-cta-card">
          <span class="vacancy-cta-label">
            FAÇA PARTE DA GEX
          </span>

          <h3>
            Quer se candidatar a esta oportunidade?
          </h3>

          <p>
            Preencha seus dados e envie sua candidatura diretamente
            pelo GEX Talents.
          </p>

          <button
            type="button"
            class="btn btn-primary vacancy-apply-main"
            data-apply="${safe(job.id)}"
            ${applicationsEnabled ? '' : 'disabled'}
          >
            ${
              applicationsEnabled
                ? 'Quero me candidatar'
                : 'Candidatura em breve'
            }

          <small>
            O processo seletivo é conduzido pelo time de People da GEX Corporation.
          </small>
        </aside>
      </div>
    </article>
  `;

  bindJobActions();
}

function render() {
  const vacancyId =
    specificVacancyId();

  if (vacancyId) {
    renderSpecificVacancy(vacancyId);
    return;
  }

  renderGeneralJobs();
}

function populateLocations() {
  const locations = [
    ...new Set(
      jobs
        .map(job =>
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
    const response = await fetch(
      `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/health`
    );

    if (!response.ok) {
      applicationsEnabled = false;
      return;
    }

    const body =
      await response.json();

    applicationsEnabled =
      Boolean(
        body.applications_enabled
      );

  } catch (error) {
    applicationsEnabled = false;
  }
}

async function loadJobs() {
  try {
    await readBackendStatus();

    const response = await fetch(
      `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/vagas`
    );

    if (!response.ok) {
      throw new Error(
        'Falha ao carregar vagas'
      );
    }

    const body =
      await response.json();

    jobs = body.data || [];

  } catch (error) {
    jobs = [];

    statusPill.textContent =
      'Não foi possível carregar as vagas agora';
  }

  populateLocations();
  render();
}

function openApply(id) {
  const job = jobs.find(
    item =>
      String(item.id) === String(id)
  );

  if (
    !job ||
    !applicationsEnabled
  ) {
    return;
  }

  form.reset();

  formMessage.hidden = true;
  formMessage.textContent = '';

  document.querySelector(
    '#applyJobTitle'
  ).textContent = job.title;

  document.querySelector(
    '#vacancyId'
  ).value = job.id;

  dialog.showModal();
}

function normalizeFormPayload() {
  const formData =
    new FormData(form);

  const payload =
    Object.fromEntries(
      formData.entries()
    );

  delete payload.privacy;

  return payload;
}

form.addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    formMessage.hidden = true;

    if (!form.reportValidity()) {
      return;
    }

    if (!applicationsEnabled) {
      formMessage.className =
        'form-message error';

      formMessage.textContent =
        'As candidaturas online não estão disponíveis neste momento.';

      formMessage.hidden = false;

      return;
    }

    const payload =
      normalizeFormPayload();

    const button =
      form.querySelector(
        '.submit-btn'
      );

    button.disabled = true;
    button.textContent =
      'Enviando candidatura...';

    try {
      const response = await fetch(
        `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/candidatar`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const body =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          body.message ||
          'Não foi possível enviar sua candidatura.'
        );
      }

      formMessage.className =
        'form-message success';

      formMessage.textContent =
        'Candidatura enviada com sucesso! Seus dados foram recebidos pela GEX.';

      formMessage.hidden = false;

      if (
        body.profile_completed === false
      ) {
        console.warn(
          'Candidatura criada, mas houve uma pendência na atualização dos dados complementares.',
          body.profile_warning || ''
        );
      }

      if (
        body.tag_completed === false
      ) {
        console.warn(
          'Candidatura criada, mas a tag GEX Talents não foi adicionada.',
          body.tag_warning || ''
        );
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

      formMessage.hidden = false;

    } finally {
      button.disabled = false;
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
  .querySelector('#closeDialog')
  .addEventListener(
    'click',
    () => dialog.close()
  );

dialog.addEventListener(
  'click',
  event => {
    if (event.target === dialog) {
      dialog.close();
    }
  }
);

loadJobs();
