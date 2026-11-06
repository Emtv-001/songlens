const grid = document.getElementById('song-grid');
const statusEl = document.getElementById('status');
const pager = document.getElementById('pager');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');

const state = { page: 1, limit: 12, q: '', loggedIn: false, savedIds: new Set() };

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
}

function makeActions(song) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (!state.loggedIn) {
    const hint = document.createElement('span');
    hint.className = 'link-hint';
    const link = document.createElement('a');
    link.href = '/login.html';
    link.textContent = 'Log in';
    hint.append(link, ' to save songs');
    actions.appendChild(hint);
    return actions;
  }

  const button = document.createElement('button');
  button.type = 'button';

  function render() {
    const saved = state.savedIds.has(song._id);
    button.textContent = saved ? 'Remove from library' : 'Save to library';
    button.className = saved ? 'btn btn-small btn-outline' : 'btn btn-small';
  }

  button.addEventListener('click', async () => {
    const saved = state.savedIds.has(song._id);
    button.disabled = true;
    try {
      const response = saved
        ? await LibraryAPI.remove(song._id)
        : await LibraryAPI.save(song._id);
      if (response.ok) {
        if (saved) state.savedIds.delete(song._id);
        else state.savedIds.add(song._id);
      } else {
        setStatus('Could not update your library. Please try again.', true);
      }
    } catch (err) {
      setStatus('Could not reach the server.', true);
    } finally {
      button.disabled = false;
      render();
    }
  });

  render();
  actions.appendChild(button);
  return actions;
}

function makeCard(song) {
  const li = document.createElement('li');
  li.className = 'song-card';

  const title = document.createElement('h2');
  title.textContent = song.title;

  const artist = document.createElement('p');
  artist.className = 'artist';
  artist.textContent = song.artist || 'Unknown artist';

  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = song.description || '';

  li.append(title, artist, desc, makeActions(song));
  return li;
}

async function loadSongs() {
  grid.replaceChildren();
  pager.hidden = true;
  setStatus('Loading songs…');

  const params = new URLSearchParams({ page: state.page, limit: state.limit });
  if (state.q) params.set('q', state.q);

  try {
    const response = await fetch(`/api/v1/songs?${params}`);
    if (!response.ok) throw new Error('Request failed');
    const data = await response.json();

    if (data.songs.length === 0) {
      setStatus(state.q ? `No songs found for "${state.q}".` : 'No songs available yet.');
      return;
    }

    setStatus(`${data.total} song${data.total === 1 ? '' : 's'}`);
    data.songs.forEach((song) => grid.appendChild(makeCard(song)));

    const totalPages = Math.max(Math.ceil(data.total / data.limit), 1);
    pageInfo.textContent = `Page ${data.page} of ${totalPages}`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= totalPages;
    pager.hidden = totalPages <= 1;
  } catch (err) {
    setStatus('Could not load songs. Please try again.', true);
  }
}

async function init() {
  state.loggedIn = await LibraryAPI.isLoggedIn();
  if (state.loggedIn) {
    try {
      const items = await LibraryAPI.getItems();
      state.savedIds = new Set(items.map((item) => item.song._id));
    } catch (err) {
      state.savedIds = new Set();
    }
  }
  loadSongs();
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.q = searchInput.value.trim();
  state.page = 1;
  loadSongs();
});

prevBtn.addEventListener('click', () => {
  state.page -= 1;
  loadSongs();
});

nextBtn.addEventListener('click', () => {
  state.page += 1;
  loadSongs();
});

init();