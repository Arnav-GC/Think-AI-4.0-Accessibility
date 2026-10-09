/**
 * OmniAccess AI website: accessibility enhancements for the page itself.
 *  - Feature filter chips (aria-pressed, live count announcement)
 *  - Demo tablist: keeps aria-selected / tabindex in sync and adds arrow-key navigation
 * Loaded after website-demo.js, which owns the tab panel show/hide logic.
 */
(() => {
  'use strict';

  /* ── Feature filter chips ─────────────────────────────────────────────── */
  const chips = Array.from(document.querySelectorAll('.chip[data-filter]'));
  const cards = Array.from(document.querySelectorAll('.fcard[data-cat]'));
  const filterStatus = document.getElementById('filter-status');

  function applyFilter(filter) {
    let shown = 0;
    cards.forEach((card) => {
      const cats = (card.dataset.cat || '').split(/\s+/);
      const match = filter === 'all' || cats.includes(filter);
      card.hidden = !match;
      if (match) shown += 1;
    });
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter)));
    if (filterStatus) {
      filterStatus.textContent = filter === 'all'
        ? `Showing all ${cards.length} features.`
        : `Showing ${shown} of ${cards.length} features for ${filter} needs.`;
    }
  }

  chips.forEach((chip) => chip.addEventListener('click', () => applyFilter(chip.dataset.filter)));

  /* ── Demo tabs: aria state + arrow-key navigation ─────────────────────── */
  const tabs = ['tab-voice', 'tab-sim', 'tab-contrast']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  function syncTabs(active) {
    tabs.forEach((tab) => {
      const on = tab === active;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
  }

  tabs.forEach((tab, index) => {
    // website-demo.js registers its click handler first and toggles the panels.
    tab.addEventListener('click', () => syncTabs(tab));

    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      next.click();
      next.focus();
    });
  });
})();
