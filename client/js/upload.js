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
  if (!response.ok) throw new Error(describeErrors(data, 'Could not create the song.'));
  return data.song._id;
}

function describeErrors(data, fallback) {
  if (data && data.errors) return data.errors.map((e) => e.message).join('. ');
  return (data && data.message) || fallback;
}

function updateCount() {
  const count = grid.children.length;
  if (count === 0) setStatus('You have not uploaded anything yet.');
  else setStatus(`${count} upload${count === 1 ? '' : 's'}`);
}

function makeField(labelText, control) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.appendChild(control);
  wrap.appendChild(label);
  return wrap;
}

function makeButton(text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function makeCard(song) {
  const li = document.createElement('li');
  li.className = 'song-card';

  // What the card shows at the moment. render() rebuilds it, so edits show straight away.
  let mode = 'view'; // 'view' | 'edit' | 'confirm'
  let message = '';
  let busy = false;

  function render() {
    li.replaceChildren();

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

    li.append(title, artist, info);

    if (mode === 'edit') li.appendChild(makeEditForm());
    else li.appendChild(makeActions());

    if (message) {
      const note = document.createElement('p');
      note.className = 'form-message error';
      note.setAttribute('role', 'alert');
      note.textContent = message;
      li.appendChild(note);
    }
  }

  function makeActions() {
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (mode === 'confirm') {
      const question = document.createElement('span');
      question.className = 'confirm-text';
      question.textContent = 'Delete this song, its audio, chords and melody? This cannot be undone.';
      actions.append(
        question,
        makeButton(busy ? 'Deleting…' : 'Yes, delete', 'btn btn-small btn-danger', remove),
        makeButton('Cancel', 'btn btn-small btn-outline', () => {
          mode = 'view';
          message = '';
          render();
        })
      );
      return actions;
    }

    const link = document.createElement('a');
    link.className = 'card-link';
    link.href = `/workspace.html?id=${encodeURIComponent(song._id)}`;
    link.textContent = 'Open';

    actions.append(
      link,
      makeButton('Edit details', 'btn btn-small btn-outline', () => {
        mode = 'edit';
        message = '';
        render();
      }),
      makeButton('Delete', 'btn btn-small btn-outline btn-danger-outline', () => {
        mode = 'confirm';
        message = '';
        render();
      })
    );
    return actions;
  }

  function makeEditForm() {
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.maxLength = 200;
    titleInput.value = song.title;

    const artistInput = document.createElement('input');
    artistInput.type = 'text';
    artistInput.maxLength = 200;
    artistInput.value = song.artist || '';

    const descInput = document.createElement('textarea');
    descInput.maxLength = 2000;
    descInput.rows = 3;
    descInput.value = song.description || '';

    const form = document.createElement('div');
    form.className = 'edit-form';

    const save = makeButton('Save', 'btn btn-small', async () => {
      const newTitle = titleInput.value.trim();
      if (!newTitle) {
        message = 'Please enter a title.';
        render();
        return;
      }
      save.disabled = true;
      try {
        const response = await fetch(`/api/v1/songs/${encodeURIComponent(song._id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newTitle,
            artist: artistInput.value.trim(),
            description: descInput.value.trim(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(describeErrors(data, 'Could not save the changes.'));
        song = data.song;
        mode = 'view';
        message = '';
      } catch (err) {
        message = err instanceof TypeError ? 'Cannot reach the server.' : err.message;
      }
      render();
    });

    const cancel = makeButton('Cancel', 'btn btn-small btn-outline', () => {
      mode = 'view';
      message = '';
      render();
    });

    const buttons = document.createElement('div');
    buttons.className = 'card-actions';
    buttons.append(save, cancel);

    form.append(
      makeField('Title', titleInput),
      makeField('Artist', artistInput),
      makeField('Description', descInput),
      buttons
    );
    return form;
  }

  async function remove() {
    if (busy) return;
    busy = true;
    render();
    try {
      const response = await fetch(`/api/v1/songs/${encodeURIComponent(song._id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Could not delete this song.');
      }
      if (pendingSongId === song._id) pendingSongId = null;
      li.remove();
      updateCount();
      return;
    } catch (err) {
      message = err instanceof TypeError ? 'Cannot reach the server.' : err.message;
    }
    busy = false;
    mode = 'view';
    render();
  }

  render();
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
    window.location.href = `/workspace.html?id=${encodeURIComponent(finishedId)}`;
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