const CONFIG = window.GEX_TALENTS_CONFIG || {};

let jobs = [];
let applicationsEnabled = false;

const grid = document.querySelector('#jobsGrid');
const empty = document.querySelector('#jobsEmpty');
const search = document.querySelector('#jobSearch');
const locationFilter = document.querySelector('#jobLocation');
const statusPill = document.querySelector('#integrationStatus');

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
    : workMode(job);
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

function render() {
  const term = search.value.toLowerCase().trim();
  const location = locationFilter.value;

  const filtered = jobs
    .filter(job => Number(job.vacancy_status_id) === 1)
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
      if (!location) return true;
      return locationLabel(job) === location;
    });

  grid.innerHTML = filtered
    .map(
      job => `
        <article
          class="job-card"
          id="vaga-${safe(job.id)}"
        >
          <span class="job-area">
            ${safe(job.department || 'GEX CORPORATION')}
          </span>

          <h3>${safe(job.title)}</h3>

          <p>
            Conheça a oportunidade e candidate-se para fazer parte da GEX.
          </p>

          <div class="job-actions">
            <small>#${safe(job.id)}</small>

            <button
              data-apply="${safe(job.id)}"
              ${applicationsEnabled ? '' : 'disabled'}
              aria-disabled="${applicationsEnabled ? 'false' : 'true'}"
            >
              ${
                applicationsEnabled
                  ? 'Quero me candidatar →'
                  : 'Candidatura em breve'
              }
            </button>
          </div>
        </article>
      `
    )
    .join('');

  empty.hidden = filtered.length > 0;

  if (applicationsEnabled) {
    grid
      .querySelectorAll('[data-apply]')
      .forEach(button => {
        button.addEventListener('click', () => {
          openApply(button.dataset.apply);
        });
      });
  }

  focusHashJob();
}

function populateLocations() {
  const locations = [
    ...new Set(
      jobs
        .map(locationLabel)
        .filter(Boolean)
    )
  ].sort();

  locationFilter.innerHTML =
    '<option value="">Todas as localidades</option>' +
    locations
      .map(
        location =>
          `<option value="${safe(location)}">${safe(location)}</option>`
      )
      .join('');
}

function focusHashJob() {
  const match = location.hash.match(/^#vaga-(\d+)$/);

  if (!match) return;

  const card = document.getElementById(
    `vaga-${match[1]}`
  );

  if (card) {
    setTimeout(() => {
      card.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 100);
  }
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

    const body = await response.json();

    applicationsEnabled =
      Boolean(body.applications_enabled);

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

    const body = await response.json();

    jobs = body.data || [];

    statusPill.textContent =
      'Vagas atualizadas';

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
    item => String(item.id) === String(id)
  );

  if (!job || !applicationsEnabled) {
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
  const formData = new FormData(form);

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

          body: JSON.stringify(
            payload
          )
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

      /*
       * A candidatura já foi criada na Recrutei.
       * Se algum dado complementar não tiver sido
       * atualizado, não mostramos erro para o candidato,
       * evitando que ele tente novamente e gere duplicidade.
       */
      if (
        body.profile_completed === false
      ) {
        console.warn(
          'Candidatura criada, mas houve uma pendência na atualização dos dados complementares.',
          body.profile_warning || ''
        );
      }

      form.reset();

      document.querySelector(
        '#vacancyId'
      ).value = payload.vacancy_id;

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

window.addEventListener(
  'hashchange',
  focusHashJob
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
