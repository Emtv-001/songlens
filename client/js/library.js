const grid = document.getElementById('song-grid');
const statusEl = document.getElementById('status');

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = `status-text${isError ? ' error' : ''}`;
}

function updateCount() {
  const count = grid.children.length;
  if (count === 0) {
    setStatus('Your library is empty. Browse the song library and save some songs.');
  } else {
    setStatus(`${count} saved song${count === 1 ? '' : 's'}`);
  }
}

function makeCard(item) {
  const song = item.song;
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

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small btn-outline';
  button.textContent = 'Remove';

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await LibraryAPI.remove(song._id);
      if (response.ok) {
        li.remove();
        updateCount();
      } else {
        setStatus('Could not remove the song. Please try again.', true);
        button.disabled = false;
      }
    } catch (err) {
      setStatus('Could not reach the server.', true);
      button.disabled = false;
    }
  });

  actions.appendChild(button);
  li.append(title, artist, desc, actions);
  return li;
}

async function init() {
  setStatus('Loading your library…');

  const loggedIn = await LibraryAPI.isLoggedIn();
  if (!loggedIn) {
    window.location.href = '/login.html';
    return;
  }

  try {
    const items = await LibraryAPI.getItems();
    items.forEach((item) => grid.appendChild(makeCard(item)));
    updateCount();
  } catch (err) {
    setStatus('Could not load your library. Please try again.', true);
  }
}

init();