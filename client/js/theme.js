// Dark or light theme. Dark is the default, and the choice is remembered in this browser.
// Loaded in the page head so the right colours are in place before anything is drawn.
(() => {
  const KEY = 'songlens.theme';
  const root = document.documentElement;
  const COLOURS = { dark: '#121212', light: '#efe3d3' };

  function read() {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch (err) {
      return 'dark';
    }
  }

  function save(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch (err) {
      // private window or blocked storage: the choice just lasts until the page closes
    }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta && document.head) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    if (meta) meta.content = COLOURS[theme];
  }

  let theme = read();
  apply(theme);

  const SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
  const MOON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';

  function build() {
    const host = document.querySelector('.site-header .nav') || document.querySelector('.site-header');
    if (!host || host.querySelector('.theme-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';

    function show() {
      const toLight = theme === 'dark';
      button.innerHTML = toLight ? SUN : MOON; // the icon shows where the button takes you
      button.setAttribute('aria-label', toLight ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = toLight ? 'Light mode' : 'Dark mode';
    }

    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!calm) {
        root.classList.add('theme-anim');
        setTimeout(() => root.classList.remove('theme-anim'), 400);
      }
      apply(theme);
      save(theme);
      show();
    });

    window.addEventListener('storage', (event) => {
      if (event.key === KEY) {
        theme = read();
        apply(theme);
        show();
      }
    });

    show();
    host.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
