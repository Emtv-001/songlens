"""SongLens audio analysis: tempo, key, chords and melody.

Usage:
    python analyze.py path/to/audio-file

Prints one JSON object on stdout and exits 0. On failure it prints {"error": "..."} and
exits 1. Nothing else is printed to stdout, so the Node worker can parse it directly.

These are estimates from the audio signal, not facts: every value comes with a confidence
number, and the app must let the user correct them.
"""
import json
import sys

import numpy as np
import soundfile as sf
from scipy import ndimage, signal

ENGINE = {"name": "songlens-dsp", "version": "4"}
TARGET_SR = 22050
MAX_SECONDS = 180        # tempo and key use the middle of long songs
CHORD_MAX_SECONDS = 600  # chords cover the song from the start, up to this length
CHUNK_SECONDS = 60
MIN_CHORD_SECONDS = 0.5
SWITCH_PENALTY = 0.3

# melody tracking
MELODY_LOW_MIDI = 43     # G2
MELODY_HIGH_MIDI = 84    # C6
MELODY_STEPS = 4         # grid points per semitone
MELODY_HARMONICS = 6
MELODY_MIN_NOTE_SECONDS = 0.1
MELODY_MAX_NOTES = 5000

# Krumhansl-Schmuckler key profiles (index 0 = tonic).
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def load_audio(path):
    data, rate = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if rate != TARGET_SR:
        g = np.gcd(int(rate), TARGET_SR)
        mono = signal.resample_poly(mono, TARGET_SR // g, int(rate) // g).astype(np.float32)
    duration = len(data) / rate
    mono = mono[: CHORD_MAX_SECONDS * TARGET_SR]
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    if peak < 1e-4:
        raise ValueError("The audio is silent.")
    return mono / peak, duration


def middle(x, seconds):
    """The middle part of long songs: intros and outros are rarely typical."""
    limit = seconds * TARGET_SR
    if len(x) <= limit:
        return x
    start = (len(x) - limit) // 2
    return x[start:start + limit]


def estimate_tempo(x):
    hop = 256
    _, _, spec = signal.stft(x, fs=TARGET_SR, nperseg=2048, noverlap=2048 - hop)
    mag = np.abs(spec)[:300]  # roughly up to 3 kHz
    logmag = np.log1p(100.0 * mag)
    flux = np.maximum(np.diff(logmag, axis=1), 0.0).mean(axis=0)
    # remove the slow trend so that only the beat-scale pulses remain
    win = 43
    trend = np.convolve(flux, np.ones(win) / win, mode="same")
    env = np.maximum(flux - trend, 0.0)
    if env.sum() <= 0:
        raise ValueError("No rhythm could be found.")

    n = len(env)
    size = 1 << int(np.ceil(np.log2(2 * n)))
    f = np.fft.rfft(env - env.mean(), size)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac = ac / ac[0] if ac[0] > 0 else ac

    frame_rate = TARGET_SR / hop
    bpms = np.arange(60.0, 200.0, 0.5)
    lags = frame_rate * 60.0 / bpms

    def at(lag):
        lo = int(np.floor(lag))
        if lo + 1 >= n:
            return 0.0
        frac = lag - lo
        return ac[lo] * (1 - frac) + ac[lo + 1] * frac

    scores = []
    for bpm, lag in zip(bpms, lags):
        s = at(lag) + 0.5 * at(2 * lag) + 0.25 * at(4 * lag)
        prior = np.exp(-0.5 * (np.log2(bpm / 115.0) / 0.8) ** 2)  # people tap near 115
        scores.append(s * prior)
    scores = np.array(scores)
    best = int(np.argmax(scores))
    bpm = float(bpms[best])
    # confidence: how much the best tempo stands out from the best rival that is not
    # simply a neighbouring value (more than 8 % away)
    far = np.abs(bpms - bpm) > 0.08 * bpm
    rival = float(scores[far].max()) if far.any() else 0.0
    confidence = 1.0 - rival / (scores[best] + 1e-9)
    alternatives = [round(v, 1) for v in (bpm / 2.0, bpm * 2.0) if 50.0 <= v <= 220.0]
    return round(bpm, 1), round(max(0.0, min(1.0, confidence)), 2), alternatives


def pitch_classes(freqs, weights, mag):
    """Pitch-class energy of the given spectrum rows, corrected for the recording's tuning."""
    midi = 69.0 + 12.0 * np.log2(freqs / 440.0)
    dev = midi - np.round(midi)
    # tuning offset: circular mean of how far the strong peaks sit from exact semitones
    offset = np.angle(np.sum(weights * np.exp(2j * np.pi * dev))) / (2 * np.pi)
    pcs = np.round(midi - offset).astype(int) % 12
    # frame-wise normalisation, so loud passages do not swamp quiet ones
    norm = mag / (mag.sum(axis=0, keepdims=True) + 1e-9)
    chroma = np.zeros(12)
    for pc in range(12):
        chroma[pc] = norm[pcs == pc].sum()
    return chroma / (chroma.sum() + 1e-9)


def chromagram(x):
    nper, hop = 8192, 4096
    freqs, _, spec = signal.stft(x, fs=TARGET_SR, nperseg=nper, noverlap=nper - hop)
    mag = np.abs(spec)
    keep = (freqs >= 60) & (freqs <= 2000)
    freqs, mag = freqs[keep], mag[keep]
    if mag.size == 0 or mag.sum() <= 0:
        raise ValueError("No pitched content could be found.")

    # Harmonic part only: steady notes stay, drum hits (which smear across frequencies) go.
    harmonic = ndimage.median_filter(mag, size=(1, 9))
    percussive = ndimage.median_filter(mag, size=(17, 1))
    mask = harmonic**2 / (harmonic**2 + percussive**2 + 1e-12)
    mag = mag * mask

    weights = mag.sum(axis=1)
    mid = (freqs >= 100) & (freqs <= 2000)
    bass = freqs <= 250
    chroma_mid = pitch_classes(freqs[mid], weights[mid], mag[mid])
    chroma_bass = pitch_classes(freqs[bass], weights[bass], mag[bass])
    # the bass usually plays the tonic or the chord roots, so it counts as much as the rest
    total = chroma_mid + chroma_bass
    return total / (total.sum() + 1e-9)


def estimate_key(x):
    chroma = chromagram(x)
    results = []
    for tonic in range(12):
        for mode, profile in (("major", MAJOR), ("minor", MINOR)):
            r = float(np.corrcoef(chroma, np.roll(profile, tonic))[0, 1])
            results.append((r, tonic, mode))
    results.sort(reverse=True)
    best, second = results[0], results[1]
    confidence = max(0.0, min(1.0, (best[0] - second[0]) / 0.1))
    alternatives = [{"keyPc": t, "mode": m, "score": round(r, 3)} for r, t, m in results[1:4]]
    return best[1], best[2], round(confidence, 2), round(best[0], 3), alternatives


NOTE_TRIADS = (("maj", (0, 4, 7)), ("min", (0, 3, 7)))
CHORD_STATES = [(root, quality) for root in range(12) for quality, _ in NOTE_TRIADS]


def build_templates():
    weights = {0: 1.0, 3: 0.9, 4: 0.9, 7: 0.8}
    rows = []
    for root, quality in CHORD_STATES:
        vec = np.zeros(12)
        intervals = dict(NOTE_TRIADS)[quality]
        for interval in intervals:
            vec[(root + interval) % 12] = weights[interval]
        rows.append(vec / np.linalg.norm(vec))
    return np.array(rows)


def diatonic_triads(key_pc, mode):
    """The chords that belong to a key (plus the common major V in minor keys)."""
    if mode == "major":
        degrees = [(0, "maj"), (2, "min"), (4, "min"), (5, "maj"), (7, "maj"), (9, "min")]
    else:
        degrees = [(0, "min"), (3, "maj"), (5, "min"), (7, "min"), (7, "maj"), (8, "maj"), (10, "maj")]
    return {((key_pc + d) % 12, q) for d, q in degrees}


def frame_chroma(x):
    """Chord-oriented chroma for every ~0.09 s: 12 numbers per frame, plus frame times."""
    nper, hop = 8192, 2048
    chunk = CHUNK_SECONDS * TARGET_SR
    all_times, all_chroma, all_energy = [], [], []
    for begin in range(0, len(x), chunk):
        part = x[begin:begin + chunk]
        if len(part) < nper // 2:
            break
        freqs, times, spec = signal.stft(part, fs=TARGET_SR, nperseg=nper, noverlap=nper - hop)
        mag = np.abs(spec)
        keep = (freqs >= 60) & (freqs <= 2000)
        freqs, mag = freqs[keep], mag[keep]
        harmonic = ndimage.median_filter(mag, size=(1, 9))
        percussive = ndimage.median_filter(mag, size=(17, 1))
        mag = mag * harmonic**2 / (harmonic**2 + percussive**2 + 1e-12)

        midi = 69.0 + 12.0 * np.log2(freqs / 440.0)
        dev = midi - np.round(midi)
        weights = mag.sum(axis=1)
        offset = np.angle(np.sum(weights * np.exp(2j * np.pi * dev))) / (2 * np.pi)
        pcs = np.round(midi - offset).astype(int) % 12
        onehot = np.zeros((12, len(freqs)))
        onehot[pcs, np.arange(len(freqs))] = 1.0

        mid = (freqs >= 100) & (freqs <= 2000)
        bass = freqs <= 250
        chroma = np.zeros((12, mag.shape[1]))
        for band, scale in ((mid, 1.0), (bass, 0.7)):
            band_mag = mag[band]
            norm = band_mag / (band_mag.sum(axis=0, keepdims=True) + 1e-9)
            chroma += scale * (onehot[:, band] @ norm)
        energy = mag.sum(axis=0)

        t = times + begin / TARGET_SR
        last_chunk = begin + chunk >= len(x)
        if not last_chunk:  # the edge frame is repeated by the next chunk
            t, chroma, energy = t[:-1], chroma[:, :-1], energy[:-1]
        all_times.append(t)
        all_chroma.append(chroma.T)
        all_energy.append(energy)
    if not all_times:
        raise ValueError("The audio is too short to find chords.")
    return np.concatenate(all_times), np.vstack(all_chroma), np.concatenate(all_energy)


def estimate_chords(x, key_pc, mode, key_conf):
    times, chroma, energy = frame_chroma(x)
    templates = build_templates()
    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    scores = (chroma / (norms + 1e-9)) @ templates.T  # cosine similarity, frames x 24

    bonus = 0.05 if key_conf >= 0.34 else 0.02
    belongs = diatonic_triads(key_pc, mode)
    scores += np.array([bonus if state in belongs else 0.0 for state in CHORD_STATES])

    # frames with (almost) no sound say nothing about the chord: keep whatever came before
    loud = energy > 0.05 * np.median(energy[energy > 0]) if np.any(energy > 0) else energy > 0
    scores[~loud] = 0.0

    # Viterbi: best chord path where every change costs SWITCH_PENALTY
    n_frames, n_states = scores.shape
    delta = scores[0].copy()
    back = np.zeros((n_frames, n_states), dtype=np.int16)
    for i in range(1, n_frames):
        best_prev = int(np.argmax(delta))
        change = delta[best_prev] - SWITCH_PENALTY
        stay = delta >= change
        back[i] = np.where(stay, np.arange(n_states), best_prev)
        delta = scores[i] + np.where(stay, delta, change)
    path = np.zeros(n_frames, dtype=int)
    path[-1] = int(np.argmax(delta))
    for i in range(n_frames - 1, 0, -1):
        path[i - 1] = back[i, path[i]]

    # frame path -> segments, with boundaries halfway between frame centres
    mids = (times[:-1] + times[1:]) / 2
    starts = np.concatenate([[0.0], mids])
    ends = np.concatenate([mids, [times[-1] + (times[-1] - times[-2] if n_frames > 1 else 0.1) / 2]])
    segments = []
    for i in range(n_frames):
        if segments and segments[-1]["state"] == path[i]:
            segments[-1]["end"] = ends[i]
        else:
            segments.append({"state": int(path[i]), "start": starts[i], "end": ends[i]})

    # absorb very short segments into the previous one, then join equal neighbours
    merged = []
    for seg in segments:
        if merged and seg["end"] - seg["start"] < MIN_CHORD_SECONDS:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(dict(seg))
    joined = []
    for seg in merged:
        if joined and joined[-1]["state"] == seg["state"]:
            joined[-1]["end"] = seg["end"]
        else:
            joined.append(seg)

    chords = []
    for seg in joined:
        root, quality = CHORD_STATES[seg["state"]]
        chords.append(
            {
                "start": round(float(seg["start"]), 2),
                "end": round(min(float(seg["end"]), len(x) / TARGET_SR), 2),
                "root": int(root),
                "quality": quality,
                "bass": None,
            }
        )
    return chords


def melody_salience(x):
    """For every ~23 ms: how strongly each candidate pitch is supported by its harmonics."""
    nper, hop = 4096, 512
    chunk = CHUNK_SECONDS * TARGET_SR
    midis = np.arange(MELODY_LOW_MIDI, MELODY_HIGH_MIDI, 1.0 / MELODY_STEPS)
    f0s = 440.0 * 2.0 ** ((midis - 69.0) / 12.0)
    bin_width = TARGET_SR / nper
    all_times, all_sal = [], []
    for begin in range(0, len(x), chunk):
        part = x[begin:begin + chunk]
        if len(part) < nper // 2:
            break
        freqs, times, spec = signal.stft(part, fs=TARGET_SR, nperseg=nper, noverlap=nper - hop)
        mag = np.abs(spec)
        harmonic = ndimage.median_filter(mag, size=(1, 11))
        percussive = ndimage.median_filter(mag, size=(25, 1))
        mag = np.sqrt(mag * harmonic**2 / (harmonic**2 + percussive**2 + 1e-12))

        sal = np.zeros((len(f0s), mag.shape[1]))
        for h in range(1, MELODY_HARMONICS + 1):
            pos = h * f0s / bin_width
            lo = np.minimum(np.floor(pos).astype(int), mag.shape[0] - 2)
            frac = (pos - lo)[:, None]
            sal += (0.8 ** (h - 1)) * (mag[lo] * (1 - frac) + mag[lo + 1] * frac)

        t = times + begin / TARGET_SR
        if begin + chunk < len(x):  # the edge frame is repeated by the next chunk
            t, sal = t[:-1], sal[:, :-1]
        all_times.append(t)
        all_sal.append(sal.T)
    if not all_times:
        raise ValueError("The audio is too short to find a melody.")
    return np.concatenate(all_times), np.vstack(all_sal), midis


def estimate_melody(x):
    times, sal, midis = melody_salience(x)
    n_frames, n_cands = sal.shape

    # scale so that a clear lead line scores about 1
    frame_best = sal.max(axis=1)
    scale = np.percentile(frame_best, 90)
    if scale <= 0:
        return [], 0.0
    sal = sal / scale

    # Viterbi over "unvoiced" (state 0) + one state per candidate pitch
    unvoiced_score = 0.45
    jump_cost = 0.03          # per grid step (a quarter of a semitone)
    jump_cap = 0.9
    voicing_cost = 0.25
    steps = np.abs(np.arange(n_cands)[:, None] - np.arange(n_cands)[None, :])
    trans = -np.minimum(jump_cost * steps, jump_cap)  # voiced -> voiced

    delta_u = unvoiced_score
    delta_v = sal[0].copy()
    back_v = np.zeros((n_frames, n_cands), dtype=np.int16)  # previous voiced state, -1 = unvoiced
    back_u = np.zeros(n_frames, dtype=np.int16)             # previous state of unvoiced: 0 u, 1 v
    best_voiced_prev = np.zeros(n_frames, dtype=np.int16)
    for i in range(1, n_frames):
        stay_v = delta_v[None, :] + trans                   # [to, from]
        from_v = np.argmax(stay_v, axis=1)
        best_v = stay_v[np.arange(n_cands), from_v]
        from_u = delta_u - voicing_cost                      # unvoiced -> voiced
        use_u = from_u > best_v
        new_v = np.where(use_u, from_u, best_v) + sal[i]
        back_v[i] = np.where(use_u, -1, from_v)

        v_best = int(np.argmax(delta_v))
        to_u_from_v = delta_v[v_best] - voicing_cost
        if to_u_from_v > delta_u:
            new_u = to_u_from_v + unvoiced_score
            back_u[i] = 1
            best_voiced_prev[i] = v_best
        else:
            new_u = delta_u + unvoiced_score
            back_u[i] = 0
        delta_v, delta_u = new_v, new_u

    # trace back
    state = np.full(n_frames, -1, dtype=int)  # -1 = unvoiced, otherwise candidate index
    in_voiced = np.max(delta_v) > delta_u
    cur = int(np.argmax(delta_v)) if in_voiced else -1
    for i in range(n_frames - 1, -1, -1):
        state[i] = cur
        if i == 0:
            break
        if cur >= 0:
            cur = int(back_v[i, cur])
        else:
            cur = int(best_voiced_prev[i]) if back_u[i] == 1 else -1

    voiced = state >= 0
    if not np.any(voiced):
        return [], 0.0
    pitch = np.where(voiced, midis[np.where(voiced, state, 0)], np.nan)

    # tuning of the recording: how far the tracked pitches sit from exact semitones
    dev = pitch[voiced] - np.round(pitch[voiced])
    offset = np.angle(np.mean(np.exp(2j * np.pi * dev))) / (2 * np.pi)
    rounded = np.where(voiced, np.round(pitch - offset), -1).astype(int)

    # smooth one-frame flickers between neighbouring semitones
    padded = np.pad(rounded, 2, mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, 5)
    smooth = rounded.copy()
    for i in range(n_frames):
        if rounded[i] >= 0:
            w = windows[i][windows[i] >= 0]
            if len(w) >= 3:
                smooth[i] = int(np.round(np.median(w)))

    hop_s = float(np.median(np.diff(times))) if n_frames > 1 else 0.023
    notes = []
    i = 0
    while i < n_frames:
        if smooth[i] < 0:
            i += 1
            continue
        j = i
        while j + 1 < n_frames and smooth[j + 1] == smooth[i]:
            j += 1
        notes.append([float(times[i] - hop_s / 2), float(times[j] + hop_s / 2), int(smooth[i])])
        i = j + 1

    # join same-pitch notes separated by a tiny gap, then drop notes that are too short
    joined = []
    for note in notes:
        if joined and joined[-1][2] == note[2] and note[0] - joined[-1][1] <= 0.06:
            joined[-1][1] = note[1]
        else:
            joined.append(note)
    result = []
    for start, end, midi in joined:
        start = max(0.0, start)
        if end - start >= MELODY_MIN_NOTE_SECONDS and 0 <= midi <= 127:
            result.append(
                {"start": round(start, 2), "end": round(min(end, len(x) / TARGET_SR), 2), "midi": int(midi)}
            )
    result = result[:MELODY_MAX_NOTES]
    return result, round(float(np.mean(voiced)), 2)


def analyze(path):
    x, duration = load_audio(path)
    steady = middle(x, MAX_SECONDS)
    bpm, bpm_conf, bpm_alternatives = estimate_tempo(steady)
    key_pc, mode, key_conf, key_score, alternatives = estimate_key(steady)
    chords = estimate_chords(x, key_pc, mode, key_conf)
    melody, voiced_ratio = estimate_melody(x)
    return {
        "engine": ENGINE,
        "durationSec": round(duration, 1),
        "bpm": bpm,
        "bpmConfidence": bpm_conf,
        "bpmAlternatives": bpm_alternatives,
        "keyPc": int(key_pc),
        "mode": mode,
        "keyConfidence": key_conf,
        "keyScore": key_score,
        "keyAlternatives": alternatives,
        "chordsCoverSec": round(min(duration, CHORD_MAX_SECONDS), 1),
        "chords": chords,
        "melodyVoicedRatio": voiced_ratio,
        "melody": melody,
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python analyze.py <audio file>"}))
        return 1
    try:
        print(json.dumps(analyze(sys.argv[1])))
        return 0
    except Exception as err:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({"error": str(err)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())