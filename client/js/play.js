const statusEl = document.getElementById('status');
const card = document.getElementById('player-card');
const titleEl = document.getElementById('song-title');
const artistEl = document.getElementById('song-artist');
const descEl = document.getElementById('song-desc');
const audio = document.getElementById('audio');
const speed = document.getElementById('speed');

const songId = new URLSearchParams(window.location.search).get('id');
let refreshing = false;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
  statusEl.hidden = !text;
}

async function fetchAudioUrl() {
  const response = await fetch(`/api/v1/songs/${encodeURIComponent(songId)}/audio-url`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Could not load the audio.');
  return data.url;
}

async function init() {
  if (!songId) {
    setStatus('No song selected. Go back to the library and choose one.', true);
    return;
  }

  try {
    const response = await fetch(`/api/v1/songs/${encodeURIComponent(songId)}`);
    if (!response.ok) {
      setStatus('Song not found.', true);
      return;
    }
    const { song } = await response.json();

    document.title = `${song.title} — SongLens`;
    titleEl.textContent = song.title;
    artistEl.textContent = song.artist || 'Unknown artist';
    descEl.textContent = song.description || '';
    card.hidden = false;

    if (!song.audio || !song.audio.mimeType) {
      audio.hidden = true;
      speed.closest('.speed-row').hidden = true;
      setStatus('This song has no audio yet.');
      return;
    }

    setStatus('');
    audio.src = await fetchAudioUrl();
  } catch (err) {
    setStatus('Could not load this song. Please try again.', true);
  }
}

// The signed link expires after an hour. If playback fails, get a fresh link once
// and carry on from the same position.
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

// Some browsers reset the rate when a new source loads.
audio.addEventListener('loadedmetadata', () => {
  audio.playbackRate = parseFloat(speed.value);
});

init();
