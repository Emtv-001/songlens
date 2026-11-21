// Site-wide helpers for long pages: a "Back to top" button and, where a page has several
// sections, a "Jump to" menu built from its headings. Nothing to configure per page: it
// finds the section headings (h2.section-title) and the editor panel by itself.
(() => {
  if (document.querySelector('.page-nav')) return;

  const style = document.createElement('style');
  style.textContent = `
    .page-nav { position: fixed; right: 1rem; bottom: 1.25rem; z-index: 20; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; }
    .page-nav-row { display: flex; gap: 0.5rem; }
    .page-nav button { font: inherit; font-size: 0.9rem; padding: 0.5rem 0.85rem; border-radius: 999px; cursor: pointer; border: 1px solid var(--teal, #46b9b0); background: var(--midnight, #10172a); color: var(--ivory, #f7f4ec); box-shadow: var(--shadow, none); }
    .page-nav button:hover, .page-nav button:focus-visible { background: var(--surface, #19233d); }
    .page-nav-menu { margin: 0; padding: 0.4rem; list-style: none; max-height: 60vh; overflow-y: auto; min-width: 12rem; border-radius: 12px; background: var(--surface, #19233d); border: 1px solid var(--border, #333333); box-shadow: var(--shadow, none); }
    .page-nav-menu button { display: block; width: 100%; text-align: left; border: 0; border-radius: 8px; box-shadow: none; background: transparent; }
    .page-nav-menu button:hover, .page-nav-menu button:focus-visible { background: var(--indigo, #6d28d9); color: var(--on-primary, #ffffff); }
    .page-nav [hidden] { display: none; }
    main h2.section-title, .editor-panel > summary { scroll-margin-top: 1rem; }
  `;
  document.head.appendChild(style);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = reduceMotion ? 'auto' : 'smooth';

  const nav = document.createElement('div');
  nav.className = 'page-nav';
  const menu = document.createElement('ul');
  menu.className = 'page-nav-menu';
  menu.hidden = true;
  const row = document.createElement('div');
  row.className = 'page-nav-row';
  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.textContent = 'Jump to…';
  jumpBtn.setAttribute('aria-haspopup', 'true');
  jumpBtn.setAttribute('aria-expanded', 'false');
  jumpBtn.hidden = true;
  const topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.textContent = '↑ Top';
  topBtn.setAttribute('aria-label', 'Back to the top of the page');
  topBtn.hidden = true;
  row.append(jumpBtn, topBtn);
  nav.append(menu, row);
  document.body.appendChild(nav);

  function targets() {
    const found = [];
    document.querySelectorAll('main h2.section-title').forEach((h) => {
      if (h.offsetParent !== null && h.textContent.trim()) found.push({ label: h.textContent.trim(), el: h });
    });
    const summary = document.querySelector('.editor-panel > summary');
    if (summary && summary.offsetParent !== null) found.push({ label: summary.textContent.trim(), el: summary });
    found.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return found;
  }

  function closeMenu() {
    menu.hidden = true;
    jumpBtn.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    menu.replaceChildren();
    targets().forEach(({ label, el }) => {
      const item = document.createElement('li');
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = label;
      go.addEventListener('click', () => {
        const details = el.closest('details');
        if (details && !details.open) details.open = true;
        el.scrollIntoView({ behavior, block: 'start' });
        closeMenu();
      });
      item.appendChild(go);
      menu.appendChild(item);
    });
    menu.hidden = false;
    jumpBtn.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  jumpBtn.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior }));
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !nav.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu();
      jumpBtn.focus();
    }
  });

  let queued = false;
  function update() {
    queued = false;
    const tall = document.documentElement.scrollHeight > window.innerHeight * 1.6;
    topBtn.hidden = !(tall && window.scrollY > 400);
    jumpBtn.hidden = !(targets().length >= 3);
    if (jumpBtn.hidden) closeMenu();
    nav.hidden = topBtn.hidden && jumpBtn.hidden;

    // stay clear of the editor's save bar when it is showing at the bottom of the window
    const bar = document.querySelector('.editor-savebar');
    let bottom = 20;
    if (bar) {
      const box = bar.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) {
        bottom = Math.max(20, window.innerHeight - box.top + 12);
      }
    }
    nav.style.bottom = `${bottom}px`;
  }
  function schedule() {
    if (!queued) {
      queued = true;
      window.requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
  schedule();
})();