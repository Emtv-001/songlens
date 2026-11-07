// Chord timeline: one block per chord, sized by duration, with a moving playhead.
// It never keeps its own timer. It only reacts to states from the shared clock.
function createChordView(container, chords, onSeek) {
  const PX_PER_SECOND = 40;
  const MIN_BLOCK_WIDTH = 34;

  const track = document.createElement('div');
  track.className = 'chord-track';
  const playhead = document.createElement('div');
  playhead.className = 'chord-playhead';
  playhead.setAttribute('aria-hidden', 'true');

  const blocks = [];
  let activeIndex = -1;
  let trackSeconds = 0;

  function trackLength(duration) {
    const lastEnd = chords.length ? chords[chords.length - 1].end : 0;
    return Math.max(duration || 0, lastEnd);
  }

  function setTrackWidth(seconds) {
    trackSeconds = seconds;
    track.style.width = `${Math.ceil(seconds * PX_PER_SECOND) + 40}px`;
  }

  chords.forEach((chord, index) => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'chord-block';
    block.style.left = `${chord.start * PX_PER_SECOND}px`;
    block.style.width = `${Math.max((chord.end - chord.start) * PX_PER_SECOND - 4, MIN_BLOCK_WIDTH)}px`;

    const symbol = TimelineUtils.chordSymbol(chord);
    block.textContent = symbol;
    block.setAttribute(
      'aria-label',
      `Chord ${symbol} at ${TimelineUtils.formatTime(chord.start)}. Select to jump here.`
    );
    block.addEventListener('click', () => onSeek(chord.start));

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

    const index = TimelineUtils.findActiveIndex(chords, state.time);
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