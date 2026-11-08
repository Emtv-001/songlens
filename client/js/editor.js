// Editor for song settings, chords and lyrics.
// It works on a draft copy and only sends it to the server when the user presses Save.
function createEditor({ container, audio, songId, timeline, onSaved }) {
  const NOTES = TimelineUtils.NOTE_NAMES;
  const QUALITIES = [
    ['maj', 'major'],
    ['min', 'minor'],
    ['dim', 'diminished'],
    ['aug', 'augmented'],
    ['7', 'dominant 7'],
    ['maj7', 'major 7'],
    ['min7', 'minor 7'],
    ['sus2', 'sus2'],
    ['sus4', 'sus4'],
  ];
  const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '9/8', '12/8'];
  const NOTE_OPTIONS = NOTES.map((name, i) => [String(i), name]);

  let draft = cloneTimeline(timeline);
  let dirty = false;

  function cloneTimeline(t) {
    return {
      keyPc: t.keyPc ?? null,
      mode: t.mode ?? null,
      bpm: t.bpm ?? null,
      timeSignature: t.timeSignature || '4/4',
      chords: (t.chords || []).map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        root: c.root,
        quality: c.quality,
        bass: c.bass ?? null,
      })),
      lyrics: (t.lyrics || []).map((l) => ({
        id: l.id,
        start: l.start,
        end: l.end,
        text: l.text,
      })),
    };
  }

  // Small helper for building elements safely (no innerHTML).
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    let value;
    Object.entries(attrs).forEach(([key, val]) => {
      if (val === undefined || val === null || val === false) return;
      if (key === 'class') el.className = val;
      else if (key === 'text') el.textContent = val;
      else if (key === 'value') value = val;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
      else el.setAttribute(key, val === true ? '' : val);
    });
    children.flat().forEach((child) => el.append(child));
    if (value !== undefined) el.value = value;
    return el;
  }

  function selectEl(label, options, current, onChange) {
    const select = h(
      'select',
      { 'aria-label': label },
      options.map(([value, text]) => h('option', { value, text }))
    );
    select.value = current;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function markDirty() {
    dirty = true;
    setMessage('Unsaved changes', '');
  }

  function currentTime() {
    return Number((audio.currentTime || 0).toFixed(1));
  }

  function defaultEnd(start) {
    let end = start + 4;
    if (Number.isFinite(audio.duration) && end > audio.duration) end = audio.duration;
    if (end <= start) end = start + 1;
    return Number(end.toFixed(1));
  }

  // ---- Skeleton ----
  const message = h('p', { class: 'editor-message', role: 'status' });
  function setMessage(text, type) {
    message.textContent = text;
    message.className = `editor-message ${type || ''}`;
  }

  const keySelectHolder = h('span');
  const modeSelectHolder = h('span');
  const bpmInput = h('input', {
    type: 'number',
    min: '20',
    max: '300',
    step: '1',
    'aria-label': 'Tempo in beats per minute',
  });
  bpmInput.addEventListener('input', () => {
    const n = parseFloat(bpmInput.value);
    draft.bpm = Number.isFinite(n) ? n : null;
    markDirty();
  });
  const timeSigHolder = h('span');

  const chordBody = h('tbody');
  const lyricBody = h('tbody');

  const saveBtn = h('button', { type: 'button', class: 'btn btn-small', text: 'Save changes' });
  const revertBtn = h('button', { type: 'button', class: 'btn btn-small btn-outline', text: 'Revert' });
  const addChordBtn = h('button', {
    type: 'button',
    class: 'btn btn-small btn-outline',
    text: 'Add chord at current time',
  });
  const addLyricBtn = h('button', {
    type: 'button',
    class: 'btn btn-small btn-outline',
    text: 'Add line at current time',
  });

  function field(labelText, control) {
    return h('label', { class: 'editor-field' }, h('span', { text: labelText }), control);
  }

  const settings = h(
    'fieldset',
    { class: 'editor-group' },
    h('legend', { text: 'Song settings' }),
    h(
      'div',
      { class: 'editor-settings' },
      field('Key', keySelectHolder),
      field('Mode', modeSelectHolder),
      field('Tempo (BPM)', bpmInput),
      field('Time signature', timeSigHolder)
    )
  );

  function table(headers, body) {
    return h(
      'div',
      { class: 'editor-table-wrap' },
      h(
        'table',
        { class: 'editor-table' },
        h('thead', {}, h('tr', {}, headers.map((text) => h('th', { scope: 'col', text })))),
        body
      )
    );
  }

  const chordsGroup = h(
    'fieldset',
    { class: 'editor-group' },
    h('legend', { text: 'Chords' }),
    table(['#', 'Start (s)', 'End (s)', 'Root', 'Quality', 'Bass', 'Symbol', ''], chordBody),
    h('div', { class: 'editor-actions' }, addChordBtn)
  );

  const lyricsGroup = h(
    'fieldset',
    { class: 'editor-group' },
    h('legend', { text: 'Lyrics' }),
    table(['#', 'Start (s)', 'End (s)', 'Text', ''], lyricBody),
    h('div', { class: 'editor-actions' }, addLyricBtn)
  );

  const panel = h(
    'details',
    { class: 'editor-panel' },
    h('summary', { text: 'Edit chords and lyrics' }),
    h(
      'p',
      { class: 'editor-help' },
      'Play the song, then use "Now" to fill a time from the current position. ' +
        'Nothing is saved until you press Save changes.'
    ),
    settings,
    chordsGroup,
    lyricsGroup,
    h('div', { class: 'editor-actions' }, saveBtn, revertBtn),
    message
  );

  // ---- Rows ----
  function timeCell(label, obj, key) {
    const input = h('input', {
      type: 'number',
      min: '0',
      step: '0.1',
      'aria-label': label,
    });
    input.value = Number.isFinite(obj[key]) ? obj[key] : '';
    input.addEventListener('input', () => {
      obj[key] = input.value === '' ? NaN : parseFloat(input.value);
      markDirty();
    });
    const now = h('button', {
      type: 'button',
      class: 'btn-tiny',
      text: 'Now',
      'aria-label': `${label}: use current playback time`,
    });
    now.addEventListener('click', () => {
      const t = currentTime();
      obj[key] = t;
      input.value = t;
      markDirty();
    });
    return h('td', { class: 'time-cell' }, input, now);
  }

  function deleteButton(label, onDelete) {
    const button = h('button', {
      type: 'button',
      class: 'btn-tiny danger',
      text: 'Delete',
      'aria-label': label,
    });
    button.addEventListener('click', onDelete);
    return h('td', {}, button);
  }

  function emptyRow(columns, text) {
    return h('tr', {}, h('td', { colspan: String(columns), class: 'empty-note', text }));
  }

  function chordRow(chord, index) {
    const n = index + 1;
    const symbol = h('span', { class: 'chord-preview', text: TimelineUtils.chordSymbol(chord) });
    const refresh = () => {
      symbol.textContent = TimelineUtils.chordSymbol(chord);
      markDirty();
    };

    const rootSelect = selectEl(`Chord ${n} root`, NOTE_OPTIONS, String(chord.root), (v) => {
      chord.root = parseInt(v, 10);
      refresh();
    });
    const qualitySelect = selectEl(`Chord ${n} quality`, QUALITIES, chord.quality, (v) => {
      chord.quality = v;
      refresh();
    });
    const bassSelect = selectEl(
      `Chord ${n} bass note`,
      [['', 'none'], ...NOTE_OPTIONS],
      chord.bass === null ? '' : String(chord.bass),
      (v) => {
        chord.bass = v === '' ? null : parseInt(v, 10);
        refresh();
      }
    );

    return h(
      'tr',
      {},
      h('td', { text: String(n) }),
      timeCell(`Chord ${n} start (seconds)`, chord, 'start'),
      timeCell(`Chord ${n} end (seconds)`, chord, 'end'),
      h('td', {}, rootSelect),
      h('td', {}, qualitySelect),
      h('td', {}, bassSelect),
      h('td', {}, symbol),
      deleteButton(`Delete chord ${n}`, () => {
        draft.chords.splice(index, 1);
        renderChordRows();
        markDirty();
      })
    );
  }

  function lyricRow(line, index) {
    const n = index + 1;
    const text = h('input', {
      type: 'text',
      maxlength: '300',
      'aria-label': `Lyric line ${n} text`,
      class: 'lyric-input',
    });
    text.value = line.text;
    text.addEventListener('input', () => {
      line.text = text.value;
      markDirty();
    });

    return h(
      'tr',
      {},
      h('td', { text: String(n) }),
      timeCell(`Lyric ${n} start (seconds)`, line, 'start'),
      timeCell(`Lyric ${n} end (seconds)`, line, 'end'),
      h('td', {}, text),
      deleteButton(`Delete lyric line ${n}`, () => {
        draft.lyrics.splice(index, 1);
        renderLyricRows();
        markDirty();
      })
    );
  }

  function renderChordRows() {
    const rows = draft.chords.map(chordRow);
    chordBody.replaceChildren(
      ...(rows.length ? rows : [emptyRow(8, 'No chords yet. Use "Add chord at current time".')])
    );
  }

  function renderLyricRows() {
    const rows = draft.lyrics.map(lyricRow);
    lyricBody.replaceChildren(
      ...(rows.length ? rows : [emptyRow(5, 'No lyrics yet. Use "Add line at current time".')])
    );
  }

  function renderSettings() {
    keySelectHolder.replaceChildren(
      selectEl(
        'Key',
        [['', 'not set'], ...NOTE_OPTIONS],
        draft.keyPc === null ? '' : String(draft.keyPc),
        (v) => {
          draft.keyPc = v === '' ? null : parseInt(v, 10);
          markDirty();
        }
      )
    );
    modeSelectHolder.replaceChildren(
      selectEl(
        'Mode',
        [
          ['', 'not set'],
          ['major', 'major'],
          ['minor', 'minor'],
        ],
        draft.mode || '',
        (v) => {
          draft.mode = v === '' ? null : v;
          markDirty();
        }
      )
    );
    bpmInput.value = draft.bpm === null ? '' : draft.bpm;

    const signatures = TIME_SIGNATURES.includes(draft.timeSignature)
      ? TIME_SIGNATURES
      : [...TIME_SIGNATURES, draft.timeSignature];
    timeSigHolder.replaceChildren(
      selectEl(
        'Time signature',
        signatures.map((s) => [s, s]),
        draft.timeSignature,
        (v) => {
          draft.timeSignature = v;
          markDirty();
        }
      )
    );
  }

  function renderAll() {
    renderSettings();
    renderChordRows();
    renderLyricRows();
  }

  // ---- Actions ----
  addChordBtn.addEventListener('click', () => {
    const start = currentTime();
    draft.chords.push({
      start,
      end: defaultEnd(start),
      root: draft.keyPc ?? 0,
      quality: draft.mode === 'minor' ? 'min' : 'maj',
      bass: null,
    });
    draft.chords.sort((a, b) => a.start - b.start);
    renderChordRows();
    markDirty();
  });

  addLyricBtn.addEventListener('click', () => {
    const start = currentTime();
    draft.lyrics.push({ start, end: defaultEnd(start), text: '' });
    draft.lyrics.sort((a, b) => a.start - b.start);
    renderLyricRows();
    markDirty();
  });

  revertBtn.addEventListener('click', () => {
    draft = cloneTimeline(timeline);
    dirty = false;
    renderAll();
    setMessage('Reverted to the last saved version.', '');
  });

  function payload() {
    return {
      keyPc: draft.keyPc,
      mode: draft.mode,
      bpm: draft.bpm,
      timeSignature: draft.timeSignature,
      chords: draft.chords.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        root: c.root,
        quality: c.quality,
        bass: c.bass,
      })),
      lyrics: draft.lyrics.map((l) => ({ id: l.id, start: l.start, end: l.end, text: l.text })),
    };
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setMessage('Saving…', '');
    try {
      const response = await fetch(`/api/v1/songs/${encodeURIComponent(songId)}/timeline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Could not save. Please try again.');
      }

      timeline = data.timeline;
      draft = cloneTimeline(timeline);
      dirty = false;
      renderAll();
      setMessage('Saved.', 'success');
      onSaved(timeline);
    } catch (err) {
      const text = err instanceof TypeError ? 'Cannot reach the server.' : err.message;
      setMessage(text, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  renderAll();
  container.replaceChildren(panel);
  container.hidden = false;
}
