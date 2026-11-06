const grid = document.getElementById('song-grid');
const statusEl = document.getElementById('status');
const pager = document.getElementById('pager');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');

const state = { page: 1, limit: 12, q: '' };

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
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

  li.append(title, artist, desc);
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

loadSongs();