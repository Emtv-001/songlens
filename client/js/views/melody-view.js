// Melody lane: a simple piano roll. Higher notes sit higher, longer notes are wider.
// It never keeps its own timer. It only reacts to states from the shared clock.
// `flats` chooses Bb over A# when naming notes.
function createMelodyView(container, notes, onSeek, flats) {
  const PX_PER_SECOND = 40;
  const ROW_HEIGHT = 12;
  const MIN_NOTE_WIDTH = 8;
  const MIN_ROWS = 13; // always at least an octave tall

  const lowest = Math.min(...notes.map((n) => n.midi));
  const highest = Math.max(...notes.map((n) => n.midi));
  const spare = Math.max(MIN_ROWS - (highest - lowest + 1), 0);
  const bottom = Math.max(lowest - Math.floor(spare / 2) - 1, 0);
  const top = Math.min(highest + Math.ceil(spare / 2) + 1, 127);
  const rows = top - bottom + 1;

  const track = document.createElement('div');
  track.className = 'melody-track';
  track.style.height = `${rows * ROW_HEIGHT}px`;

  const playhead = document.createElement('div');
  playhead.className = 'melody-playhead';
  playhead.setAttribute('aria-hidden', 'true');

  const blocks = [];
  let activeIndex = -1;
  let trackSeconds = 0;

  function trackLength(duration) {
    const lastEnd = notes.reduce((max, n) => Math.max(max, n.end), 0);
    return Math.max(duration || 0, lastEnd);
  }

  function setTrackWidth(seconds) {
    trackSeconds = seconds;
    track.style.width = `${Math.ceil(seconds * PX_PER_SECOND) + 40}px`;
  }

  notes.forEach((note) => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'melody-note';
    block.style.left = `${note.start * PX_PER_SECOND}px`;
    block.style.width = `${Math.max((note.end - note.start) * PX_PER_SECOND - 2, MIN_NOTE_WIDTH)}px`;
    block.style.top = `${(top - note.midi) * ROW_HEIGHT}px`;
    block.style.height = `${ROW_HEIGHT - 2}px`;

    const name = TimelineUtils.midiName(note.midi, flats);
    block.title = name;
    block.setAttribute(
      'aria-label',
      `Note ${name} at ${TimelineUtils.formatTime(note.start)}. Select to jump here.`
    );
    block.addEventListener('click', () => onSeek(note.start));

    track.appendChild(block);
    blocks.push(block);
  });

  track.appendChild(playhead);
  container.replaceChildren(track);
  setTrackWidth(trackLength(0));

  function followPlayhead(x) {
    const left = container.scrollLeft;
    const width = container.clientWidth;
    if (x < left || x > left + width * 0.85) {
      container.scrollLeft = Math.max(x - width * 0.25, 0);
    }
  }

  function render(state) {
    const needed = trackLength(state.duration);
    if (needed !== trackSeconds) setTrackWidth(needed);

    const x = state.time * PX_PER_SECOND;
    playhead.style.transform = `translateX(${x}px)`;

    const index = TimelineUtils.findActiveIndex(notes, state.time);
    if (index !== activeIndex) {
      if (activeIndex !== -1 && blocks[activeIndex]) {
        blocks[activeIndex].classList.remove('active');
        blocks[activeIndex].removeAttribute('aria-current');
      }
      if (index !== -1) {
        blocks[index].classList.add('active');
        blocks[index].setAttribute('aria-current', 'true');
      }
      activeIndex = index;
    }

    followPlayhead(x);
  }

  return { render };
}