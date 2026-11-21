// Dark or light theme. Dark is the default, and the choice is remembered in this browser.
// Loaded in the page head so the right colours are in place before anything is drawn.
// The whole page changes in one step: the new theme spreads out from the switch like a fill.
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
    '<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
  const MOON =
    '<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';

  function build() {
    const host = document.querySelector('.site-header .nav') || document.querySelector('.site-header');
    if (!host || host.querySelector('.theme-toggle')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.setAttribute('role', 'switch');
    button.innerHTML =
      '<span class="theme-track"><span class="theme-fill"></span><span class="theme-knob">' + MOON + SUN + '</span></span>';

    function show() {
      const light = theme === 'light';
      button.setAttribute('aria-checked', light ? 'true' : 'false');
      button.setAttribute('aria-label', 'Light mode');
      button.title = light ? 'Switch to dark mode' : 'Switch to light mode';
    }

    function change(next) {
      const run = () => {
        theme = next;
        apply(next);
        save(next);
        show();
      };
      const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (calm || !document.startViewTransition) {
        run(); // no animation available: still one instant change for the whole page
        return;
      }
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const transition = document.startViewTransition(run);
      transition.ready
        .then(() => {
          root.animate(
            { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + reach + 'px at ' + x + 'px ' + y + 'px)'] },
            { duration: 550, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
          );
        })
        .catch(() => {});
    }

    button.addEventListener('click', () => change(theme === 'dark' ? 'light' : 'dark'));

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
