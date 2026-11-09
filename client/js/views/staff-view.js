// Treble staff for the melody. Notes sit at their time position (like the other lanes),
// with a moving cursor. Each note has a thin bar showing how long it lasts.
// It never keeps its own timer. It only reacts to states from the shared clock.
// `flats` decides whether black keys are written as flats (Bb) or sharps (A#).
function createStaffView(container, notes, onSeek, flats) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PX_PER_SECOND = 60;
  const HALF = 6; // half a staff space, in pixels (one letter step)
  const PAD = 10;
  const LEFT = 20;
  const BOTTOM_LINE = 30; // E4
  const TOP_LINE = 38; // F5
  const HEAD_RX = 7.5;
  const HEAD_RY = 5.5;

  const positions = notes.map((note) => TimelineUtils.staffPosition(note.midi, flats));
  const steps = positions.map((p) => p.step);
  const lowStep = Math.min(BOTTOM_LINE, ...steps) - 3;
  const highStep = Math.max(TOP_LINE, ...steps) + 3;
  const height = PAD * 2 + (highStep - lowStep) * HALF;
  const yOf = (step) => PAD + (highStep - step) * HALF;

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  // ---- Fixed clef on the left (does not scroll) ----
  const clefBox = document.createElement('div');
  clefBox.className = 'staff-clef';
  const clefSvg = svgEl('svg', {
    width: 44,
    height,
    viewBox: `0 0 44 ${height}`,
    'aria-hidden': 'true',
  });
  for (let step = BOTTOM_LINE; step <= TOP_LINE; step += 2) {
    clefSvg.appendChild(svgEl('line', { x1: 0, x2: 44, y1: yOf(step), y2: yOf(step), class: 'staff-line' }));
  }
  const clef = svgEl('text', {
    x: 6,
    y: yOf(32) + HALF * 1.6, // the clef curls around the G line
    class: 'staff-clef-glyph',
    'font-size': HALF * 2 * 4.6,
  });
  clef.textContent = '\u{1D11E}';
  clefSvg.appendChild(clef);
  clefBox.appendChild(clefSvg);

  // ---- Scrolling lane ----
  const lane = document.createElement('div');
  lane.className = 'staff-lane';
  lane.setAttribute('tabindex', '0');
  lane.setAttribute('aria-label', 'Melody on a treble staff');

  const svg = svgEl('svg', { class: 'staff-svg', height, 'aria-label': 'Treble staff' });
  const lines = svgEl('g', {});
  const body = svgEl('g', {});
  svg.append(lines, body);

  const noteGroups = [];
  let activeIndex = -1;
  let trackSeconds = 0;

  function trackLength(duration) {
    const lastEnd = notes.reduce((max, n) => Math.max(max, n.end), 0);
    return Math.max(duration || 0, lastEnd);
  }

  function setWidth(seconds) {
    trackSeconds = seconds;
    const width = Math.ceil(seconds * PX_PER_SECOND) + LEFT + 60;
    svg.setAttribute('width', width);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    lines.replaceChildren();
    for (let step = BOTTOM_LINE; step <= TOP_LINE; step += 2) {
      lines.appendChild(svgEl('line', { x1: 0, x2: width, y1: yOf(step), y2: yOf(step), class: 'staff-line' }));
    }
  }

  notes.forEach((note, i) => {
    const { step, accidental } = positions[i];
    const x = LEFT + note.start * PX_PER_SECOND;
    const y = yOf(step);
    const name = TimelineUtils.midiName(note.midi, flats);

    const group = svgEl('g', {
      class: 'staff-note',
      role: 'button',
      tabindex: '0',
      'aria-label': `Note ${name} at ${TimelineUtils.formatTime(note.start)}. Select to jump here.`,
    });

    // How long the note lasts.
    const length = Math.max((note.end - note.start) * PX_PER_SECOND, HEAD_RX * 2);
    group.appendChild(svgEl('line', { x1: x, x2: x + length, y1: y, y2: y, class: 'staff-duration' }));

    // Ledger lines below and above the staff.
    for (let s = BOTTOM_LINE - 2; s >= step; s -= 2) {
      group.appendChild(svgEl('line', { x1: x - 11, x2: x + 11, y1: yOf(s), y2: yOf(s), class: 'staff-ledger' }));
    }
    for (let s = TOP_LINE + 2; s <= step; s += 2) {
      group.appendChild(svgEl('line', { x1: x - 11, x2: x + 11, y1: yOf(s), y2: yOf(s), class: 'staff-ledger' }));
    }

    // Stem: up for notes below the middle line, down for the others.
    const stemUp = step < 34;
    const stemX = stemUp ? x + HEAD_RX - 1 : x - HEAD_RX + 1;
    const stemEnd = stemUp ? y - HALF * 7 : y + HALF * 7;
    group.appendChild(svgEl('line', { x1: stemX, x2: stemX, y1: y, y2: stemEnd, class: 'staff-stem' }));

    group.appendChild(
      svgEl('ellipse', {
        cx: x,
        cy: y,
        rx: HEAD_RX,
        ry: HEAD_RY,
        transform: `rotate(-20 ${x} ${y})`,
        class: 'staff-head',
      })
    );

    if (accidental) {
      const sign = svgEl('text', {
        x: x - HEAD_RX - 3,
        y: y + 4,
        'text-anchor': 'end',
        class: 'staff-accidental',
        'font-size': 16,
      });
      sign.textContent = accidental === '#' ? '\u266F' : '\u266D';
      group.appendChild(sign);
    }

    // A larger invisible target makes small notes easy to click.
    group.appendChild(
      svgEl('rect', { x: x - 12, y: y - 12, width: Math.max(length, 24), height: 24, class: 'staff-hit' })
    );

    group.addEventListener('click', () => onSeek(note.start));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSeek(note.start);
      }
    });

    body.appendChild(group);
    noteGroups.push(group);
  });

  const cursor = svgEl('line', { x1: 0, x2: 0, y1: 0, y2: height, class: 'staff-cursor' });
  svg.appendChild(cursor);

  lane.appendChild(svg);
  container.replaceChildren(clefBox, lane);
  setWidth(trackLength(0));

  function followCursor(x) {
    const left = lane.scrollLeft;
    const width = lane.clientWidth;
    if (x < left || x > left + width * 0.85) {
      lane.scrollLeft = Math.max(x - width * 0.25, 0);
    }
  }

  function render(state) {
    const needed = trackLength(state.duration);
    if (needed !== trackSeconds) setWidth(needed);

    const x = LEFT + state.time * PX_PER_SECOND;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);

    const index = TimelineUtils.findActiveIndex(notes, state.time);
    if (index !== activeIndex) {
      if (activeIndex !== -1 && noteGroups[activeIndex]) {
        noteGroups[activeIndex].classList.remove('active');
        noteGroups[activeIndex].removeAttribute('aria-current');
      }
      if (index !== -1) {
        noteGroups[index].classList.add('active');
        noteGroups[index].setAttribute('aria-current', 'true');
      }
      activeIndex = index;
    }

    followCursor(x);
  }

  return { render };
}