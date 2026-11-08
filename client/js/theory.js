// Music theory derived from the key. Nothing here is stored: Roman numerals and
// solfege are always calculated from the key and the chord's root and quality.
const Theory = (() => {
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Scale degree (with accidental) for each semitone above the tonic.
  const d = (acc, n) => ({ acc, n });
  const DEGREES = {
    major: [d('', 1), d('b', 2), d('', 2), d('b', 3), d('', 3), d('', 4),
            d('#', 4), d('', 5), d('b', 6), d('', 6), d('b', 7), d('', 7)],
    // Minor is numbered against the natural minor scale (i, ii, III, iv, v, VI, VII).
    minor: [d('', 1), d('b', 2), d('', 2), d('', 3), d('#', 3), d('', 4),
            d('b', 5), d('', 5), d('', 6), d('#', 6), d('', 7), d('#', 7)],
  };

  const QUALITY_SUFFIX = {
    maj: '',
    min: '',
    dim: '°',
    aug: '+',
    7: '7',
    maj7: 'maj7',
    min7: '7',
    sus2: 'sus2',
    sus4: 'sus4',
  };
  const LOWERCASE_QUALITIES = ['min', 'dim', 'min7'];

  // Moveable-do syllables for each semitone above the tonic.
  // "do-based": do is the tonic in both major and minor.
  const DO_BASED = ['do', 'ra', 're', 'me', 'mi', 'fa', 'fi', 'sol', 'le', 'la', 'te', 'ti'];
  // "la-based" minor: la is the tonic (la ti do re mi fa sol).
  const LA_BASED_MINOR = ['la', 'te', 'ti', 'do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si'];

  function hasKey(keyPc) {
    return Number.isInteger(keyPc) && keyPc >= 0 && keyPc <= 11;
  }

  function relative(pc, keyPc) {
    return (((pc - keyPc) % 12) + 12) % 12;
  }

  function degreeTable(mode) {
    return mode === 'minor' ? DEGREES.minor : DEGREES.major;
  }

  // For example "V7", "vi", "vii°", "I/3". Returns null when there is no key.
  function romanNumeral(chord, keyPc, mode) {
    if (!chord || !hasKey(keyPc)) return null;
    const table = degreeTable(mode);
    const degree = table[relative(chord.root, keyPc)];

    let numeral = ROMAN[degree.n];
    if (LOWERCASE_QUALITIES.includes(chord.quality)) numeral = numeral.toLowerCase();

    let text = degree.acc + numeral + (QUALITY_SUFFIX[chord.quality] || '');

    if (chord.bass !== null && chord.bass !== undefined && chord.bass !== chord.root) {
      const bassDegree = table[relative(chord.bass, keyPc)];
      text += `/${bassDegree.acc}${bassDegree.n}`;
    }
    return text;
  }

  // Moveable-do syllable for one pitch class (0 = C ... 11 = B).
  function solfege(pc, keyPc, mode, minorBase) {
    if (!hasKey(keyPc)) return null;
    const rel = relative(pc, keyPc);
    const laBased = mode === 'minor' && minorBase !== 'do';
    return (laBased ? LA_BASED_MINOR : DO_BASED)[rel];
  }

  // The syllables of the chord's own notes, root first. (A slash-chord bass is left out.)
  function chordSolfege(chord, keyPc, mode, minorBase) {
    if (!chord || !hasKey(keyPc)) return null;
    return TimelineUtils.chordTones(chord)
      .filter((tone) => tone.role !== 'bass')
      .map((tone) => solfege(tone.midi % 12, keyPc, mode, minorBase));
  }

  return { romanNumeral, solfege, chordSolfege };
})();

if (typeof module !== 'undefined') module.exports = Theory;