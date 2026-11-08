// Interactive piano (C3 to B5). Highlights the notes of the active chord.
// Reacts only to the shared clock; clicking or tapping a key plays that note.
function createPianoView(container, notesLabel, chords) {
  const FIRST = 48; // C3
  const LAST = 83; // B5
  const WHITE_W = 28;
  const WHITE_H = 130;
  const BLACK_W = 18;
  const BLACK_H = 80;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

  const keys = new Map();
  let activeIndex = -1;
  let audioCtx = null;

  let whiteCount = 0;
  for (let midi = FIRST; midi <= LAST; midi += 1) {
    if (!BLACK_PITCH_CLASSES.has(midi % 12)) whiteCount += 1;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${whiteCount * WHITE_W} ${WHITE_H}`);
  svg.setAttribute('class', 'piano-svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Piano keyboard from C3 to B5. Select a key to hear it.');

  function playNote(midi) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.95);
    } catch (err) {
      // Sound is a bonus; the visuals still work without it.
    }
  }

  function makeKey(midi, x, width, height, kind) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('rx', 3);
    rect.setAttribute('class', `key ${kind}`);
    rect.setAttribute('data-midi', midi);
    rect.addEventListener('pointerdown', () => {
      playNote(midi);
      notesLabel.textContent = TimelineUtils.midiName(midi);
      rect.classList.add('pressed');
      setTimeout(() => rect.classList.remove('pressed'), 180);
    });
    keys.set(midi, rect);
    return rect;
  }

  // White keys first, black keys on top of them.
  const whiteX = new Map();
  let whiteIndex = 0;
  for (let midi = FIRST; midi <= LAST; midi += 1) {
    if (BLACK_PITCH_CLASSES.has(midi % 12)) continue;
    const x = whiteIndex * WHITE_W;
    whiteX.set(midi, x);
    svg.appendChild(makeKey(midi, x, WHITE_W, WHITE_H, 'white'));

    if (midi % 12 === 0) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x + WHITE_W / 2);
      label.setAttribute('y', WHITE_H - 8);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'key-label');
      label.textContent = TimelineUtils.midiName(midi);
      svg.appendChild(label);
    }
    whiteIndex += 1;
  }
  for (let midi = FIRST; midi <= LAST; midi += 1) {
    if (!BLACK_PITCH_CLASSES.has(midi % 12)) continue;
    const x = whiteX.get(midi - 1) + WHITE_W - BLACK_W / 2;
    svg.appendChild(makeKey(midi, x, BLACK_W, BLACK_H, 'black'));
  }

  container.replaceChildren(svg);
  notesLabel.textContent = 'No chord playing';

  function clearHighlights() {
    keys.forEach((key) => {
      key.classList.remove('chord');
      key.classList.remove('root');
      key.classList.remove('bass');
    });
  }

  function render(state) {
    const index = TimelineUtils.findActiveIndex(chords, state.time);
    if (index === activeIndex) return;
    activeIndex = index;

    clearHighlights();
    if (index === -1) {
      notesLabel.textContent = 'No chord playing';
      return;
    }

    const chord = chords[index];
    const tones = TimelineUtils.chordTones(chord);
    const names = [];
    tones.forEach((tone) => {
      const key = keys.get(tone.midi);
      if (!key) return;
      key.classList.add('chord');
      if (tone.role === 'root') key.classList.add('root');
      if (tone.role === 'bass') key.classList.add('bass');
      names.push(TimelineUtils.NOTE_NAMES[tone.midi % 12]);
    });
    notesLabel.textContent = `${TimelineUtils.chordSymbol(chord)}: ${names.join(' · ')}`;
  }

  return { render };
}