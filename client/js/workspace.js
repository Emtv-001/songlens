const statusEl = document.getElementById('status');
const workspaceEl = document.getElementById('workspace');
const titleEl = document.getElementById('song-title');
const artistEl = document.getElementById('song-artist');
const audio = document.getElementById('audio');
const speed = document.getElementById('speed');
const timeEl = document.getElementById('now-time');
const chordEl = document.getElementById('now-chord');
const chordStripEl = document.getElementById('chord-strip');
const pianoEl = document.getElementById('piano');
const pianoNotesEl = document.getElementById('piano-notes');
const lyricsBoxEl = document.getElementById('lyrics-box');
const hintEl = document.getElementById('timeline-hint');
const editorEl = document.getElementById('editor');
const metaEl = document.getElementById('song-meta');
const romanEl = document.getElementById('now-roman');
const solfaEl = document.getElementById('now-solfa');
const minorBaseEl = document.getElementById('minor-base');
const transposeDownEl = document.getElementById('transpose-down');
const transposeUpEl = document.getElementById('transpose-up');
const transposeResetEl = document.getElementById('transpose-reset');
const transposeLabelEl = document.getElementById('transpose-label');

const songId = new URLSearchParams(window.location.search).get('id');

const workspace = {
  song: null,
  timeline: { chords: [], lyrics: [] },
  canEdit: false,
  clock: null,
  unsubscribers: [],
  transpose: 0, // semitones, display only
  display: { chords: [], lyrics: [] }, // the timeline as shown (transposed copy)
};

// The views show a transposed copy. The stored timeline (and the editor) stay original.
function refreshDisplay() {
  workspace.display = Theory.transposeTimeline(workspace.timeline, workspace.transpose);
}

function updateTransposeUi() {
  const n = workspace.transpose;
  const original = workspace.timeline;
  let text = n === 0 ? 'Original key' : `${n > 0 ? '+' : ''}${n} semitone${Math.abs(n) === 1 ? '' : 's'}`;

  if (original.keyPc !== null && original.keyPc !== undefined) {
    const modeText = original.mode ? ` ${original.mode}` : '';
    const from = TimelineUtils.NOTE_NAMES[original.keyPc];
    const to = TimelineUtils.NOTE_NAMES[workspace.display.keyPc];
    text += n === 0 ? ` (${from}${modeText})` : ` (${from} → ${to}${modeText})`;
  }

  transposeLabelEl.textContent = text;
  transposeDownEl.disabled = n <= -11;
  transposeUpEl.disabled = n >= 11;
  transposeResetEl.disabled = n === 0;
}

function setTranspose(semitones) {
  workspace.transpose = Math.max(-11, Math.min(11, semitones));
  refreshDisplay();
  if (workspace.clock) buildViews();
  else updateTransposeUi();
}

// "la" (la-based minor, the default) or "do" (do-based minor).
function getMinorBase() {
  try {
    return localStorage.getItem('songlens.minorBase') === 'do' ? 'do' : 'la';
  } catch (err) {
    return 'la';
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

// Shows the time, the active chord, its Roman numeral and its solfege syllables.
function createNowView() {
  let lastTime = '';
  let lastChord = null;

  return function render(state) {
    const timeText = TimelineUtils.formatTime(state.time);
    if (timeText !== lastTime) {
      timeEl.textContent = timeText;
      lastTime = timeText;
    }

    const chordIndex = TimelineUtils.findActiveIndex(workspace.display.chords, state.time);
    if (chordIndex !== lastChord) {
      const { keyPc, mode } = workspace.display;
      const chord = chordIndex === -1 ? null : workspace.display.chords[chordIndex];

      chordEl.textContent = chord ? TimelineUtils.chordSymbol(chord) : '—';

      if (!chord) {
        romanEl.textContent = '—';
        solfaEl.textContent = '—';
      } else if (keyPc === null || keyPc === undefined) {
        romanEl.textContent = 'Set the key';
        solfaEl.textContent = 'Set the key';
      } else {
        romanEl.textContent = Theory.romanNumeral(chord, keyPc, mode);
        solfaEl.textContent = Theory.chordSolfege(chord, keyPc, mode, getMinorBase()).join(' · ');
      }
      lastChord = chordIndex;
    }
  };
}

// Shows the key, tempo and time signature under the song title.
function renderSongMeta() {
  const t = workspace.display;
  const keyText =
    t.keyPc === null || t.keyPc === undefined
      ? 'not set'
      : `${TimelineUtils.NOTE_NAMES[t.keyPc]}${t.mode ? ` ${t.mode}` : ''}`;
  const tempoText = t.bpm ? `${t.bpm} BPM` : 'not set';
  const items = [
    ['Key', keyText],
    ['Tempo', tempoText],
    ['Time', t.timeSignature || '4/4'],
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

// Builds every view and subscribes it to the shared clock.
// Safe to call again after the timeline changes (for example after saving an edit).
function buildViews() {
  workspace.unsubscribers.forEach((unsubscribe) => unsubscribe());
  workspace.unsubscribers = [];

  renderSongMeta();
  updateTransposeUi();

  const { chords, lyrics } = workspace.display;
  const clock = workspace.clock;
  const add = (render) => workspace.unsubscribers.push(clock.subscribe(render));

  add(createNowView());

  if (chords.length > 0) {
    const { keyPc, mode } = workspace.display;
    const romanFor = (chord) => Theory.romanNumeral(chord, keyPc, mode);
    add(createChordView(chordStripEl, chords, seekTo, romanFor).render);
  } else {
    showEmpty(chordStripEl, 'No chords yet.');
  }

  // The piano is always shown so it can be explored even without chord data.
  add(createPianoView(pianoEl, pianoNotesEl, chords).render);

  if (lyrics.length > 0) {
    add(createLyricsView(lyricsBoxEl, lyrics, seekTo).render);
  } else {
    showEmpty(lyricsBoxEl, 'No lyrics yet.');
  }

  hintEl.hidden = chords.length > 0 || lyrics.length > 0 || !workspace.canEdit;
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
  if (refreshing || !audio.src) return;
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

minorBaseEl.value = getMinorBase();
minorBaseEl.addEventListener('change', () => {
  saveMinorBase(minorBaseEl.value);
  if (workspace.clock) buildViews();
});

transposeDownEl.addEventListener('click', () => setTranspose(workspace.transpose - 1));
transposeUpEl.addEventListener('click', () => setTranspose(workspace.transpose + 1));
transposeResetEl.addEventListener('click', () => setTranspose(0));

speed.addEventListener('change', () => {
  audio.playbackRate = parseFloat(speed.value);
});

audio.addEventListener('loadedmetadata', () => {
  audio.playbackRate = parseFloat(speed.value);
});

init();