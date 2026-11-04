import { questionnaireFor, validateAnswers } from './questionnaires.js?v=5';

const CONFIG = window.GEX_TALENTS_CONFIG || {};
// A shareable presentation preview: all file and form interactions stay local.
// The regular site keeps its existing real application flow unchanged.
const PRESENTATION_PREVIEW = new URLSearchParams(window.location.search).get('demo') === '1';

let jobs = [];
let jobsLoadFailed = false;
let demoFallbackActive = false;
let applicationsEnabled = false;
let resumeUploadEnabled = false;
const resumeSection = document.querySelector('#resumeUploadSection');
const resumeInput = document.querySelector('#resumeFile');
function syncResumeInput() {
  if (!resumeSection || !resumeInput) return;
  const visible = resumeUploadEnabled || PRESENTATION_PREVIEW;
  resumeSection.hidden = !visible;
  resumeInput.disabled = !visible;
  resumeInput.required = resumeUploadEnabled && !PRESENTATION_PREVIEW;
  if (PRESENTATION_PREVIEW) {
    resumeSection.classList.add('resume-demo-mode');
    const hint = resumeSection.querySelector('.resume-upload-hint');
    if (hint) hint.textContent = 'Demonstração: selecione um PDF ou DOCX de até 5 MB. O arquivo não será enviado nem armazenado.';
  }
}


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

const headerActions = document.querySelector('#vacancyHeaderActions');
const headerBack = document.querySelector('#vacancyHeaderBack');
const headerShare = document.querySelector('#vacancyHeaderShare');

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
  if (PRESENTATION_PREVIEW) url.searchParams.set('demo', '1');

  return url.toString();
}


function allJobsUrl() {
  const url = new URL(`${window.location.origin}${window.location.pathname}`);
  if (PRESENTATION_PREVIEW) url.searchParams.set('demo', '1');
  return url.toString();
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

  // The public Recrutei JD may repeat our institutional Story/Culture and
  // benefits. Keep the vacancy-specific text, but show institutional sections
  // only once in their dedicated areas of GEX Talents.
  let skipThroughLevel = null;
  for (const child of [...container.childNodes]) {
    const heading = child.nodeType === Node.ELEMENT_NODE &&
      /^H[234]$/.test(child.tagName);
    if (heading) {
      const level = Number(child.tagName[1]);
      if (skipThroughLevel !== null && level <= skipThroughLevel) {
        skipThroughLevel = null;
      }
      const normalized = child.textContent.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^(nosso jeito de ser gex|aqui nossos gexs encontram|beneficios|beneficios da gex|nossos beneficios)$/.test(normalized)) {
        skipThroughLevel = level;
      }
    }
    if (skipThroughLevel !== null) child.remove();
  }
  // Reformat the source description into readable editorial chapters.
  // Keep every sanitized item; long lists remain available via an accessible
  // native details/summary control instead of creating a huge wall of bullets.
  const contentNodes = [...container.childNodes].filter(node =>
    node.nodeType === Node.ELEMENT_NODE && node.textContent.trim()
  );
  const chapters = [];
  let chapter = null;

  const isParagraphHeading = (node, next) => {
    if (node.tagName !== 'P' || !node.querySelector('strong,b')) return false;
    const title = node.textContent.trim();
    if (!title || title.length > 105) return false;
    const onlyEmphasis = [...node.childNodes].every(child =>
      (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) ||
      (child.nodeType === Node.ELEMENT_NODE && ['STRONG', 'B'].includes(child.tagName))
    );
    return onlyEmphasis && (
      /^(o que esperamos de voce|comportamentos e habilidades esperados|se ainda tiver tudo isso)/i.test(
        title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      ) || ['UL', 'OL'].includes(next?.tagName)
    );
  };

  contentNodes.forEach((node, index) => {
    const heading = /^H[234]$/.test(node.tagName) ||
      isParagraphHeading(node, contentNodes[index + 1]);
    if (heading) {
      chapter = { title: node.textContent.trim(), nodes: [] };
      chapters.push(chapter);
    } else {
      if (!chapter) {
        chapter = { title: 'Sobre a oportunidade', nodes: [] };
        chapters.push(chapter);
      }
      chapter.nodes.push(node);
    }
  });

  if (!chapters.length) return container.innerHTML.trim();
  const article = document.createElement('div');
  article.className = 'jd-article';
  const total = chapters.length;

  chapters.forEach((group, index) => {
    if (!group.nodes.length) return;
    const section = document.createElement('section');
    const isIntro = /^(sobre a vaga|sobre a oportunidade)$/i.test(
      group.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    );
    section.className = 'jd-chapter' + (isIntro ? ' jd-chapter--intro' : '');
    const heading = document.createElement('div');
    heading.className = 'jd-chapter-heading';
    const kicker = document.createElement('span');
    kicker.className = 'jd-chapter-index';
    kicker.textContent = String(index + 1).padStart(2, '0') +
      ' / ' + String(total).padStart(2, '0');
    const title = document.createElement('h3');
    title.id = 'jd-section-' + index;
    title.className = 'jd-chapter-title';
    title.textContent = group.title.replace(/^[✨⭐★🌟]\uFE0F?\s*/u, '');
    section.setAttribute('aria-labelledby', title.id);
    heading.append(kicker, title);

    const body = document.createElement('div');
    body.className = 'jd-chapter-body';

    const isAgreementSection = /^como sera nosso combinado$/i.test(
      group.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    );
    let hasFlexibleSchedule = false;
    const scheduleText = 'Aqui na GEX, valorizamos autonomia com responsabilidade. Você tem flexibilidade para organizar seus horários, sempre com foco em resultado e alinhamento com o time.';

    for (const item of group.nodes) {
      if (isAgreementSection && item.tagName === 'P') {
        // ATS combines contract, workplace and hours into a single paragraph
        // separated by <br>. Preserve contract/workplace while removing only
        // the old schedule line (including the clock), when it says "flexível".
        const lines = [[]];
        for (const part of [...item.childNodes]) {
          if (part.nodeType === Node.ELEMENT_NODE && part.tagName === 'BR') {
            lines.push([]);
          } else {
            lines[lines.length - 1].push(part);
          }
        }
        const hasFlexibleLine = lines.some(parts => {
          const sample = document.createElement('span');
          parts.forEach(part => sample.appendChild(part.cloneNode(true)));
          const text = sample.textContent.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').toLowerCase();
          return /horario/.test(text) && /flexivel/.test(text);
        });
        if (hasFlexibleLine) {
          hasFlexibleSchedule = true;
          for (const parts of lines) {
            const line = document.createElement('p');
            line.className = 'jd-agreement-line';
            for (const part of parts) line.appendChild(part.cloneNode(true));
            const label = line.textContent.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '').toLowerCase();
            if (label.includes('horario') && label.includes('flexivel')) continue;
            if (line.textContent.trim()) body.appendChild(line);
          }
          continue;
        }
      }
      if (item.tagName === 'UL' || item.tagName === 'OL') {
        item.classList.add('jd-list');
        const entries = [...item.children].filter(child => child.tagName === 'LI');
        if (entries.length > 8) {
          const visibleCount = 4;
          const remaining = entries.slice(visibleCount);
          const extra = document.createElement(item.tagName.toLowerCase());
          extra.className = 'jd-list jd-list--extra';
          remaining.forEach(entry => extra.appendChild(entry));
          body.appendChild(item);

          const details = document.createElement('details');
          details.className = 'jd-more';
          const summary = document.createElement('summary');
          summary.className = 'jd-more-toggle';
          const expand = document.createElement('span');
          expand.className = 'jd-expand-label';
          expand.textContent = 'Ver mais ' + remaining.length + ' itens';
          const collapse = document.createElement('span');
          collapse.className = 'jd-collapse-label';
          collapse.textContent = 'Mostrar menos';
          summary.append(expand, collapse);
          details.append(summary, extra);
          body.appendChild(details);
          continue;
        }
      }
      body.appendChild(item);
    }

    if (hasFlexibleSchedule) {
      const callout = document.createElement('aside');
      callout.className = 'jd-flex-schedule';
      callout.setAttribute('aria-label', 'Horário flexível');
      const eyebrow = document.createElement('span');
      eyebrow.className = 'jd-flex-schedule-eyebrow';
      eyebrow.textContent = 'HORÁRIO FLEXÍVEL';
      const title = document.createElement('h4');
      title.textContent = 'Flexibilidade para sua rotina';
      const description = document.createElement('p');
      description.textContent = scheduleText;
      callout.append(eyebrow, title, description);
      body.appendChild(callout);
    }

    section.append(heading, body);
    article.appendChild(section);
  });
  return article.outerHTML.trim();
}


function vacancyBenefitsMarkup() {
  // Benefit copy and iconography stay synced with the existing institutional homepage.
  const cards = [...document.querySelectorAll('#beneficios .benefits-grid .benefit-card')];
  if (!cards.length) return '';

  const entries = cards.map((card) => {
    const title = card.querySelector('strong')?.textContent.trim();
    const description = card.querySelector('span')?.textContent.trim();
    const icon = card.querySelector('svg.gex-animated-icon')?.outerHTML || '';
    if (!title) return '';
    return `
      <li class="vacancy-benefit-row">
        <span class="vacancy-benefit-icon" aria-hidden="true">${icon}</span>
        <div class="vacancy-benefit-copy">
          <h3>${safe(title)}</h3>
          <p>${safe(description || '')}</p>
        </div>
      </li>`;
  }).join('');

  return `
    <section class="vacancy-benefits" aria-labelledby="vacancyBenefitsTitle">
      <div class="vacancy-benefits-layout">
        <div class="vacancy-benefits-intro">
          <span class="vacancy-benefits-eyebrow">BENEFÍCIOS NA GEX</span>
          <h2 id="vacancyBenefitsTitle">Benefícios que fazem <span>a diferença.</span></h2>
          <p>Mais bem-estar, saúde, equilíbrio e reconhecimento para você viver o seu melhor, dentro e fora do trabalho.</p>
        </div>
        <ul class="vacancy-benefits-list" aria-label="Benefícios disponíveis na GEX">
          ${entries}
        </ul>
      </div>
    </section>`;
}

function vacancyApplyButton(id, extraClass = '') {
  return `<button type="button" class="btn btn-primary ${extraClass}" data-apply="${safe(id)}"
    ${applicationsEnabled ? '' : 'disabled'}>${applicationsEnabled ? 'Quero me candidatar →' : 'Candidatura em breve'}</button>`;
}

function renderGeneralJobs() {
  document.documentElement.classList.remove('vacancy-route-loading');
  document.body.classList.remove("vacancy-detail-mode");
  if (headerActions) headerActions.hidden = true;

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


  statusPill.textContent = jobsLoadFailed
    ? 'Não foi possível atualizar as vagas'
    : demoFallbackActive
      ? 'Prévia ilustrativa · sem envio de dados'
      : 'Vagas atualizadas';


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


  empty.hidden = filtered.length > 0 && !jobsLoadFailed;
  const emptyTitle = empty.querySelector('h3');
  const emptyMessage = empty.querySelector('p');
  empty.querySelector('[data-retry-jobs]')?.remove();
  if (jobsLoadFailed) {
    emptyTitle.textContent = 'Não foi possível carregar as oportunidades.';
    emptyMessage.textContent = 'Estamos com uma instabilidade temporária na conexão com a Recrutei. Tente novamente em instantes.';
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn';
    retryButton.dataset.retryJobs = '';
    retryButton.textContent = 'Tentar novamente';
    retryButton.addEventListener('click', loadJobs);
    empty.append(retryButton);
  } else {
    emptyTitle.textContent = 'Nenhuma vaga encontrada.';
    emptyMessage.textContent = 'Tente outro termo de busca ou volte em breve para conferir novas oportunidades.';
  }

  bindJobActions();
}


function renderSpecificVacancy(id) {
  document.body.classList.add('vacancy-detail-mode');
  document.documentElement.classList.remove('vacancy-route-loading');
  if (headerActions) headerActions.hidden = false;
  if (headerBack) headerBack.href = allJobsUrl() + '#vagas';
  if (main) main.prepend(jobsSection);
  jobsHeading.style.display = 'none';
  jobsToolbar.style.display = 'none';
  jobsSection.classList.add('specific-vacancy-section');
  grid.classList.add('jobs-grid--specific');
  if (talentPool) talentPool.hidden = true;

  const job = jobs.find(item => String(item.id) === String(id) &&
    Number(item.vacancy_status_id) === 1);
  if (!job) {
    if (headerShare) headerShare.hidden = true;
    empty.hidden = false;
    grid.innerHTML = '';
    empty.querySelector('[data-retry-jobs]')?.remove();
    if (jobsLoadFailed) {
      empty.querySelector('h3').textContent = 'Não conseguimos consultar esta oportunidade agora.';
      empty.querySelector('p').textContent = 'A conexão com a Recrutei está temporariamente indisponível. Tente novamente para verificar os detalhes.';
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'btn';
      retryButton.dataset.retryJobs = '';
      retryButton.textContent = 'Tentar novamente';
      retryButton.addEventListener('click', loadJobs);
      empty.append(retryButton);
    } else {
      empty.querySelector('h3').textContent = 'Esta oportunidade não está mais disponível.';
      empty.querySelector('p').innerHTML = `Confira <a href="${safe(allJobsUrl())}">todas as oportunidades abertas</a> na GEX.`;
    }
    return;
  }
  empty.hidden = true;
  if (headerShare) {
    headerShare.hidden = false;
    headerShare.onclick = () => shareVacancy(job.id, headerShare);
  }
  document.title = `${job.title} | GEX Recruiter`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = `${job.title} — oportunidade na GEX Corporation.`;

  const description = safeJobDescription(job.description);
  const location = locationLabel(job);
  // Contract model must only be displayed when actually supplied by the ATS.
  const contract = typeof job.contract_model === 'string' ? job.contract_model : '';
  grid.innerHTML = `
    <article class="vacancy-landing" id="vaga-${safe(job.id)}">
      <div class="vacancy-landing-content vacancy-landing-content--single">
        <div class="vacancy-main-content vacancy-main-content--wide">

          <header class="vacancy-hero">
            <div class="vacancy-hero-inner">
              <div class="vacancy-hero-copy">
                <span class="vacancy-hero-overline"><span class="vacancy-hero-status-dot" aria-hidden="true"></span> OPORTUNIDADE ABERTA • GEX CORPORATION</span>
                <span class="vacancy-department">${safe(job.department || 'GEX CORPORATION')}</span>
                <h1 class="vacancy-title">${safe(job.title)}</h1>
                <p class="vacancy-hero-lead">Conheça os desafios, requisitos e benefícios para descobrir se esta oportunidade combina com você.</p>
                <div class="vacancy-meta-large">
                  <span><strong>Modalidade</strong>${safe(workMode(job))}</span>
                  ${location ? `<span><strong>Localidade</strong>${safe(location)}</span>` : ''}
                  ${contract ? `<span><strong>Contratação</strong>${safe(contract)}</span>` : ''}
                  <span><strong>Vaga</strong>#${safe(job.id)}</span>
                </div>
                <div class="vacancy-top-apply">
                  ${vacancyApplyButton(job.id, 'vacancy-apply-main')}
                  <a class="btn vacancy-discover-link" href="#descricao-vaga">
                    Conheça a oportunidade
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="m5 13 7 7 7-7"/></svg>
                  </a>
                </div>
              </div>
              <div class="vacancy-hero-art" aria-hidden="true">
                <div class="vacancy-hero-orbit orbit-one"></div>
                <div class="vacancy-hero-orbit orbit-two"></div>
                <img class="vacancy-hero-symbol" src="assets/gex-simbolo.png" alt="" />
                <span class="vacancy-hero-art-label"><img class="vacancy-hero-wordmark" src="assets/gex-wordmark-branco.svg" alt="" /><span>RECRUITER</span></span>
                <span class="vacancy-hero-art-caption">DESAFIOS QUE MOVEM O FUTURO.</span>
              </div>
            </div>
          </header>

          <section class="vacancy-description" id="descricao-vaga" aria-label="Descrição da vaga">
            <span class="jd-overline">CONHEÇA A OPORTUNIDADE</span>
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
  // Navigating from a card must always start at the top of the detail page,
  // not at the previous listing scroll position.
  window.scrollTo({ top: 0, behavior: 'instant' });
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

            resumeUploadEnabled = false;
      syncResumeInput();
return;
    }


    const body =
      await response.json();


    applicationsEnabled =
      PRESENTATION_PREVIEW || Boolean(
        body.applications_enabled
      );
    resumeUploadEnabled = !PRESENTATION_PREVIEW && applicationsEnabled &&
      body.resume_upload_enabled === true;
    syncResumeInput();


  } catch (error) {

    applicationsEnabled =
      PRESENTATION_PREVIEW;

        resumeUploadEnabled = false;
      syncResumeInput();
}
}


async function loadJobs() {
  jobsLoadFailed = false;
  demoFallbackActive = false;
  statusPill.textContent = 'Atualizando vagas...';

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
    jobsLoadFailed = false;

    // Only the opened vacancy needs a full public job description.
    const requestedId = specificVacancyId();
    if (requestedId && jobs.some(item => String(item.id) === String(requestedId))) {
      try {
        const detailsResponse = await fetch(
          `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/vagas/${encodeURIComponent(requestedId)}`
        );
        if (detailsResponse.ok) {
          const detail = (await detailsResponse.json()).data;
          if (detail && String(detail.id) === String(requestedId)) {
            jobs = jobs.map(item => String(item.id) === String(requestedId)
              ? { ...item, ...detail } : item);
          }
        } else if (detailsResponse.status === 404) {
          jobs = jobs.filter(item => String(item.id) !== String(requestedId));
        }
      } catch (_) {
        // Keep listing and neutral description fallback when the detail service fails.
      }
    }

  } catch (error) {

    jobs = [];
    jobsLoadFailed = true;
    if (PRESENTATION_PREVIEW) {
      // Keep the requested presentation usable even when ATS credentials fail.
      // No vacancy data is invented for the real public career portal.
      jobs = [{
        id: 158928,
        title: 'Analista de Atendimento — Demonstração',
        department: 'Atendimento',
        city: null,
        state: null,
        remote: 1,
        vacancy_status_id: 1,
        description: "<h2>Sobre a vaga</h2><p>O time de Atendimento da GEX é responsável por garantir uma experiência positiva aos nossos clientes, atuando de forma próxima, ágil e resolutiva em cada contato.</p><p>Como Analista de Atendimento ao Cliente, sua missão será atender e acompanhar as demandas dos clientes, esclarecer dúvidas, solucionar problemas e contribuir para a retenção e satisfação da nossa base.</p><h2>Como será o seu dia a dia</h2><ul><li>Realizar atendimento aos clientes por meio dos canais disponibilizados pela operação.</li><li>Esclarecer dúvidas e orientar os clientes sobre produtos, processos e demais solicitações.</li><li>Identificar necessidades e buscar soluções de forma ágil e eficiente.</li><li>Acompanhar as demandas até a resolução, garantindo que o cliente receba o devido retorno.</li><li>Atuar na retenção de clientes, buscando compreender os motivos de insatisfação e apresentar alternativas quando aplicável.</li><li>Identificar oportunidades de oferta de outros produtos de acordo com o perfil e a necessidade do cliente.</li><li>Registrar corretamente os atendimentos e manter as informações atualizadas nos sistemas utilizados pela operação.</li><li>Seguir os processos, orientações e padrões de qualidade estabelecidos pela área.</li><li>Contribuir para uma experiência positiva e para o alcance dos resultados da operação.</li></ul><h2>O que esperamos de você</h2><ul><li>Experiência com atendimento ao cliente, Customer Service, retenção ou áreas relacionadas.</li><li>Excelente comunicação verbal e escrita.</li><li>Perfil empático, paciente e resolutivo.</li><li>Facilidade para lidar com clientes insatisfeitos e situações de objeção.</li><li>Organização e responsabilidade com os acompanhamentos.</li><li>Agilidade para lidar com diferentes demandas ao longo do dia.</li><li>Facilidade para trabalhar com sistemas e ferramentas digitais.</li><li>Foco em qualidade de atendimento e resultados.</li><li>Autonomia e comprometimento com a rotina de trabalho.</li></ul><h2>Diferenciais que vão te destacar</h2><ul><li>Experiência anterior com retenção de clientes.</li><li>Vivência em operações de atendimento remoto ou digital.</li><li>Experiência com metas e indicadores de atendimento.</li><li>Conhecimento em ferramentas de CRM.</li><li>Experiência com vendas ou oferta de produtos durante o atendimento.</li><li>Inglês será considerado um diferencial, principalmente para operações com clientes internacionais.</li></ul><h2>Como será nosso combinado</h2><ul><li>Tipo de contratação: PJ.</li><li>Modelo de trabalho: 100% remoto.</li><li>Horário: flexível.</li></ul>"
      }];
      jobsLoadFailed = false;
      demoFallbackActive = true;
    }

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

  if (PRESENTATION_PREVIEW) {
    form.querySelector('.submit-btn').textContent = 'Simular candidatura';
    form.querySelector('.submit-btn').disabled = false;
    form.noValidate = true;
    const box = document.querySelector('#demoPreviewNotice');
    if (box) box.hidden = false;
  }
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
  delete payload.resume; // Binary file will be sent in multipart.

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

    if (PRESENTATION_PREVIEW) {
      formMessage.hidden = false;
      formMessage.className = 'form-message success';
      formMessage.textContent =
        'Prévia concluída! Este é um teste visual: nenhum dado, candidatura ou currículo foi enviado à Recrutei ou à Cloudflare.';
      return;
    }

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
    const resumeFile = resumeUploadEnabled ? resumeInput?.files?.[0] : null;
    if (resumeFile && (resumeFile.size > 5 * 1024 * 1024 || !/\.(pdf|docx)$/i.test(resumeFile.name))) {
      formMessage.className = 'form-message error';
      formMessage.textContent = 'Selecione um currículo PDF ou DOCX de até 5 MB.';
      formMessage.hidden = false;
      return;
    }


    const button =
      form.querySelector(
        '.submit-btn'
      );


    button.disabled =
      true;


    button.textContent =
      'Enviando candidatura...';


    try {

      const requestData = resumeFile ? new FormData() : null;
      if (requestData) {
        for (const [key, value] of Object.entries(payload)) {
          requestData.set(key,
            key === 'questionnaire_answers' ? JSON.stringify(value) : String(value));
        }
        requestData.set('resume', resumeFile, resumeFile.name);
      }
      const response = await fetch(
        `${CONFIG.API_BASE_URL.replace(/\/$/, '')}/api/candidatar`,
        {
          method: 'POST',
          ...(requestData ? {} : { headers: { 'Content-Type': 'application/json' } }),
          body: requestData || JSON.stringify(payload)
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


      form.dataset.applicationCreated = 'true';

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


      if (resumeFile && body.resume_completed !== true) {
        formMessage.className = 'form-message error';
        formMessage.textContent = 'Sua candidatura foi criada, mas não foi possível confirmar o armazenamento ou o registro do currículo. Não reenvie sua candidatura: entre em contato com o RH da GEX.';
        return;
      }
      if (resumeFile && body.resume_observation_completed && !body.resume_custom_field_completed) {
        formMessage.textContent = 'Candidatura enviada! Seu currículo foi registrado para análise do RH da GEX.';
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


if (PRESENTATION_PREVIEW) {
  document.body.classList.add('presentation-preview');
  const notice=document.createElement('div');
  notice.className='presentation-preview-banner';
  notice.setAttribute('role','status');
  notice.textContent='PRÉVIA PARA APRESENTAÇÃO · Formulário e upload demonstrativos, sem envio de dados';
  document.querySelector('.site-header')?.after(notice);
  resumeInput?.addEventListener('change',()=>{
    const hint=resumeSection?.querySelector('.resume-upload-hint');
    const file=resumeInput.files?.[0];
    if(hint) hint.textContent=file
      ? `Arquivo selecionado: ${file.name}. Apenas demonstração — nenhum currículo foi enviado.`
      : 'Demonstração: selecione um PDF ou DOCX de até 5 MB. O arquivo não será enviado nem armazenado.';
  });
}

loadJobs();
