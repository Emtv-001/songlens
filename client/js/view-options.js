// Lets the listener choose what each view shows: the piano can show the chords, the melody,
// both or nothing, and the other views can be shown or hidden. Choices are remembered in this
// browser only.
const ViewOptions = (() => {
  const DEFAULTS = { piano: 'both', chords: 'show', melody: 'show', staff: 'show', lyrics: 'show' };
  const LABELS = {
    piano: 'Piano shows',
    chords: 'Chord strip',
    melody: 'Melody lane',
    staff: 'Staff',
    lyrics: 'Lyrics',
  };
  const CHOICES = {
    piano: [
      ['both', 'Chords and melody'],
      ['chords', 'Chords only'],
      ['melody', 'Melody only'],
      ['none', 'Nothing (plain keyboard)'],
    ],
    show: [
      ['show', 'Show'],
      ['hide', 'Hide'],
    ],
  };

  const style = document.createElement('style');
  style.textContent = `
    [hidden] { display: none !important; }
    .view-option { display: flex; align-items: center; gap: 0.5rem; margin: 0.4rem 0; font-size: 0.9rem; color: var(--soft-grey, #a9b2c5); }
    .view-option select { font: inherit; font-size: 0.9rem; padding: 0.25rem 0.45rem; border-radius: 8px; border: 1px solid var(--soft-grey, #a9b2c5); background: var(--midnight, #10172a); color: var(--ivory, #f7f4ec); }
  `;
  document.head.appendChild(style);

  const elements = {};

  function get(name) {
    const allowed = (name === 'piano' ? CHOICES.piano : CHOICES.show).map((c) => c[0]);
    try {
      const value = localStorage.getItem(`songlens.view.${name}`);
      if (allowed.includes(value)) return value;
    } catch (err) {
      // fall through to the default
    }
    return DEFAULTS[name];
  }

  function set(name, value) {
    try {
      localStorage.setItem(`songlens.view.${name}`, value);
    } catch (err) {
      // the choice just will not be remembered
    }
  }

  // Hides or shows the views that are switched off. The piano always stays on screen.
  function apply() {
    ['chords', 'melody', 'staff', 'lyrics'].forEach((name) => {
      if (elements[name]) elements[name].hidden = get(name) === 'hide';
    });
  }

  // `targets` maps a view name to its container; a control is added just above each one.
  function mount(targets, onChange) {
    Object.keys(targets).forEach((name) => {
      const container = targets[name];
      if (!container || !LABELS[name]) return;
      elements[name] = container;

      const row = document.createElement('label');
      row.className = 'view-option';
      row.append(document.createTextNode(`${LABELS[name]}: `));
      const select = document.createElement('select');
      select.dataset.view = name;
      (name === 'piano' ? CHOICES.piano : CHOICES.show).forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      });
      select.value = get(name);
      select.addEventListener('change', () => {
        set(name, select.value);
        apply();
        if (onChange) onChange(name, select.value);
      });
      row.appendChild(select);
      container.before(row);
    });
    apply();
  }

  return { get, set, apply, mount };
})();