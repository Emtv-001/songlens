// Real analyzer: copies the song's audio to a temporary file, runs the Python script in
// analysis/analyze.py on it, and returns what the script found.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const storage = require('../../storage');

const ROOT = path.join(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'analysis', 'analyze.py');
const TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS) || 5 * 60 * 1000;
const MAX_OUTPUT = 1024 * 1024;

const EXTENSIONS = {
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
};

function pythonPath() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venv = path.join(ROOT, 'analysis', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function runPython(file) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonPath(), [SCRIPT, file], { windowsHide: true });
    } catch (err) {
      return reject(err);
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      done(reject, new Error('The analysis took too long and was stopped.'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        child.kill();
        done(reject, new Error('The analyzer produced too much output.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        done(reject, new Error('Python analysis is not set up on this server.'));
      } else {
        done(reject, err);
      }
    });
    child.on('close', (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        // handled below
      }
      if (parsed && parsed.error) return done(reject, new Error(friendly(parsed.error)));
      if (code !== 0 || !parsed) {
        console.error('Analyzer failed:', stderr.trim().split('\n').slice(-3).join(' | '));
        return done(reject, new Error('The analyzer stopped unexpectedly.'));
      }
      done(resolve, parsed);
    });
  });
}

function friendly(message) {
  if (/Error opening|Format not recognised|System error/i.test(message)) {
    return 'This audio file could not be read. MP3, WAV, FLAC and OGG files are supported.';
  }
  return message;
}

async function analyze(song) {
  const key = song.audio && song.audio.storageKey;
  const ext = EXTENSIONS[song.audio && song.audio.mimeType] || '.audio';
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'songlens-'));
  const file = path.join(dir, `audio${ext}`);

  try {
    await pipeline(storage.createReadStream(key), fs.createWriteStream(file));
    const { engine, ...result } = await runPython(file);
    return { engine, result };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { analyze };