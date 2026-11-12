// Quick navigation inside the chord / melody / lyrics editor: jump to a part, to a row
// number, or to the row at the current playback time. The controls live in the editor's
// save bar, so they stay on screen while you scroll.
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .editor-jump { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-left: auto; }
    .editor-jump select, .editor-jump input { font: inherit; font-size: 0.9rem; padding: 0.3rem 0.45rem; border-radius: 8px; border: 1px solid var(--soft-grey, #a9b2c5); background: var(--midnight, #10172a); color: var(--ivory, #f7f4ec); }
    .editor-jump input { width: 4.5rem; }
    .editor-jump-note { font-size: 0.85rem; color: var(--soft-grey, #a9b2c5); }
    .editor-group legend, .editor-panel > summary, .editor-group tbody tr { scroll-margin-top: 1rem; scroll-margin-bottom: 6rem; }
    .editor-group tr.editor-row-flash td { background: rgba(70, 185, 176, 0.25); transition: background 0.4s; }
  `;
  document.head.appendChild(style);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior = reduceMotion ? 'auto' : 'smooth';
  const GROUPS = ['Chords', 'Melody', 'Lyrics'];

  const panel = () => document.querySelector('.editor-panel');
  const groupNamed = (name) =>
    [...document.querySelectorAll('.editor-panel fieldset.editor-group')].find((f) => {
      const legend = f.querySelector('legend');
      return legend && legend.textContent.trim() === name;
    });
  const rowsOf = (group) => (group ? [...group.querySelectorAll('tbody tr')] : []);

  function rowTimes(row) {
    const nums = row.querySelectorAll('input[type="number"]');
    return {
      start: parseFloat(nums[0] && nums[0].value),
      end: parseFloat(nums[1] && nums[1].value),
    };
  }

  function clock(seconds) {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function show(row) {
    const details = panel();
    if (details && !details.open) details.open = true;
    row.scrollIntoView({ behavior, block: 'center' });
    row.classList.add('editor-row-flash');
    setTimeout(() => row.classList.remove('editor-row-flash'), 1600);
    const field = row.querySelector('input, select');
    if (field) field.focus({ preventScroll: true });
  }

  function build(bar) {
    if (bar.querySelector('.editor-jump')) return;

    const wrap = document.createElement('div');
    wrap.className = 'editor-jump';

    const target = document.createElement('select');
    target.setAttribute('aria-label', 'Jump to part of the editor');
    [['top', 'Top of editor'], ...GROUPS.map((g) => [g, g])].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      target.appendChild(option);
    });

    const rowInput = document.createElement('input');
    rowInput.type = 'number';
    rowInput.min = '1';
    rowInput.step = '1';
    rowInput.placeholder = 'Row';
    rowInput.setAttribute('aria-label', 'Row number');

    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'btn btn-small btn-outline';
    goBtn.textContent = 'Go';
    goBtn.title = 'Go to this row in the chosen part';

    const nowBtn = document.createElement('button');
    nowBtn.type = 'button';
    nowBtn.className = 'btn btn-small btn-outline';
    nowBtn.textContent = 'Now';
    nowBtn.title = 'Go to the row at the current playback time';

    const note = document.createElement('span');
    note.className = 'editor-jump-note';
    note.setAttribute('role', 'status');

    // rows live in the chosen part; "Top of editor" falls back to the chords
    const chosenGroup = () => groupNamed(target.value === 'top' ? 'Chords' : target.value);

    target.addEventListener('change', () => {
      note.textContent = '';
      const details = panel();
      if (details && !details.open) details.open = true;
      if (target.value === 'top') {
        const summary = details && details.querySelector('summary');
        if (summary) summary.scrollIntoView({ behavior, block: 'start' });
        return;
      }
      const group = groupNamed(target.value);
      const legend = group && group.querySelector('legend');
      if (legend) legend.scrollIntoView({ behavior, block: 'start' });
    });

    function goToRow() {
      const rows = rowsOf(chosenGroup());
      const n = parseInt(rowInput.value, 10);
      if (!rows.length) {
        note.textContent = 'Nothing to jump to yet.';
        return;
      }
      if (!Number.isInteger(n) || n < 1 || n > rows.length) {
        note.textContent = `Choose a row from 1 to ${rows.length}.`;
        return;
      }
      note.textContent = `Row ${n} of ${rows.length}`;
      show(rows[n - 1]);
    }
    goBtn.addEventListener('click', goToRow);
    rowInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        goToRow();
      }
    });

    nowBtn.addEventListener('click', () => {
      const audio = document.getElementById('audio');
      const rows = rowsOf(chosenGroup());
      if (!audio || !rows.length) {
        note.textContent = 'Nothing to jump to yet.';
        return;
      }
      const t = audio.currentTime || 0;
      let index = -1;
      rows.forEach((row, i) => {
        const { start, end } = rowTimes(row);
        if (Number.isFinite(start) && start <= t && (!Number.isFinite(end) || t < end)) index = i;
      });
      if (index < 0) {
        // between rows: use the last row that has already started, else the first one
        rows.forEach((row, i) => {
          const { start } = rowTimes(row);
          if (Number.isFinite(start) && start <= t) index = i;
        });
        if (index < 0) index = 0;
      }
      note.textContent = `At ${clock(t)}: row ${index + 1} of ${rows.length}`;
      show(rows[index]);
    });

    wrap.append(target, rowInput, goBtn, nowBtn, note);
    bar.appendChild(wrap);
  }

  function check() {
    const bar = document.querySelector('.editor-savebar');
    if (bar) build(bar);
  }
  check();
  new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
})();