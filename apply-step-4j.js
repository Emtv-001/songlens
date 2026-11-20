// Step 4j: find bass notes so slash chords such as D/F# appear.
const fs = require('fs');
const path = require('path');
const root = process.cwd();

function read(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) throw new Error('Missing file: ' + rel + ' (run this from the songlens folder)');
  const raw = fs.readFileSync(full, 'utf8');
  return { full, crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n'), rel };
}
function swap(file, from, to) {
  const n = file.text.split(from).length - 1;
  if (n !== 1) throw new Error('Could not apply to ' + file.rel + ' (expected 1 match, found ' + n + '): ' + from.split('\n')[0] + (file.rel.endsWith('.py') ? '  (Step 4i must be applied first)' : ''));
  file.text = file.text.replace(from, () => to);
}
function save(file) {
  fs.writeFileSync(file.full, file.crlf ? file.text.replace(/\n/g, '\r\n') : file.text);
}

const BLOCK = `# bass notes (slash chords such as D/F#)
BASS_LOW_HZ = 36.0
BASS_HIGH_HZ = 125.0
BASS_WINDOW = 16384          # long window: low notes sit only a few Hz apart
BASS_HOP = 4096
BASS_SHARE = 0.6             # how much of a chord one bass note must hold, if it is a chord note
BASS_SHARE_OUTSIDE = 0.75    # ... and if it is not a note of the chord
BASS_MIN_FRAMES = 3
BASS_ENERGY_SHARE = 0.4      # and its share of all the low sound, so a drum thump is not taken for a bass note


def bass_frames(x):
    """For every ~0.19 s: how strongly each of the 12 notes sounds in the bass register."""
    chunk = CHUNK_SECONDS * TARGET_SR
    all_times, all_weights = [], []
    for begin in range(0, len(x), chunk):
        part = x[begin:begin + chunk]
        if len(part) < BASS_WINDOW // 2:
            break
        freqs, times, spec = signal.stft(part, fs=TARGET_SR, nperseg=BASS_WINDOW, noverlap=BASS_WINDOW - BASS_HOP)
        keep = (freqs >= BASS_LOW_HZ) & (freqs <= BASS_HIGH_HZ)
        freqs, mag = freqs[keep], np.abs(spec[keep])
        harmonic = ndimage.median_filter(mag, size=(1, 5))
        percussive = ndimage.median_filter(mag, size=(9, 1))
        mag = mag * harmonic**2 / (harmonic**2 + percussive**2 + 1e-12)  # drums out, held notes in
        midi = 69.0 + 12.0 * np.log2(freqs / 440.0)
        dev = midi - np.round(midi)
        offset = np.angle(np.sum(mag.sum(axis=1) * np.exp(2j * np.pi * dev))) / (2 * np.pi)
        pcs = np.round(midi - offset).astype(int) % 12
        weights = np.zeros((mag.shape[1], 12))
        for i in range(12):
            weights[:, i] = mag[pcs == i].sum(axis=0)
        t = times + begin / TARGET_SR
        if begin + chunk < len(x):  # the edge frame is repeated by the next chunk
            t, weights = t[:-1], weights[:-1]
        all_times.append(t)
        all_weights.append(weights)
    if not all_times:
        return np.zeros(0), np.zeros((0, 12))
    return np.concatenate(all_times), np.vstack(all_weights)


def add_bass_notes(x, chords):
    """Sets the bass note of a chord when one low note clearly holds under it for most of its length
    (D with F-sharp underneath becomes D/F#). A bass that just plays the root leaves it empty."""
    try:
        times, weights = bass_frames(x)
    except Exception:
        return chords  # no bass information: chords stay as they are
    if len(times) == 0:
        return chords
    total = weights.sum(axis=1)
    sounding = total > 0.1 * np.median(total[total > 0]) if np.any(total > 0) else total > 0
    leader = np.argmax(weights, axis=1)
    notes_of = {quality: intervals for quality, intervals in CHORD_TYPES}
    for chord in chords:
        length = chord["end"] - chord["start"]
        trim = 0.15 * length if length >= 0.8 else 0.0
        inside = (times >= chord["start"] + trim) & (times < chord["end"] - trim) & sounding
        count = int(inside.sum())
        if count < BASS_MIN_FRAMES:
            continue
        shares = np.bincount(leader[inside], minlength=12) / count
        energy = weights[inside].sum(axis=0)
        energy = energy / energy.sum() if energy.sum() > 0 else energy
        note = int(np.argmax(shares))
        if note == chord["root"]:
            continue
        in_chord = (note - chord["root"]) % 12 in notes_of.get(chord["quality"], (0, 4, 7))
        if energy[note] >= BASS_ENERGY_SHARE and shares[note] >= (BASS_SHARE if in_chord else BASS_SHARE_OUTSIDE):
            chord["bass"] = note
    return chords


`;

const py = read('analysis/analyze.py');
swap(py, 'MINOR_LIKE = ("min", "min7", "dim")\n', BLOCK + 'MINOR_LIKE = ("min", "min7", "dim")\n');
swap(
  py,
  '    chords = refine_chord_types(chords, times, chroma)\n',
  '    chords = refine_chord_types(chords, times, chroma)\n    chords = add_bass_notes(x, chords)\n'
);

const ctl = read('server/modules/analysis/analysis.controller.js');
swap(
  ctl,
  '      quality: c.quality,\n      bass: null,\n',
  '      quality: c.quality,\n      bass: Number.isInteger(c.bass) && c.bass >= 0 && c.bass <= 11 ? c.bass : null,\n'
);

save(py);
save(ctl);
console.log('Step 4j applied: bass notes are now found (2 files changed).');
