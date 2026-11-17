"""Separates the singing voice from a song (Demucs) and writes it as a mono WAV file.

Usage: python separate.py <audio file> <output wav>
Prints one line of JSON: {"ok": true} or {"error": "..."}.
"""
import json
import sys

MAX_SECONDS = 600


def run(src, dst):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio.functional as F
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    x, sr = sf.read(src, always_2d=True, dtype="float32")
    x = x.T
    if x.shape[0] == 1:
        x = np.repeat(x, 2, 0)
    x = x[:2, : int(MAX_SECONDS * sr)]
    t = torch.from_numpy(x.copy())
    model = get_model("htdemucs")
    model.eval()
    if sr != model.samplerate:
        t = F.resample(t, sr, model.samplerate)
    ref = t.mean(0)
    m, s = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(model, ((t - m) / s)[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    voice = (out[model.sources.index("vocals")] * s + m).mean(0, keepdim=True)
    voice = F.resample(voice, model.samplerate, 22050).clamp(-1, 1)
    sf.write(dst, voice[0].numpy(), 22050)


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python separate.py <audio file> <output wav>"}))
        return 1
    try:
        run(sys.argv[1], sys.argv[2])
        print(json.dumps({"ok": True}))
        return 0
    except Exception as err:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({"error": str(err)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
