const statusEl = document.getElementById('status');
const workspaceEl = document.getElementById('workspace');
const titleEl = document.getElementById('song-title');
const artistEl = document.getElementById('song-artist');
const audio = document.getElementById('audio');
const speed = document.getElementById('speed');
const timeEl = document.getElementById('now-time');
const chordEl = document.getElementById('now-chord');
const chordStripEl = document.getElementById('chord-strip');
const melodyLaneEl = document.getElementById('melody-lane');
const staffEl = document.getElementById('staff');
const staffLabelsEl = document.getElementById('staff-labels');
const pianoEl = document.getElementById('piano');
const pianoNotesEl = document.getElementById('piano-notes');
const lyricsBoxEl = document.getElementById('lyrics-box');
const hintEl = document.getElementById('timeline-hint');
const editorEl = document.getElementById('editor');
const metaEl = document.getElementById('song-meta');
const romanEl = document.getElementById('now-roman');
const solfaEl = document.getElementById('now-solfa');
const noteEl = document.getElementById('now-note');
const noteSolfaEl = document.getElementById('now-note-solfa');
const minorBaseEl = document.getElementById('minor-base');
const transposeDownEl = document.getElementById('transpose-down');
const transposeUpEl = document.getElementById('transpose-up');
const transposeResetEl = document.getElementById('transpose-reset');
const transposeLabelEl = document.getElementById('transpose-label');
const transposeSoundEl = document.getElementById('transpose-sound');
const transposeNoteEl = document.getElementById('transpose-note');
// Plays the recording in the chosen key too (see key-shifter.js). null when the browser can't.
const shifter = KeyShifter.supported() ? KeyShifter.create(audio, fetchAudioUrl) : null;
let keySoundProblem = shifter ? '' : 'unsupported';

const songId = new URLSearchParams(window.location.search).get('id');

const workspace = {
  song: null,
  timeline: { chords: [], lyrics: [], melody: [] },
  canEdit: false,
  clock: null,
  unsubscribers: [],
  transpose: 0, // semitones, display only
  display: { chords: [], lyrics: [], melody: [] }, // the timeline as shown (transposed copy)
};

// The views show a transposed copy. The stored timeline (and the editor) stay original.
function refreshDisplay() {
  workspace.display = Theory.transposeTimeline(workspace.timeline, workspace.transpose);
}

// True when the displayed key is written with flats (Bb) rather than sharps (A#).
function displayFlats() {
  return Theory.usesFlats(workspace.display.keyPc, workspace.display.mode);
}

// Which names to use for notes outside the scale (ra or di, and so on). This follows the
// song's ORIGINAL key, not the transposed one, so the syllables never change when you
// transpose.
function solfegeFlats() {
  return Theory.usesFlats(workspace.timeline.keyPc, workspace.timeline.mode);
}

// The key changes found in the song, shown in the key the listener has chosen.
function displayKeySections() {
  const list = Array.isArray(workspace.timeline.keySections) ? workspace.timeline.keySections : [];
  return list.map((k) => ({ ...k, keyPc: (((k.keyPc + workspace.transpose) % 12) + 12) % 12 }));
}

// The key that is sounding at a moment: a key change inside the song, otherwise the song's key.
function keyAt(time) {
  const list = displayKeySections();
  if (list.length < 2) return { keyPc: workspace.display.keyPc, mode: workspace.display.mode };
  const found = list.find((k) => time < k.end) || list[list.length - 1];
  return { keyPc: found.keyPc, mode: found.mode };
}

function updateTransposeUi() {
  const n = workspace.transpose;
  const original = workspace.timeline;
  let text = n === 0 ? 'Original key' : `${n > 0 ? '+' : ''}${n} half step${Math.abs(n) === 1 ? '' : 's'}`;

  if (original.keyPc !== null && original.keyPc !== undefined) {
    const from = KeyNames.label(original.keyPc, original.mode);
    const to = KeyNames.label(workspace.display.keyPc, workspace.display.mode);
    text += n === 0 ? ` (${from})` : ` (${from} → ${to})`;
  }

  transposeLabelEl.textContent = text;
  transposeDownEl.disabled = n <= -11;
  transposeUpEl.disabled = n >= 11;
  transposeResetEl.disabled = n === 0;
  updateTransposeNote();
}

function updateTransposeNote() {
  transposeNoteEl.textContent = KeyShifter.describe({
    on: transposeSoundEl.checked,
    transpose: workspace.transpose,
    problem: keySoundProblem,
  });
}

// Makes the sound follow the chosen key (when the tickbox is on).
async function applyKeySound() {
  if (!shifter) {
    updateTransposeNote();
    return;
  }
  const shift = transposeSoundEl.checked ? KeyShifter.soundShift(workspace.transpose) : 0;
  if (shift !== 0 && !shifter.ready()) {
    keySoundProblem = 'loading';
    updateTransposeNote();
  }
  keySoundProblem = await shifter.set(shift);
  updateTransposeNote();
}

function setTranspose(semitones) {
  workspace.transpose = Math.max(-11, Math.min(11, semitones));
  refreshDisplay();
  if (workspace.clock) buildViews();
  else updateTransposeUi();
  applyKeySound();
}

// "la" (la-based minor, the default) or "do" (do-based minor).
function getMinorBase() {
  try {
    return localStorage.getItem('songlens.minorBase') === 'do' ? 'do' : 'la';
  } catch (err) {
    return 'la';
  }
}

// What to write under each note on the staff: "solfege", "name" or "none".
function getStaffLabels() {
  try {
    const value = localStorage.getItem('songlens.staffLabels');
    return value === 'name' || value === 'none' ? value : 'solfege';
  } catch (err) {
    return 'solfege';
  }
}

function saveStaffLabels(value) {
  try {
    localStorage.setItem('songlens.staffLabels', value);
  } catch (err) {
    // The setting just will not be remembered.
  }
}

function saveMinorBase(value) {
  try {
    localStorage.setItem('songlens.minorBase', value);
  } catch (err) {
    // The setting just will not be remembered.
  }
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
  statusEl.hidden = !text;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function fetchAudioUrl() {
  return fetchJson(`/api/v1/songs/${encodeURIComponent(songId)}/audio-url`).then((d) => d.url);
}

function seekTo(seconds) {
  audio.currentTime = seconds;
}

function showEmpty(container, message) {
  const p = document.createElement('p');
  p.className = 'empty-note';
  p.textContent = message;
  container.replaceChildren(p);
}

// Shows the time, the active chord (Roman numeral, solfege) and the current melody note.
function createNowView() {
  let lastTime = '';
  let lastChord = null;
  let lastNote = null;

  return function render(state) {
    const timeText = TimelineUtils.formatTime(state.time);
    if (timeText !== lastTime) {
      timeEl.textContent = timeText;
      lastTime = timeText;
    }

    const chordIndex = TimelineUtils.findActiveIndex(workspace.display.chords, state.time);
    if (chordIndex !== lastChord) {
      const { keyPc, mode } = keyAt(state.time);
      const chord = chordIndex === -1 ? null : workspace.display.chords[chordIndex];

      chordEl.textContent = chord ? TimelineUtils.chordSymbol(chord, displayFlats()) : '—';

      if (!chord) {
        romanEl.textContent = '—';
        solfaEl.textContent = '—';
      } else if (keyPc === null || keyPc === undefined) {
        romanEl.textContent = 'Set the key';
        solfaEl.textContent = 'Set the key';
      } else {
        romanEl.textContent = Theory.romanNumeral(chord, keyPc, mode);
        solfaEl.textContent = Theory.chordSolfege(chord, keyPc, mode, getMinorBase(), solfegeFlats()).join(' · ');
      }
      lastChord = chordIndex;
    }

    const noteIndex = TimelineUtils.findActiveIndex(workspace.display.melody || [], state.time);
    if (noteIndex !== lastNote) {
      const { keyPc, mode } = keyAt(state.time);
      if (noteIndex === -1) {
        noteEl.textContent = '—';
        noteSolfaEl.textContent = '—';
      } else {
        const note = workspace.display.melody[noteIndex];
        noteEl.textContent = TimelineUtils.midiName(note.midi, displayFlats());
        noteSolfaEl.textContent =
          keyPc === null || keyPc === undefined
            ? 'Set the key'
            : Theory.solfege(note.midi % 12, keyPc, mode, getMinorBase(), solfegeFlats());
      }
      lastNote = noteIndex;
    }
  };
}

// Shows the key, tempo and time signature under the song title.
function renderSongMeta() {
  const t = workspace.display;
  const keyChanges = displayKeySections();
  const keyText =
    keyChanges.length >= 2
      ? keyChanges
          .map((k) => KeyNames.label(k.keyPc, k.mode))
          .filter((name, i, all) => i === 0 || name !== all[i - 1])
          .join(' → ')
      : t.keyPc === null || t.keyPc === undefined
      ? 'not set'
      : KeyNames.label(t.keyPc, t.mode);
  const tempoText = t.bpm ? `${t.bpm} BPM` : 'not set';
  const items = [
    ['Key', keyText],
    ['Speed', tempoText],
    ['Beats', t.timeSignature || '4/4'],
  ];

  metaEl.replaceChildren(
    ...items.map(([label, value]) => {
      const chip = document.createElement('span');
      chip.className = 'meta-chip';
      const name = document.createElement('span');
      name.className = 'meta-label';
      name.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      chip.append(name, val);
      return chip;
    })
  );
}

// The chord sections found by the analysis, with their patterns transposed like the chords.
function displaySections() {
  const list = Array.isArray(workspace.timeline.sections) ? workspace.timeline.sections : [];
  return list.map((s) => ({
    ...s,
    pattern: (s.pattern || []).map((c) => Theory.transposeChord(c, workspace.transpose)),
  }));
}

// Builds every view and subscribes it to the shared clock.
// Safe to call again after the timeline changes (for example after saving an edit).
function buildViews() {
  workspace.unsubscribers.forEach((unsubscribe) => unsubscribe());
  workspace.unsubscribers = [];

  renderSongMeta();
  updateTransposeUi();

  const { chords, lyrics, melody } = workspace.display;
  const clock = workspace.clock;
  const add = (render) => workspace.unsubscribers.push(clock.subscribe(render));
  const flats = displayFlats();

  add(createNowView());

  if (chords.length > 0) {
    const romanFor = (chord) => {
      const { keyPc, mode } = keyAt(chord.start);
      return Theory.romanNumeral(chord, keyPc, mode);
    };
    const sections = displaySections();
    chordStripEl.classList.remove('chord-summary');
    if (ViewOptions.get('chords') === 'compact' && sections.length > 0) {
      add(createChordSummaryView(chordStripEl, sections, chords, seekTo, romanFor, flats).render);
    } else {
      add(createChordView(chordStripEl, chords, seekTo, romanFor, flats).render);
    }
  } else {
    showEmpty(chordStripEl, 'No chords yet.');
  }

  if (melody && melody.length > 0) {
    add(createMelodyView(melodyLaneEl, melody, seekTo, flats).render);
  } else {
    showEmpty(melodyLaneEl, 'No melody yet.');
  }

  if (melody && melody.length > 0) {
    const { keyPc, mode } = workspace.display;
    const hasKey = keyPc !== null && keyPc !== undefined;
    const labelMode = getStaffLabels();
    const staffExtras = {
      chords,
      chordLabel: (chord) => ({
        symbol: TimelineUtils.chordSymbol(chord, flats),
        sub: hasKey ? Theory.romanNumeral(chord, keyAt(chord.start).keyPc, keyAt(chord.start).mode) : null,
      }),
      noteLabel:
        labelMode === 'none'
          ? null
          : (note) =>
              labelMode === 'name'
                ? TimelineUtils.pcName(note.midi % 12, flats)
                : hasKey
                  ? Theory.solfege(note.midi % 12, keyAt(note.start).keyPc, keyAt(note.start).mode, getMinorBase(), solfegeFlats())
                  : null,
    };
    add(createStaffView(staffEl, melody, seekTo, flats, staffExtras).render);
  } else {
    showEmpty(staffEl, 'No melody yet, so there is nothing to show on the staff.');
  }

  // The piano is always shown so it can be explored even without chord data.
  add(createPianoView(pianoEl, pianoNotesEl, chords, melody, flats).render);

  if (lyrics.length > 0) {
    add(createLyricsView(lyricsBoxEl, lyrics, seekTo).render);
  } else {
    showEmpty(lyricsBoxEl, 'No lyrics yet.');
  }

  ViewOptions.apply();
  hintEl.hidden =
    chords.length > 0 || lyrics.length > 0 || (melody && melody.length > 0) || !workspace.canEdit;
}

async function init() {
  if (!songId) {
    setStatus('No song selected. Go back to the library and choose one.', true);
    return;
  }

  try {
    const { song } = await fetchJson(`/api/v1/songs/${encodeURIComponent(songId)}`);
    workspace.song = song;

    document.title = `${song.title} — SongLens`;
    titleEl.textContent = song.title;
    artistEl.textContent = song.artist || 'Unknown artist';
    workspaceEl.hidden = false;

    if (!song.audio || !song.audio.mimeType) {
      setStatus('This song has no audio yet, so there is nothing to play.');
      audio.hidden = true;
      return;
    }

    const timelineData = await fetchJson(`/api/v1/songs/${encodeURIComponent(songId)}/timeline`);
    workspace.timeline = timelineData.timeline;
    workspace.canEdit = timelineData.canEdit;
    refreshDisplay();

    workspace.clock = new PlaybackClock(audio);
    buildViews();

    if (workspace.canEdit) {
      createEditor({
        container: editorEl,
        audio,
        songId,
        timeline: workspace.timeline,
        onSaved: (saved) => {
          workspace.timeline = saved;
          refreshDisplay();
          buildViews();
        },
      });
    }

    setStatus('');
    audio.src = await fetchAudioUrl();
  } catch (err) {
    setStatus(err.message === 'Song not found' ? 'Song not found.' : 'Could not load this song.', true);
  }
}

// The signed audio link lasts an hour. If playback fails, fetch a fresh one once
// and resume from the same spot.
let refreshing = false;
audio.addEventListener('error', async () => {
  if (refreshing || !audio.src || (shifter && shifter.testing())) return;
  refreshing = true;
  const position = audio.currentTime;
  const wasPlaying = !audio.paused;
  try {
    audio.src = await fetchAudioUrl();
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audio.currentTime = position;
        if (wasPlaying) audio.play().catch(() => {});
      },
      { once: true }
    );
  } catch (err) {
    setStatus('Playback stopped. Please reload the page.', true);
  } finally {
    setTimeout(() => {
      refreshing = false;
    }, 3000);
  }
});

ViewOptions.mount(
  { chords: chordStripEl, melody: melodyLaneEl, staff: staffEl, piano: pianoEl, lyrics: lyricsBoxEl },
  () => {
    if (workspace.clock) buildViews();
  }
);

staffLabelsEl.value = getStaffLabels();
staffLabelsEl.addEventListener('change', () => {
  saveStaffLabels(staffLabelsEl.value);
  if (workspace.clock) buildViews();
});

minorBaseEl.value = getMinorBase();
minorBaseEl.addEventListener('change', () => {
  saveMinorBase(minorBaseEl.value);
  if (workspace.clock) buildViews();
});

transposeDownEl.addEventListener('click', () => setTranspose(workspace.transpose - 1));
transposeUpEl.addEventListener('click', () => setTranspose(workspace.transpose + 1));
transposeResetEl.addEventListener('click', () => setTranspose(0));

function getKeySound() {
  try {
    return localStorage.getItem('songlens.keySound') !== 'off';
  } catch (err) {
    return true;
  }
}

function saveKeySound(on) {
  try {
    localStorage.setItem('songlens.keySound', on ? 'on' : 'off');
  } catch (err) {
    // the choice is just not remembered
  }
}

transposeSoundEl.checked = getKeySound();
transposeSoundEl.addEventListener('change', () => {
  saveKeySound(transposeSoundEl.checked);
  applyKeySound();
});

speed.addEventListener('change', () => {
  audio.playbackRate = parseFloat(speed.value);
  if (shifter) shifter.refresh();
});

audio.addEventListener('loadedmetadata', () => {
  audio.playbackRate = parseFloat(speed.value);
  if (shifter) shifter.refresh();
});

init();