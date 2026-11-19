// How a song's key is shown: just the note you hear as "do" (C, C#, D, Eb, E, F, F#, G, Ab, A,
// Bb, B), without the words major or minor. The key is saved as its main note plus major or
// minor, so for a minor key this works out the "do" note from the setting
// "In minor keys, the first note is called" (la by default: the do note is 3 half steps up).
const KeyNames = (() => {
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  function wrap(pc) {
    return ((pc % 12) + 12) % 12;
  }

  function minorBase() {
    try {
      return localStorage.getItem('songlens.minorBase') === 'do' ? 'do' : 'la';
    } catch (err) {
      return 'la';
    }
  }

  // The note heard as "do" for a saved key.
  function doPc(keyPc, mode, base = minorBase()) {
    return mode === 'minor' && base !== 'do' ? wrap(keyPc + 3) : wrap(keyPc);
  }

  // The saved main note for a chosen "do" note.
  function rootFor(doNote, mode, base = minorBase()) {
    return mode === 'minor' && base !== 'do' ? wrap(doNote + 9) : wrap(doNote);
  }

  function label(keyPc, mode, base = minorBase()) {
    return NAMES[doPc(keyPc, mode, base)];
  }

  return { NAMES, doPc, rootFor, label, minorBase };
})();
