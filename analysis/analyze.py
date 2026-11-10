"""SongLens audio analysis: tempo and key.

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

ENGINE = {"name": "songlens-dsp", "version": "2"}
TARGET_SR = 22050
MAX_SECONDS = 180

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
    # Analyse the middle of long songs: intros and outros are rarely typical.
    limit = MAX_SECONDS * TARGET_SR
    if len(mono) > limit:
        start = (len(mono) - limit) // 2
        mono = mono[start:start + limit]
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    if peak < 1e-4:
        raise ValueError("The audio is silent.")
    return mono / peak, duration


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


def analyze(path):
    x, duration = load_audio(path)
    bpm, bpm_conf, bpm_alternatives = estimate_tempo(x)
    key_pc, mode, key_conf, key_score, alternatives = estimate_key(x)
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