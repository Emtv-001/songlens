// Chord progression summary: one card per section of the song, showing the progression that
// repeats ("Cm - Ab - Bb, repeats about 29 times") instead of every single chord. It follows
// the shared clock: the card being played is highlighted, with a progress bar and the chord
// that is sounding now. Select a card heading to jump to that part of the song.
// getSubLabel(chord) is optional and returns small text under a chord (the Roman numeral).
function createChordSummaryView(container, sections, chords, onSeek, getSubLabel, flats) {
  if (!document.getElementById('chord-summary-style')) {
    const style = document.createElement('style');
    style.id = 'chord-summary-style';
    style.textContent = `
      .chord-strip.chord-summary { height: auto; max-height: none; overflow: visible; }
      .chord-summary-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .chord-section { border: 1px solid var(--soft-grey, #a9b2c5); border-radius: 12px; padding: 0.6rem 0.8rem; background: var(--surface, #19233d); position: relative; overflow: hidden; }
      .chord-section.active { border-color: var(--teal, #46b9b0); box-shadow: 0 0 0 1px var(--teal, #46b9b0); }
      .chord-section-head { all: unset; cursor: pointer; font-size: 0.85rem; color: var(--soft-grey, #a9b2c5); display: block; }
      .chord-section-head:focus-visible { outline: 2px solid var(--teal, #46b9b0); outline-offset: 2px; }
      .chord-section-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.4rem; }
      .chord-chip { display: inline-flex; flex-direction: column; align-items: center; min-width: 3rem; padding: 0.3rem 0.6rem; border-radius: 10px; background: var(--midnight, #10172a); color: var(--ivory, #f7f4ec); }
      .chord-chip .chord-name { font-weight: 700; }
      .chord-chip .chord-roman { font-size: 0.75rem; color: var(--soft-grey, #a9b2c5); }
      .chord-chip.now { background: var(--teal, #46b9b0); color: var(--midnight, #10172a); }
      .chord-chip.now .chord-roman { color: var(--midnight, #10172a); }
      .chord-section-bar { height: 3px; margin-top: 0.5rem; background: rgba(169, 178, 197, 0.25); border-radius: 2px; }
      .chord-section-bar i { display: block; height: 100%; width: 0; background: var(--teal, #46b9b0); border-radius: 2px; }
    `;
    document.head.appendChild(style);
  }

  const whole = (seconds) => {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const list = document.createElement('div');
  list.className = 'chord-summary-list';
  const cards = [];

  sections.forEach((section) => {
    const card = document.createElement('div');
    card.className = 'chord-section';

    const isLoop = section.kind === 'loop' && Array.isArray(section.pattern) && section.pattern.length > 0;
    let shown;
    if (isLoop) {
      shown = section.pattern;
    } else {
      // no repeating pattern: list the chords in order, without immediate repeats
      shown = [];
      chords.forEach((c) => {
        if (c.start < section.start - 1e-6 || c.start >= section.end - 1e-6) return;
        const last = shown[shown.length - 1];
        if (!last || last.root !== c.root || last.quality !== c.quality) shown.push(c);
      });
    }
    const limit = 16;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'chord-section-head';
    const detail = isLoop
      ? `repeats about ${Math.max(1, Math.round(section.cycles || 1))} time${Math.round(section.cycles || 1) === 1 ? '' : 's'}`
      : 'changing chords, no repeating pattern';
    head.textContent = `${whole(section.start)} to ${whole(section.end)} · ${detail}`;
    head.setAttribute('aria-label', `${head.textContent}. Select to jump to ${whole(section.start)}.`);
    head.addEventListener('click', () => onSeek(section.start));
    card.appendChild(head);

    const chips = document.createElement('div');
    chips.className = 'chord-section-chips';
    const chipNodes = [];
    shown.slice(0, limit).forEach((chord) => {
      const chip = document.createElement('span');
      chip.className = 'chord-chip';
      const name = document.createElement('span');
      name.className = 'chord-name';
      name.textContent = TimelineUtils.chordSymbol(chord, flats);
      chip.appendChild(name);
      const sub = getSubLabel ? getSubLabel(chord) : null;
      if (sub) {
        const roman = document.createElement('span');
        roman.className = 'chord-roman';
        roman.textContent = sub;
        chip.appendChild(roman);
      }
      chips.appendChild(chip);
      chipNodes.push({ chip, chord });
    });
    if (shown.length > limit) {
      const more = document.createElement('span');
      more.className = 'chord-roman';
      more.textContent = `and ${shown.length - limit} more`;
      chips.appendChild(more);
    }
    card.appendChild(chips);

    const bar = document.createElement('div');
    bar.className = 'chord-section-bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    card.appendChild(bar);

    list.appendChild(card);
    cards.push({ section, card, fill, chipNodes, isLoop });
  });

  container.classList.add('chord-summary');
  container.replaceChildren(list);

  let activeSection = -1;
  let activeChip = null;

  function render(state) {
    let index = cards.findIndex((c, i) => state.time >= c.section.start && (state.time < c.section.end || i === cards.length - 1));
    if (state.time < (cards[0] ? cards[0].section.start : 0)) index = -1;

    if (index !== activeSection) {
      if (activeSection !== -1) {
        cards[activeSection].card.classList.remove('active');
        cards[activeSection].card.removeAttribute('aria-current');
        cards[activeSection].fill.style.width = '0';
      }
      if (index !== -1) {
        cards[index].card.classList.add('active');
        cards[index].card.setAttribute('aria-current', 'true');
      }
      activeSection = index;
      if (activeChip) {
        activeChip.classList.remove('now');
        activeChip = null;
      }
    }
    if (index === -1) return;

    const { section, fill, chipNodes } = cards[index];
    const span = section.end - section.start;
    const share = span > 0 ? Math.min(1, Math.max(0, (state.time - section.start) / span)) : 0;
    fill.style.width = `${(share * 100).toFixed(1)}%`;

    const current = TimelineUtils.findActiveIndex(chords, state.time);
    const chord = current === -1 ? null : chords[current];
    let found = null;
    if (chord) {
      const match = chipNodes.find((n) => n.chord.root === chord.root && n.chord.quality === chord.quality);
      found = match ? match.chip : null;
    }
    if (found !== activeChip) {
      if (activeChip) activeChip.classList.remove('now');
      if (found) found.classList.add('now');
      activeChip = found;
    }
  }

  return { render };
}
