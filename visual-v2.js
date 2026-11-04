/* GEX Recruiter · 21st.dev Spotlight (MIT) port + Lucide Animated motion cues.
 * Works with the existing static site and dynamically rendered Recrutei cards.
 */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const grids = [...document.querySelectorAll('.culture-grid, .benefits-grid, .story-stats, .jobs-grid')];
  const spotlightCardSelector = '.feature-card, .benefit-card, .stat-card, .job-card';
  const iconCardSelector = '.feature-card, .benefit-card';
  const iconTimeouts = new WeakMap();
  const pendingFrames = new WeakMap();

  function decorate(root) {
    root.querySelectorAll(spotlightCardSelector).forEach(card => {
      card.dataset.slot = 'spotlight';
    });
  }

  function animateIcon(card) {
    if (reducedMotion.matches) return;
    const oldTimeout = iconTimeouts.get(card);
    if (oldTimeout) window.clearTimeout(oldTimeout);

    // Restart on repeated pointer entry or keyboard focus; it is only decoration.
    card.classList.remove('icon-playing');
    void card.offsetWidth;
    card.classList.add('icon-playing');
    iconTimeouts.set(card, window.setTimeout(() => {
      card.classList.remove('icon-playing');
      iconTimeouts.delete(card);
    }, 1800));
  }

  function trackSpotlight(container, event) {
    if (!finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest('[data-slot="spotlight"]');
    if (!card || !container.contains(card)) return;

    const previous = pendingFrames.get(card);
    if (previous) window.cancelAnimationFrame(previous);
    const x = event.clientX;
    const y = event.clientY;
    const next = window.requestAnimationFrame(() => {
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--spotlight-x', `${x - bounds.left}px`);
      card.style.setProperty('--spotlight-y', `${y - bounds.top}px`);
      pendingFrames.delete(card);
    });
    pendingFrames.set(card, next);
  }

  grids.forEach(container => {
    decorate(container);
    container.addEventListener('pointermove', event => trackSpotlight(container, event), { passive: true });

    container.addEventListener('pointerover', event => {
      if (!finePointer.matches) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(iconCardSelector);
      if (!card || !container.contains(card)) return;
      if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
      animateIcon(card);
    }, { passive: true });

    container.addEventListener('focusin', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest(iconCardSelector);
      if (card && container.contains(card)) animateIcon(card);
    });
  });

  // app.js regenerates job cards every time a filter or live Recrutei result changes.
  const jobsGrid = document.querySelector('#jobsGrid');
  if (jobsGrid && 'MutationObserver' in window) {
    const changes = new MutationObserver(() => decorate(jobsGrid));
    changes.observe(jobsGrid, { childList: true });
  }
})();
