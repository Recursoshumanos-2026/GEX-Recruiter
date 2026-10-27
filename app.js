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
  return Number(job.remote) === 1 ? 'Remoto' :
         Number(job.remote) === 3 ? 'Híbrido' :
         Number(job.remote) === 2 ? 'Presencial ou remoto' : 'Presencial';
}

function locationLabel(job) {
  return job.city ? `${job.city}${job.state ? `, ${job.state}` : ''}` : workMode(job);
}

function safe(v = '') {
  return String(v).replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));
}

function render() {
  const term = search.value.toLowerCase().trim();
  const loc = locationFilter.value;

  const filtered = jobs
    .filter(j => Number(j.vacancy_status_id) === 1)
    .filter(j => !term || `${j.title} ${j.city || ''} ${j.state || ''} ${j.department || ''}`.toLowerCase().includes(term))
    .filter(j => !loc || locationLabel(j) === loc);

  grid.innerHTML = filtered.map(job => `
    <article class="job-card" id="vaga-${safe(job.id)}">
      <span class="job-area">${safe(job.department || 'GEX CORPORATION')}</span>
      <h3>${safe(job.title)}</h3>

      <p>Conheça a oportunidade e candidate-se para fazer parte da GEX.</p>

      <div class="job-actions">
        <small>#${safe(job.id)}</small>
        <button
          data-apply="${safe(job.id)}"
          ${applicationsEnabled ? '' : 'disabled'}
          aria-disabled="${applicationsEnabled ? 'false' : 'true'}"
        >
          ${applicationsEnabled ? 'Quero me candidatar →' : 'Candidatura em breve'}
        </button>
      </div>
    </article>
  `).join('');

  empty.hidden = filtered.length > 0;

  if (applicationsEnabled) {
    grid.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', () => openApply(btn.dataset.apply));
    });
  }

  focusHashJob();
}

function populateLocations() {
  const locations = [...new Set(jobs.map(locationLabel))].sort();
  locationFilter.innerHTML =
    '<option value="">Todas as localidades</option>' +
    locations.map(x => `<option>${safe(x)}</option>`).join('');
}

function focusHashJob() {
  const match = location.hash.match(/^#vaga-(\d+)$/);
  if (!match) return;

  const card = document.getElementById(`vaga-${match[1]}`);
  if (card) {
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}

async function readBackendStatus() {
  try {
    const res = await fetch(`${CONFIG.API_BASE_URL.replace(/\/$/, '')}/health`);
    if (!res.ok) return;
    const body = await res.json();
    applicationsEnabled = Boolean(body.applications_enabled);
  } catch (_) {
    applicationsEnabled = false;
  }
}

async function loadJobs() {
  try {
    await readBackendStatus();

    const res = await fetch(`${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/vagas`);
    if (!res.ok) throw new Error('Falha ao carregar vagas');

    const body = await res.json();
    jobs = body.data || [];
    statusPill.textContent = 'Vagas atualizadas';
  } catch (e) {
    jobs = [];
    statusPill.textContent = 'Não foi possível carregar as vagas agora';
  }

  populateLocations();
  render();
}

function openApply(id) {
  const job = jobs.find(j => String(j.id) === String(id));
  if (!job || !applicationsEnabled) return;

  form.reset();
  formMessage.hidden = true;
  document.querySelector('#applyJobTitle').textContent = job.title;
  document.querySelector('#vacancyId').value = job.id;
  dialog.showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMessage.hidden = true;

  if (!applicationsEnabled) {
    formMessage.className = 'form-message error';
    formMessage.textContent = 'As candidaturas online serão liberadas em breve.';
    formMessage.hidden = false;
    return;
  }

  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.privacy;

  const button = form.querySelector('.submit-btn');
  button.disabled = true;
  button.textContent = 'Enviando...';

  try {
    const res = await fetch(
      `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/candidatar`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'Não foi possível enviar sua candidatura.');

    formMessage.className = 'form-message success';
    formMessage.textContent = 'Candidatura enviada com sucesso!';
    formMessage.hidden = false;
    form.reset();
  } catch (err) {
    formMessage.className = 'form-message error';
    formMessage.textContent = 'Não foi possível enviar sua candidatura agora. Tente novamente em alguns instantes.';
    formMessage.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar candidatura';
  }
});

search.addEventListener('input', render);
locationFilter.addEventListener('change', render);
window.addEventListener('hashchange', focusHashJob);
document.querySelector('#closeDialog').addEventListener('click', () => dialog.close());

loadJobs();
