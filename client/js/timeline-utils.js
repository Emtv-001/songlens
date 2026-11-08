const TimelineUtils = (() => {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const QUALITY_SUFFIX = {
    maj: '',
    min: 'm',
    dim: 'dim',
    aug: 'aug',
    7: '7',
    maj7: 'maj7',
    min7: 'm7',
    sus2: 'sus2',
    sus4: 'sus4',
  };
  // Semitones above the root for each chord quality.
  const CHORD_INTERVALS = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    7: [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
  };

  // Chord symbols are derived from the stored root and quality, never stored as text.
  function chordSymbol(chord) {
    if (!chord) return '';
    let symbol = NOTE_NAMES[chord.root] + (QUALITY_SUFFIX[chord.quality] || '');
    if (chord.bass !== null && chord.bass !== undefined && chord.bass !== chord.root) {
      symbol += `/${NOTE_NAMES[chord.bass]}`;
    }
    return symbol;
  }

  // MIDI numbers: C4 = 60. Chord tones sit in the octave from C4, and a slash-chord
  // bass note goes in the octave below (C3 to B3).
  function chordTones(chord) {
    if (!chord) return [];
    const intervals = CHORD_INTERVALS[chord.quality] || CHORD_INTERVALS.maj;
    const rootMidi = 60 + chord.root;
    const tones = intervals.map((interval, i) => ({
      midi: rootMidi + interval,
      role: i === 0 ? 'root' : 'tone',
    }));
    if (chord.bass !== null && chord.bass !== undefined && chord.bass !== chord.root) {
      tones.push({ midi: 48 + chord.bass, role: 'bass' });
    }
    return tones;
  }

  function midiName(midi) {
    return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  // Events must be sorted by start. Returns the index of the event that contains
  // `time` (start <= time < end), or -1 if none does.
  function findActiveIndex(events, time) {
    let low = 0;
    let high = events.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (events[mid].start <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found === -1) return -1;
    return time < events[found].end ? found : -1;
  }

  function formatTime(seconds) {
    const safe = Math.max(seconds || 0, 0);
    const minutes = Math.floor(safe / 60);
    const rest = (safe - minutes * 60).toFixed(1).padStart(4, '0');
    return `${minutes}:${rest}`;
  }

  return { NOTE_NAMES, chordSymbol, chordTones, midiName, findActiveIndex, formatTime };
})();

if (typeof module !== 'undefined') module.exports = TimelineUtils;