// Editor for song settings, chords, melody and lyrics.
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
  // Melody pitches offered in the editor: C2 (36) to C7 (96).
  const PITCH_LOW = 36;
  const PITCH_HIGH = 96;

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
      melody: (t.melody || []).map((n) => ({
        id: n.id,
        start: n.start,
        end: n.end,
        midi: n.midi,
      })),
      sections: (t.sections || []).map((s) => ({
        kind: s.kind,
        start: s.start,
        end: s.end,
        cycles: s.cycles ?? null,
        pattern: (s.pattern || []).map((p) => ({ root: p.root, quality: p.quality })),
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
    'aria-label': 'Speed in beats per minute',
  });
  bpmInput.addEventListener('input', () => {
    const n = parseFloat(bpmInput.value);
    draft.bpm = Number.isFinite(n) ? n : null;
    markDirty();
  });
  const timeSigHolder = h('span');

  const chordBody = h('tbody');
  const lyricBody = h('tbody');
  const melodyBody = h('tbody');

  const saveBtn = h('button', { type: 'button', class: 'btn btn-small', text: 'Save changes' });
  const revertBtn = h('button', { type: 'button', class: 'btn btn-small btn-outline', text: 'Revert' });
  const addChordBtn = h('button', {
    type: 'button',
    class: 'btn btn-small btn-outline',
    text: 'Add chord at current time',
  });
  const addNoteBtn = h('button', {
    type: 'button',
    class: 'btn btn-small btn-outline',
    text: 'Add note at current time',
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
      field('Major or minor', modeSelectHolder),
      field('Speed (beats per minute)', bpmInput),
      field('Time signature (beats per bar)', timeSigHolder)
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

  const chordTable = table(['#', 'Start (s)', 'End (s)', 'Note', 'Type', 'Lowest note', 'Name', ''], chordBody);
  const sectionHolder = h('div', { class: 'editor-sections' });

  const chordsGroup = h(
    'fieldset',
    { class: 'editor-group' },
    h('legend', { text: 'Chords' }),
    chordTable,
    sectionHolder,
    h('div', { class: 'editor-actions' }, addChordBtn)
  );

  const melodyGroup = h(
    'fieldset',
    { class: 'editor-group' },
    h('legend', { text: 'Melody' }),
    h(
      'p',
      { class: 'editor-help' },
      'One row per sung note. Middle C is C4. Notes are stored as pitch numbers, so the names and solfège are worked out for you.'
    ),
    table(['#', 'Start (s)', 'End (s)', 'Note', ''], melodyBody),
    h('div', { class: 'editor-actions' }, addNoteBtn)
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
    h('summary', { text: 'Edit chords, melody and lyrics' }),
    h(
      'p',
      { class: 'editor-help' },
      'Play the song, then use "Now" to fill a time from the current position. ' +
        'Nothing is saved until you press Save changes.'
    ),
    settings,
    chordsGroup,
    melodyGroup,
    lyricsGroup,
    h('div', { class: 'editor-actions editor-savebar' }, saveBtn, revertBtn, message)
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

  function pitchOptions(current) {
    const options = [];
    for (let midi = PITCH_HIGH; midi >= PITCH_LOW; midi -= 1) {
      options.push([String(midi), TimelineUtils.midiName(midi)]);
    }
    // A pitch outside the usual range (for example from a future import) is still shown.
    if (current < PITCH_LOW || current > PITCH_HIGH) {
      options.push([String(current), TimelineUtils.midiName(current)]);
    }
    return options;
  }

  function noteRow(note, index) {
    const n = index + 1;
    const pitchSelect = selectEl(`Note ${n} pitch`, pitchOptions(note.midi), String(note.midi), (v) => {
      note.midi = parseInt(v, 10);
      markDirty();
    });

    return h(
      'tr',
      {},
      h('td', { text: String(n) }),
      timeCell(`Note ${n} start (seconds)`, note, 'start'),
      timeCell(`Note ${n} end (seconds)`, note, 'end'),
      h('td', {}, pitchSelect),
      deleteButton(`Delete note ${n}`, () => {
        draft.melody.splice(index, 1);
        renderMelodyRows();
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

  // ---- Chords grouped into the sections found by the analysis ----
  const openSections = new Set();

  function ensureSectionStyle() {
    if (document.getElementById('editor-section-style')) return;
    const style = document.createElement('style');
    style.id = 'editor-section-style';
    style.textContent = `
      .editor-section { border: 1px solid var(--soft-grey, #a9b2c5); border-radius: 12px; padding: 0.7rem 0.9rem; margin: 0.6rem 0; }
      .editor-section-title { margin: 0 0 0.2rem; font-weight: 700; }
      .editor-section-fix { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.5rem 0; font-size: 0.9rem; }
      .editor-section-rows > summary { cursor: pointer; margin-top: 0.4rem; color: var(--teal, #46b9b0); }
    `;
    document.head.appendChild(style);
  }

  function clockText(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  // The section a chord belongs to: the first one that has not ended before the chord starts.
  function sectionIndexOf(chord) {
    const list = draft.sections;
    for (let i = 0; i < list.length; i += 1) {
      if (chord.start < list[i].end - 1e-6 || i === list.length - 1) return i;
    }
    return list.length - 1;
  }

  function sectionCard(section, index, members) {
    const distinct = [];
    members.forEach((c) => {
      if (!distinct.some((d) => d.root === c.root && d.quality === c.quality)) distinct.push(c);
    });
    const times = Math.max(1, Math.round(section.cycles || 1));
    const kind =
      section.kind === 'loop' ? `a repeating chord pattern, about ${times} time${times === 1 ? '' : 's'}` : 'changing chords';

    const card = h(
      'div',
      { class: 'editor-section' },
      h('p', { class: 'editor-section-title', text: `${clockText(section.start)} to ${clockText(section.end)} · ${kind}` }),
      h('p', {
        class: 'editor-help',
        text: members.length
          ? `Chords used here: ${distinct.map((c) => TimelineUtils.chordSymbol(c)).join(' · ')}. ${members.length} chord rows.`
          : 'No chords in this section.',
      })
    );

    if (distinct.length) {
      const toRoot = selectEl('Change to this root', NOTE_OPTIONS, String(distinct[0].root), () => {});
      const toQuality = selectEl('Change to this quality', QUALITIES, distinct[0].quality, () => {});
      const fromSelect = selectEl(
        'Chord to change',
        distinct.map((c, i) => [String(i), TimelineUtils.chordSymbol(c)]),
        '0',
        (value) => {
          const picked = distinct[Number(value)];
          if (!picked) return;
          toRoot.value = String(picked.root);
          toQuality.value = picked.quality;
        }
      );
      const apply = h('button', { type: 'button', class: 'btn-tiny', text: 'Change in this section' });
      apply.addEventListener('click', () => {
        const picked = distinct[Number(fromSelect.value)];
        if (!picked) return;
        const from = { root: picked.root, quality: picked.quality }; // a copy: the chords change below
        const root = parseInt(toRoot.value, 10);
        const quality = toQuality.value;
        if (root === from.root && quality === from.quality) return;
        members.forEach((c) => {
          if (c.root === from.root && c.quality === from.quality) {
            c.root = root;
            c.quality = quality;
          }
        });
        (section.pattern || []).forEach((p) => {
          if (p.root === from.root && p.quality === from.quality) {
            p.root = root;
            p.quality = quality;
          }
        });
        renderChordRows();
        markDirty();
      });
      card.appendChild(
        h(
          'div',
          { class: 'editor-section-fix' },
          h('span', { text: 'Fix a wrong chord everywhere in this section:' }),
          fromSelect,
          h('span', { text: 'becomes' }),
          toRoot,
          toQuality,
          apply
        )
      );

      const rows = h(
        'details',
        { class: 'editor-section-rows' },
        h('summary', { text: `Show the ${members.length} chord rows` }),
        table(
          ['#', 'Start (s)', 'End (s)', 'Note', 'Type', 'Lowest note', 'Name', ''],
          h('tbody', {}, members.map((c) => chordRow(c, draft.chords.indexOf(c))))
        )
      );
      rows.open = openSections.has(index);
      rows.addEventListener('toggle', () => {
        if (rows.open) openSections.add(index);
        else openSections.delete(index);
      });
      card.appendChild(rows);
    }
    return card;
  }

  function renderChordRows() {
    const grouped = draft.sections.length > 0 && draft.chords.length > 0;
    chordTable.hidden = grouped;
    sectionHolder.hidden = !grouped;
    if (grouped) {
      ensureSectionStyle();
      const buckets = draft.sections.map(() => []);
      draft.chords.forEach((c) => buckets[sectionIndexOf(c)].push(c));
      sectionHolder.replaceChildren(
        h('p', {
          class: 'editor-help',
          text: 'The chords are grouped into the sections found by the analysis, so repeats are not listed one by one. Open a section to see and edit its rows.',
        }),
        ...draft.sections.map((s, i) => sectionCard(s, i, buckets[i]))
      );
      return;
    }
    const rows = draft.chords.map(chordRow);
    chordBody.replaceChildren(
      ...(rows.length ? rows : [emptyRow(8, 'No chords yet. Use "Add chord at current time".')])
    );
  }

  function renderMelodyRows() {
    const rows = draft.melody.map(noteRow);
    melodyBody.replaceChildren(
      ...(rows.length ? rows : [emptyRow(5, 'No notes yet. Use "Add note at current time".')])
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
    renderMelodyRows();
    renderLyricRows();
  }

  // ---- Actions ----
  addChordBtn.addEventListener('click', () => {
    const start = currentTime();
    const added = {
      start,
      end: defaultEnd(start),
      root: draft.keyPc ?? 0,
      quality: draft.mode === 'minor' ? 'min' : 'maj',
      bass: null,
    };
    draft.chords.push(added);
    draft.chords.sort((a, b) => a.start - b.start);
    if (draft.sections.length) openSections.add(sectionIndexOf(added));
    renderChordRows();
    markDirty();
  });

  // A new note starts at the current time, lasts half a second, and begins on the
  // previous note's pitch (or the key's tonic in octave 4) so it is close to where you want it.
  addNoteBtn.addEventListener('click', () => {
    const start = currentTime();
    let end = start + 0.5;
    if (Number.isFinite(audio.duration) && end > audio.duration) end = audio.duration;
    if (end <= start) end = start + 0.5;

    const earlier = draft.melody.filter((note) => note.start <= start);
    const midi = earlier.length
      ? earlier[earlier.length - 1].midi
      : 60 + (draft.keyPc ?? 0);

    draft.melody.push({ start, end: Number(end.toFixed(1)), midi });
    draft.melody.sort((a, b) => a.start - b.start);
    renderMelodyRows();
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
      melody: draft.melody.map((n) => ({ id: n.id, start: n.start, end: n.end, midi: n.midi })),
      sections: draft.sections.map((s) => ({
        kind: s.kind,
        start: s.start,
        end: s.end,
        cycles: s.cycles,
        pattern: s.pattern.map((p) => ({ root: p.root, quality: p.quality })),
      })),
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