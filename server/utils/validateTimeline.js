const crypto = require('crypto');

const QUALITIES = ['maj', 'min', 'dim', 'aug', '7', 'maj7', 'min7', 'sus2', 'sus4'];
const MODES = ['major', 'minor'];
const MAX_EVENTS = 2000;
const MAX_NOTES = 5000;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPitchClass(v) {
  return Number.isInteger(v) && v >= 0 && v <= 11;
}

function makeIdKeeper() {
  const seen = new Set();
  return (raw) => {
    let id = typeof raw === 'string' && /^[\w-]{1,64}$/.test(raw) ? raw : null;
    if (!id || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return id;
  };
}

function cleanTimes(item, label, index) {
  if (!item || typeof item !== 'object') return `${label} #${index + 1} is not valid`;
  if (!isNum(item.start) || !isNum(item.end)) {
    return `${label} #${index + 1}: start and end must be numbers (seconds)`;
  }
  if (item.start < 0 || item.end <= item.start) {
    return `${label} #${index + 1}: end must be greater than start, and start cannot be negative`;
  }
  if (item.end > 86400) return `${label} #${index + 1}: time is out of range`;
  return null;
}

function validateTimeline(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };

  const out = {};

  // Key
  if (body.keyPc === null || body.keyPc === undefined) {
    out.keyPc = null;
  } else if (isPitchClass(body.keyPc)) {
    out.keyPc = body.keyPc;
  } else {
    return { error: 'keyPc must be a whole number from 0 (C) to 11 (B)' };
  }

  if (body.mode === null || body.mode === undefined || body.mode === '') {
    out.mode = null;
  } else if (MODES.includes(body.mode)) {
    out.mode = body.mode;
  } else {
    return { error: 'mode must be "major" or "minor"' };
  }

  // Tempo
  if (body.bpm === null || body.bpm === undefined) {
    out.bpm = null;
  } else if (isNum(body.bpm) && body.bpm >= 20 && body.bpm <= 300) {
    out.bpm = body.bpm;
  } else {
    return { error: 'bpm must be a number between 20 and 300' };
  }

  if (body.timeSignature === undefined || body.timeSignature === null) {
    out.timeSignature = '4/4';
  } else if (typeof body.timeSignature === 'string' && /^\d{1,2}\/(2|4|8|16)$/.test(body.timeSignature)) {
    out.timeSignature = body.timeSignature;
  } else {
    return { error: 'timeSignature must look like 4/4 or 6/8' };
  }

  // Lyrics
  const lyrics = body.lyrics === undefined ? [] : body.lyrics;
  if (!Array.isArray(lyrics)) return { error: 'lyrics must be a list' };
  if (lyrics.length > MAX_EVENTS) return { error: `Too many lyric lines (max ${MAX_EVENTS})` };
  const lyricId = makeIdKeeper();
  out.lyrics = [];
  for (let i = 0; i < lyrics.length; i += 1) {
    const item = lyrics[i];
    const problem = cleanTimes(item, 'Lyric', i);
    if (problem) return { error: problem };
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text || text.length > 300) {
      return { error: `Lyric #${i + 1}: text is required (max 300 characters)` };
    }
    out.lyrics.push({ id: lyricId(item.id), start: item.start, end: item.end, text });
  }
  out.lyrics.sort((a, b) => a.start - b.start);

  // Chords
  const chords = body.chords === undefined ? [] : body.chords;
  if (!Array.isArray(chords)) return { error: 'chords must be a list' };
  if (chords.length > MAX_EVENTS) return { error: `Too many chords (max ${MAX_EVENTS})` };
  const chordId = makeIdKeeper();
  out.chords = [];
  for (let i = 0; i < chords.length; i += 1) {
    const item = chords[i];
    const problem = cleanTimes(item, 'Chord', i);
    if (problem) return { error: problem };
    if (!isPitchClass(item.root)) {
      return { error: `Chord #${i + 1}: root must be a whole number from 0 (C) to 11 (B)` };
    }
    if (!QUALITIES.includes(item.quality)) {
      return { error: `Chord #${i + 1}: quality must be one of ${QUALITIES.join(', ')}` };
    }
    let bass = null;
    if (item.bass !== null && item.bass !== undefined) {
      if (!isPitchClass(item.bass)) {
        return { error: `Chord #${i + 1}: bass must be a whole number from 0 to 11` };
      }
      bass = item.bass;
    }
    out.chords.push({
      id: chordId(item.id),
      start: item.start,
      end: item.end,
      root: item.root,
      quality: item.quality,
      bass,
    });
  }
  out.chords.sort((a, b) => a.start - b.start);

  // Melody (only touched when the request includes it, so older clients cannot wipe it)
  if (body.melody !== undefined) {
    const melody = body.melody;
    if (!Array.isArray(melody)) return { error: 'melody must be a list' };
    if (melody.length > MAX_NOTES) return { error: `Too many melody notes (max ${MAX_NOTES})` };
    const noteId = makeIdKeeper();
    out.melody = [];
    for (let i = 0; i < melody.length; i += 1) {
      const item = melody[i];
      const problem = cleanTimes(item, 'Note', i);
      if (problem) return { error: problem };
      if (!Number.isInteger(item.midi) || item.midi < 0 || item.midi > 127) {
        return { error: `Note #${i + 1}: pitch must be a whole number from 0 to 127` };
      }
      out.melody.push({ id: noteId(item.id), start: item.start, end: item.end, midi: item.midi });
    }
    out.melody.sort((a, b) => a.start - b.start);
  }

  // Chord sections found by an analysis (only touched when the request includes them)
  if (body.sections !== undefined) {
    const list = body.sections;
    if (!Array.isArray(list) || list.length > 200) return { error: 'sections must be a list of at most 200' };
    out.sections = [];
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      const pattern = Array.isArray(s && s.pattern) ? s.pattern : null;
      const ok =
        s &&
        (s.kind === 'loop' || s.kind === 'free') &&
        isNum(s.start) &&
        isNum(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        pattern &&
        pattern.length <= 8 &&
        pattern.every((p) => p && isPitchClass(p.root) && QUALITIES.includes(p.quality));
      if (!ok) return { error: `Section #${i + 1} is not valid` };
      out.sections.push({
        kind: s.kind,
        start: s.start,
        end: s.end,
        cycles: isNum(s.cycles) ? s.cycles : null,
        pattern: pattern.map((p) => ({ root: p.root, quality: p.quality })),
      });
    }
  }

  return { value: out };
}

module.exports = { validateTimeline, QUALITIES, MODES };