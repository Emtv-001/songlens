// Chord display by song phrase. It shows one phrase at a time, in the order the song plays them:
// every chord of the phrase, passing chords included, in its place. When the phrase ends, the card
// slides up and the next phrase comes in. A phrase the song repeats is shown again each time.
// Phrases follow the synced lyric lines when the song has them; without lyrics the chords are
// grouped by where the music pauses or holds a chord.
// getSubLabel(chord) is optional and returns small text under a chord (the Roman numeral).
function createChordSummaryView(container, chords, lyrics, onSeek, getSubLabel, flats) {
  if (!document.getElementById('chord-summary-style')) {
    const style = document.createElement('style');
    style.id = 'chord-summary-style';
    style.textContent = `
      .chord-strip.chord-summary { height: auto; max-height: none; overflow: visible; }
      .chord-stage { display: grid; overflow: hidden; border-radius: 12px; }
      .chord-section { grid-area: 1 / 1; border: 1px solid var(--teal, #46b9b0); box-shadow: 0 0 0 1px var(--teal, #46b9b0); border-radius: 12px; padding: 0.7rem 0.9rem; background: var(--surface, #19233d); transition: transform 0.45s ease, opacity 0.45s ease; }
      .chord-section.enter-up { transform: translateY(100%); opacity: 0; }
      .chord-section.enter-down { transform: translateY(-100%); opacity: 0; }
      .chord-section.leave-up { transform: translateY(-100%); opacity: 0; }
      .chord-section.leave-down { transform: translateY(100%); opacity: 0; }
      @media (prefers-reduced-motion: reduce) { .chord-section { transition: none; } }
      .chord-section-head { all: unset; cursor: pointer; font-size: 0.85rem; color: var(--soft-grey, #a9b2c5); display: block; }
      .chord-section-head:focus-visible { outline: 2px solid var(--teal, #46b9b0); outline-offset: 2px; }
      .chord-section-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
      .chord-chip { display: inline-flex; flex-direction: column; align-items: center; min-width: 3.2rem; padding: 0.35rem 0.7rem; border-radius: 10px; background: var(--midnight, #10172a); color: var(--ivory, #f7f4ec); }
      .chord-chip .chord-name { font-weight: 700; font-size: 1.05rem; }
      .chord-chip .chord-roman { font-size: 0.75rem; color: var(--soft-grey, #a9b2c5); }
      .chord-chip.now { background: var(--teal, #7c3aed); color: var(--on-primary, #ffffff); }
      .chord-chip.now .chord-roman { color: var(--on-primary, #ffffff); }
      .chord-section-bar { height: 3px; margin-top: 0.6rem; background: rgba(169, 178, 197, 0.25); border-radius: 2px; }
      .chord-section-bar i { display: block; height: 100%; width: 0; background: var(--teal, #46b9b0); border-radius: 2px; }
    `;
    document.head.appendChild(style);
  }

  const SLIDE_MS = 500;
  const EDGE = 0.3; // seconds a chord may start before the line it belongs to
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const whole = (seconds) => {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  const stage = document.createElement('div');
  stage.className = 'chord-stage';
  container.classList.add('chord-summary');
  container.replaceChildren(stage);

  const songEnd = chords.length ? chords[chords.length - 1].end : 0;

  // phrase boundaries from the lyric lines
  function phrasesFromLyrics() {
    const starts = lyrics
      .map((l) => l.start)
      .filter((t) => typeof t === 'number')
      .sort((a, b) => a - b);
    const cuts = [];
    if (starts.length === 0) return null;
    if (starts[0] > EDGE) cuts.push(0); // music before the first line
    starts.forEach((t) => {
      if (cuts.length === 0 || t - cuts[cuts.length - 1] > 0.05) cuts.push(t);
    });
    return cuts.map((start, i) => ({ start, end: i + 1 < cuts.length ? cuts[i + 1] : Math.max(songEnd, start) }));
  }

  // without lyrics: a held chord, or 8 chords, ends a phrase
  function phrasesFromChords() {
    const lengths = chords.map((c) => c.end - c.start).sort((a, b) => a - b);
    const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 1;
    const out = [];
    let from = 0;
    chords.forEach((c, i) => {
      const count = i - from + 1;
      const held = c.end - c.start >= median * 1.6 && count >= 3;
      if (held || count >= 8 || i === chords.length - 1) {
        out.push({ start: chords[from].start, end: c.end });
        from = i + 1;
      }
    });
    return out;
  }

  function buildPhrases() {
    const spans = (lyrics && lyrics.length ? phrasesFromLyrics() : null) || phrasesFromChords();
    const phrases = [];
    spans.forEach((span, i) => {
      const last = i === spans.length - 1;
      const inside = chords.filter(
        (c) => c.start >= span.start - EDGE && (last ? true : c.start < span.end - EDGE)
      );
      let list = inside;
      // a chord still ringing when the phrase opens belongs at its start
      if (list.length === 0 || list[0].start > span.start + 0.5) {
        const before = chords.filter((c) => c.start < span.start - EDGE && c.end > span.start + 0.2);
        if (before.length) list = [before[before.length - 1], ...list];
      }
      if (list.length) phrases.push({ start: span.start, end: span.end, chords: list });
    });
    return phrases;
  }

  const phrases = buildPhrases();

  function makeChip(chord) {
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
    return chip;
  }

  function buildCard(index) {
    const phrase = phrases[index];
    const card = document.createElement('div');
    card.className = 'chord-section';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'chord-section-head';
    head.textContent = `Phrase ${index + 1} of ${phrases.length} · ${whole(phrase.start)} to ${whole(phrase.end)}`;
    head.setAttribute('aria-label', `${head.textContent}. Select to jump to ${whole(phrase.start)}.`);
    head.addEventListener('click', () => onSeek(phrase.start));
    card.appendChild(head);

    const chipsEl = document.createElement('div');
    chipsEl.className = 'chord-section-chips';
    const chipNodes = phrase.chords.map((chord) => {
      const chip = makeChip(chord);
      chipsEl.appendChild(chip);
      return chip;
    });
    card.appendChild(chipsEl);

    const bar = document.createElement('div');
    bar.className = 'chord-section-bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    card.appendChild(bar);

    return { index, phrase, el: card, fill, chipNodes };
  }

  let current = null;

  function show(index) {
    const next = buildCard(index);
    if (!current) {
      stage.replaceChildren(next.el);
    } else {
      const forward = index > current.index;
      const old = current.el;
      if (reduceMotion) {
        stage.replaceChildren(next.el);
      } else {
        next.el.classList.add(forward ? 'enter-up' : 'enter-down');
        stage.appendChild(next.el);
        void next.el.offsetWidth; // start the slide from the hidden position
        next.el.classList.remove('enter-up', 'enter-down');
        old.classList.add(forward ? 'leave-up' : 'leave-down');
        setTimeout(() => old.remove(), SLIDE_MS + 50);
      }
    }
    current = next;
  }

  function indexAt(time) {
    let found = 0;
    phrases.forEach((p, i) => {
      if (time >= p.start - 1e-6) found = i;
    });
    return found;
  }

  function render(state) {
    if (!phrases.length) return;
    const index = indexAt(state.time);
    if (!current || current.index !== index) show(index);

    const { phrase, fill, chipNodes } = current;
    const span = phrase.end - phrase.start;
    const share = span > 0 ? Math.min(1, Math.max(0, (state.time - phrase.start) / span)) : 0;
    fill.style.width = `${(share * 100).toFixed(1)}%`;

    // the box lit is the last chord of the phrase that has started, so the order is always kept
    let now = -1;
    phrase.chords.forEach((c, i) => {
      if (c.start <= state.time + 1e-6) now = i;
    });
    if (now === -1 && state.time >= phrase.start) now = 0;
    chipNodes.forEach((chip, i) => chip.classList.toggle('now', i === now));
  }

  return { render };
}
