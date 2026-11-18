// Step 2g: faster voice-only runs. The voice is separated at the same time as the speed, key
// and chords are analysed, then only the melody is found in the separated voice.
const fs = require('fs');
const path = require('path');
const root = process.cwd();

const MELODY_ONLY_PY = `def melody_only(path):
    """Finds the melody in an already separated voice file."""
    try:
        voice, _ = load_audio(path)
    except ValueError:
        return {"melody": [], "melodyVoicedRatio": 0.0, "melodySource": "none"}
    melody, ratio = estimate_melody(voice)
    return {"melody": melody, "melodyVoicedRatio": ratio, "melodySource": "voice"}


def main():`;

const edits = [
  ['analysis/separate.py', [
    ['overlap=0.25', 'overlap=0.1'],
  ]],
  ['analysis/analyze.py', [
    ['def analyze(path, melody_path=None):\n', 'def analyze(path, melody_path=None, skip_melody=False):\n'],
    ['    melody_source = "mix"\n    if melody_path:\n',
     '    melody_source = "mix"\n    if skip_melody:\n        melody, voiced_ratio, melody_source = [], 0.0, "pending"\n    elif melody_path:\n'],
    ['def main():', MELODY_ONLY_PY],
    ['    args = sys.argv[1:]\n    melody_path = None\n    if len(args) == 3 and args[1] == "--melody-from":\n        melody_path = args[2]\n        args = args[:1]\n    if len(args) != 1:\n        print(json.dumps({"error": "Usage: python analyze.py <audio file> [--melody-from <voice file>]"}))\n        return 1\n    try:\n        print(json.dumps(analyze(args[0], melody_path)))',
     '    args = sys.argv[1:]\n    melody_path = None\n    skip_melody = False\n    only = None\n    if len(args) == 2 and args[0] == "--melody-only":\n        only = args[1]\n    elif len(args) == 3 and args[1] == "--melody-from":\n        melody_path = args[2]\n        args = args[:1]\n    elif len(args) == 2 and args[1] == "--no-melody":\n        skip_melody = True\n        args = args[:1]\n    if only is None and len(args) != 1:\n        print(json.dumps({"error": "Usage: python analyze.py <audio file> [--melody-from <voice file> | --no-melody]"}))\n        return 1\n    try:\n        if only is not None:\n            print(json.dumps(melody_only(only)))\n            return 0\n        print(json.dumps(analyze(args[0], melody_path, skip_melody)))'],
  ]],
  ['server/jobs/analyzers/dsp.js', [
    ['function runPython(file, voiceFile) {', 'function runPython(args) {'],
    ["child = spawn(pythonPath(), voiceFile ? [SCRIPT, file, '--melody-from', voiceFile] : [SCRIPT, file], {",
     "child = spawn(pythonPath(), [SCRIPT, ...args], {"],
    ["    let voiceFile = null;\n    if (run && run.options && run.options.voiceOnly) {\n      voiceFile = path.join(dir, 'voice.wav');\n      await runSeparate(file, voiceFile);\n    }\n    const { engine, ...result } = await runPython(file, voiceFile);",
     "    if (run && run.options && run.options.voiceOnly) {\n      // The voice is separated while the speed, key and chords are analysed, then the melody\n      // is found in the separated voice.\n      const voiceFile = path.join(dir, 'voice.wav');\n      const [base] = await Promise.all([runPython([file, '--no-melody']), runSeparate(file, voiceFile)]);\n      const melody = await runPython(['--melody-only', voiceFile]);\n      const { engine, ...result } = { ...base, ...melody };\n      return { engine, result };\n    }\n    const { engine, ...result } = await runPython([file]);"],
  ]],
];

const pending = [];
for (const [rel, list] of edits) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.error('Missing file: ' + rel + ' (run this from the songlens folder, after step 2e)'); process.exit(1); }
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  for (const [from, to] of list) {
    const n = text.split(from).length - 1;
    if (n !== 1) { console.error('Could not apply to ' + rel + ' (expected 1 match, found ' + n + '): ' + from.split('\n')[0]); process.exit(1); }
    text = text.replace(from, () => to);
  }
  pending.push([file, crlf ? text.replace(/\n/g, '\r\n') : text]);
}
for (const [file, text] of pending) fs.writeFileSync(file, text);
console.log('Done. Updated ' + pending.length + ' files.');
