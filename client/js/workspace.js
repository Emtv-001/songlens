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

const songId = new URLSearchParams(window.location.search).get('id');

const workspace = {
  song: null,
  timeline: { chords: [], lyrics: [] },
  canEdit: false,
  clock: null,
};

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

// Shows the current time and the active chord as big text.
function createNowView() {
  let lastTime = '';
  let lastChord = null;

  return function render(state) {
    const timeText = TimelineUtils.formatTime(state.time);
    if (timeText !== lastTime) {
      timeEl.textContent = timeText;
      lastTime = timeText;
    }

    const chordIndex = TimelineUtils.findActiveIndex(workspace.timeline.chords, state.time);
    if (chordIndex !== lastChord) {
      chordEl.textContent =
        chordIndex === -1
          ? '—'
          : TimelineUtils.chordSymbol(workspace.timeline.chords[chordIndex]);
      lastChord = chordIndex;
    }
  };
}

function buildViews() {
  const { chords, lyrics } = workspace.timeline;
  const clock = workspace.clock;

  clock.subscribe(createNowView());

  if (chords.length > 0) {
    clock.subscribe(createChordView(chordStripEl, chords, seekTo).render);
  } else {
    showEmpty(chordStripEl, 'No chords yet.');
  }

  // The piano is always shown so it can be explored even without chord data.
  clock.subscribe(createPianoView(pianoEl, pianoNotesEl, chords).render);

  if (lyrics.length > 0) {
    clock.subscribe(createLyricsView(lyricsBoxEl, lyrics, seekTo).render);
  } else {
    showEmpty(lyricsBoxEl, 'No lyrics yet.');
  }

  hintEl.hidden = chords.length > 0 || lyrics.length > 0;
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

    workspace.clock = new PlaybackClock(audio);
    buildViews();

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

speed.addEventListener('change', () => {
  audio.playbackRate = parseFloat(speed.value);
});

audio.addEventListener('loadedmetadata', () => {
  audio.playbackRate = parseFloat(speed.value);
});

init();