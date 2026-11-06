const form = document.getElementById('upload-form');
const messageEl = document.getElementById('form-message');
const progressEl = document.getElementById('progress');
const submitBtn = document.getElementById('submit-btn');
const grid = document.getElementById('song-grid');
const statusEl = document.getElementById('status');

const MAX_BYTES = 50 * 1024 * 1024;
const TYPE_BY_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

// If the song record was created but the file upload failed, retry the file only.
let pendingSongId = null;

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message ${type || ''}`;
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
}

function audioType(file) {
  if (file.type && file.type.startsWith('audio/')) return file.type;
  const ext = file.name.split('.').pop().toLowerCase();
  return TYPE_BY_EXT[ext] || null;
}

function asciiName(name) {
  return name.replace(/[^\x20-\x7E]/g, '_').slice(0, 200);
}

function uploadFile(songId, file, type) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/songs/${songId}/audio`);
    xhr.setRequestHeader('Content-Type', type);
    xhr.setRequestHeader('X-File-Name', asciiName(file.name));

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        progressEl.value = Math.round((event.loaded / event.total) * 100);
      }
    });

    xhr.addEventListener('load', () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message || 'Upload failed. Please try again.'));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('Cannot reach the server. Check your connection.'))
    );

    xhr.send(file);
  });
}

async function createSongRecord(title, artist) {
  const response = await fetch('/api/v1/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, artist }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const text = data.errors
      ? data.errors.map((e) => e.message).join('. ')
      : data.message || 'Could not create the song.';
    throw new Error(text);
  }
  return data.song._id;
}

function makeCard(song) {
  const li = document.createElement('li');
  li.className = 'song-card';

  const title = document.createElement('h2');
  title.textContent = song.title;
  if (song.visibility === 'private') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Private';
    title.appendChild(badge);
  }

  const artist = document.createElement('p');
  artist.className = 'artist';
  artist.textContent = song.artist || 'Unknown artist';

  const info = document.createElement('p');
  info.className = 'desc';
  info.textContent = song.audio && song.audio.mimeType ? 'Audio uploaded' : 'No audio yet';

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const link = document.createElement('a');
  link.className = 'card-link';
  link.href = `/play.html?id=${encodeURIComponent(song._id)}`;
  link.textContent = 'Open';
  actions.appendChild(link);

  li.append(title, artist, info, actions);
  return li;
}

async function loadMine() {
  grid.replaceChildren();
  setStatus('Loading your uploads…');
  try {
    const response = await fetch('/api/v1/songs/mine');
    if (!response.ok) throw new Error('failed');
    const data = await response.json();
    if (data.songs.length === 0) {
      setStatus('You have not uploaded anything yet.');
      return;
    }
    setStatus(`${data.songs.length} upload${data.songs.length === 1 ? '' : 's'}`);
    data.songs.forEach((song) => grid.appendChild(makeCard(song)));
  } catch (err) {
    setStatus('Could not load your uploads.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');

  const title = form.elements.title.value.trim();
  const artist = form.elements.artist.value.trim();
  const file = form.elements.file.files[0];

  if (!title) return showMessage('Please enter a title.', 'error');
  if (!file) return showMessage('Please choose an audio file.', 'error');
  if (file.size > MAX_BYTES) return showMessage('That file is larger than 50 MB.', 'error');

  const type = audioType(file);
  if (!type) return showMessage('Please choose an MP3, WAV, M4A, OGG or FLAC file.', 'error');

  submitBtn.disabled = true;
  progressEl.value = 0;
  progressEl.hidden = false;

  try {
    if (!pendingSongId) {
      showMessage('Creating song…');
      pendingSongId = await createSongRecord(title, artist);
    }
    showMessage('Uploading…');
    await uploadFile(pendingSongId, file, type);

    const finishedId = pendingSongId;
    pendingSongId = null;
    form.reset();
    showMessage('Upload complete! Opening your song…', 'success');
    window.location.href = `/play.html?id=${encodeURIComponent(finishedId)}`;
  } catch (err) {
    showMessage(err.message, 'error');
    submitBtn.disabled = false;
  }
});

(async function init() {
  const loggedIn = await LibraryAPI.isLoggedIn();
  if (!loggedIn) {
    window.location.href = '/login.html';
    return;
  }
  loadMine();
})();
