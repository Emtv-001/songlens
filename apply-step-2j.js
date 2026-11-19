// Step 2j: prepare each song's voice track in the background after upload.
//  - new: server/models/VoiceTrack.js, server/jobs/voiceTracks.js, server/jobs/voiceWorker.js
//  - changed: dsp.js, analysisWorker.js, analysis.controller.js, audio.controller.js, analysis-panel.js
// Exact-match, all-or-nothing, CRLF-aware.
const fs = require('fs');
const path = require('path');
const root = process.cwd();

const NEW_0 = String.raw`const mongoose = require('mongoose');

// The singer's voice, separated from a song once and kept so that "follow the singer's voice
// only" analysis takes seconds. It belongs to one version of the song's audio (audioKey): when
// the audio is replaced the track no longer matches and is replaced too.
const voiceTrackSchema = new mongoose.Schema(
  {
    songId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      unique: true,
    },
    audioKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'ready', 'failed'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    storageKey: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VoiceTrack', voiceTrackSchema);
`;

const NEW_1 = String.raw`// Keeps each song's separated voice track: queueing it, storing it, fetching it and cleaning up.
// The voice files live in the same private storage as the audio and are never served directly.
const fs = require('fs');
const { pipeline } = require('stream/promises');
const VoiceTrack = require('../models/VoiceTrack');
const Song = require('../models/Song');
const storage = require('../storage');

function voiceKey(song) {
  return 'voice/' + song.ownerId + '/' + song._id + '-' + Date.now() + '.wav';
}

async function removeFile(key) {
  if (key) await storage.remove(key).catch(() => {});
}

// Asks for a voice track for the song's current audio (does nothing if it is already wanted).
async function enqueue(song) {
  const key = song.audio && song.audio.storageKey;
  if (!key) return;
  const existing = await VoiceTrack.findOne({ songId: song._id });
  if (existing && existing.audioKey === key) return;
  await VoiceTrack.findOneAndUpdate(
    { songId: song._id },
    {
      $set: {
        audioKey: key,
        status: 'queued',
        attempts: 0,
        error: null,
        storageKey: null,
        sizeBytes: 0,
        startedAt: null,
        finishedAt: null,
      },
    },
    { upsert: true }
  );
  if (existing) await removeFile(existing.storageKey);
}

// Saves a separated voice file as the song's voice track. Returns false when the song's audio
// no longer matches (it was replaced meanwhile), in which case nothing is kept.
async function storeVoice(song, localFile) {
  const key = song.audio.storageKey;
  const file = voiceKey(song);
  const { sizeBytes } = await storage.put(file, fs.createReadStream(localFile));
  const fields = { status: 'ready', error: null, storageKey: file, sizeBytes, finishedAt: new Date() };

  const before = await VoiceTrack.findOneAndUpdate(
    { songId: song._id, audioKey: key },
    { $set: fields },
    { returnDocument: 'before' }
  );
  if (before) {
    if (before.storageKey && before.storageKey !== file) await removeFile(before.storageKey);
    return true;
  }
  try {
    await VoiceTrack.create({ songId: song._id, audioKey: key, attempts: 1, ...fields });
    return true;
  } catch (err) {
    await removeFile(file); // another version of this song's track exists
    return false;
  }
}

function fetchTo(track, destination) {
  return pipeline(storage.createReadStream(track.storageKey), fs.createWriteStream(destination));
}

async function drop(track) {
  await removeFile(track.storageKey);
  await VoiceTrack.deleteOne({ _id: track._id });
}

// 'ready' | 'preparing' | 'failed' | 'none' for the song's current audio
async function statusFor(song) {
  const key = song.audio && song.audio.storageKey;
  if (!key) return { status: 'none' };
  const track = await VoiceTrack.findOne({ songId: song._id, audioKey: key });
  if (!track) return { status: 'none' };
  if (track.status === 'ready') return { status: 'ready' };
  if (track.status === 'failed') return { status: 'failed' };
  return { status: 'preparing' };
}

// Removes voice tracks whose song was deleted or whose audio was replaced.
async function cleanup() {
  const tracks = await VoiceTrack.find({}).select('songId audioKey storageKey status').limit(500);
  if (!tracks.length) return 0;
  const songs = await Song.find({ _id: { $in: tracks.map((t) => t.songId) } }).select('audio.storageKey');
  const current = new Map(songs.map((s) => [String(s._id), s.audio && s.audio.storageKey]));
  let removed = 0;
  for (const track of tracks) {
    if (track.status === 'running') continue;
    if (current.get(String(track.songId)) !== track.audioKey) {
      await drop(track);
      removed += 1;
    }
  }
  return removed;
}

module.exports = { enqueue, storeVoice, fetchTo, drop, statusFor, cleanup };
`;

const NEW_2 = String.raw`// Background worker that prepares each song's voice track after it is uploaded. It handles one
// song at a time, because separating a voice uses all of the processor.
// VOICE_WORKER=off in .env switches it off. It does nothing when ANALYSIS_ENGINE=placeholder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Song = require('../models/Song');
const VoiceTrack = require('../models/VoiceTrack');
const voiceTracks = require('./voiceTracks');
const dsp = require('./analyzers/dsp');

const POLL_MS = Number(process.env.VOICE_POLL_MS) || 5000;
const STALE_MS = 45 * 60 * 1000; // a track "running" for longer than this is assumed lost
const CLEAN_EVERY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 2;

let timer = null;
let busy = false;
let lastClean = 0;

function claimNext() {
  return VoiceTrack.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', startedAt: new Date(), error: null }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
}

async function recoverStale() {
  const cutoff = new Date(Date.now() - STALE_MS);
  await VoiceTrack.updateMany(
    { status: 'running', startedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'queued', startedAt: null } }
  );
  await VoiceTrack.updateMany(
    { status: 'running', startedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    { $set: { status: 'failed', error: 'Preparing the voice track timed out.', finishedAt: new Date() } }
  );
}

async function sameAudio(track) {
  const song = await Song.findById(track.songId);
  const ok = song && song.audio && song.audio.storageKey === track.audioKey;
  return ok ? song : null;
}

async function processTrack(track) {
  let dir = null;
  try {
    const song = await sameAudio(track);
    if (!song) return voiceTracks.drop(track); // the song or its audio is gone
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'songlens-voice-'));
    const output = path.join(dir, 'voice.wav');
    await dsp.separateSongVoice(song, output);
    if (!(await sameAudio(track))) return voiceTracks.drop(track); // replaced while working
    await voiceTracks.storeVoice(song, output);
  } catch (err) {
    console.error('Voice track failed:', err.message);
    const notSetUp = /not set up/i.test(err.message);
    const giveUp = notSetUp || track.attempts >= MAX_ATTEMPTS;
    const message = String(err.message || err).slice(0, 300);
    await VoiceTrack.updateOne(
      { _id: track._id, status: 'running' },
      giveUp
        ? { $set: { status: 'failed', error: message, finishedAt: new Date() } }
        : { $set: { status: 'queued', startedAt: null, error: message } }
    );
  } finally {
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return undefined;
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await recoverStale();
    let track = await claimNext();
    while (track) {
      await processTrack(track);
      track = await claimNext();
    }
    if (Date.now() - lastClean > CLEAN_EVERY_MS) {
      lastClean = Date.now();
      await voiceTracks.cleanup();
    }
  } catch (err) {
    console.error('Voice worker error:', err.message);
  } finally {
    busy = false;
  }
}

function start() {
  if (timer) return;
  if (process.env.VOICE_WORKER === 'off' || process.env.ANALYSIS_ENGINE === 'placeholder') {
    console.log('Voice track worker is switched off.');
    return;
  }
  timer = setInterval(tick, POLL_MS);
  timer.unref();
  console.log('Voice track worker started (prepares the singer\'s voice after each upload).');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
`;

const newFiles = [
  ['server/models/VoiceTrack.js', NEW_0],
  ['server/jobs/voiceTracks.js', NEW_1],
  ['server/jobs/voiceWorker.js', NEW_2],
];

const edits = [
 [
  "server/jobs/analyzers/dsp.js",
  [
   [
    "const storage = require('../../storage');\n",
    "const storage = require('../../storage');\nconst VoiceTrack = require('../../models/VoiceTrack');\nconst voiceTracks = require('../voiceTracks');\n"
   ],
   [
    "async function analyze(song, run) {",
    "function sleep(ms) {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\n\n// Puts the singer's voice for this song into voiceFile: from the stored voice track when there\n// is one (waiting while it is being prepared), otherwise by separating it now.\nasync function getVoiceFile(song, audioFile, voiceFile) {\n  const key = song.audio.storageKey;\n  const deadline = Date.now() + SEPARATE_TIMEOUT_MS;\n  const workerOn = process.env.VOICE_WORKER !== 'off' && process.env.ANALYSIS_ENGINE !== 'placeholder';\n  for (;;) {\n    const track = await VoiceTrack.findOne({ songId: song._id, audioKey: key });\n    if (!track || track.status === 'failed') break;\n    if (track.status === 'ready') {\n      try {\n        await voiceTracks.fetchTo(track, voiceFile);\n        return;\n      } catch (err) {\n        console.error('Could not read the stored voice track:', err.message);\n        break;\n      }\n    }\n    if ((track.status === 'queued' && !workerOn) || Date.now() > deadline) break;\n    await sleep(3000);\n  }\n  await runSeparate(audioFile, voiceFile);\n  // keep it for next time (a problem here must not fail the analysis)\n  await voiceTracks.storeVoice(song, voiceFile).catch(() => {});\n}\n\n// Separates the singer's voice from the song's audio into the local file `output`.\nasync function separateSongVoice(song, output) {\n  const key = song.audio && song.audio.storageKey;\n  const ext = EXTENSIONS[song.audio && song.audio.mimeType] || '.audio';\n  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'songlens-sep-'));\n  const file = path.join(dir, 'audio' + ext);\n  try {\n    await pipeline(storage.createReadStream(key), fs.createWriteStream(file));\n    await runSeparate(file, output);\n  } finally {\n    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});\n  }\n}\n\nasync function analyze(song, run) {"
   ],
   [
    "Promise.all([runPython([file, '--no-melody']), runSeparate(file, voiceFile)])",
    "Promise.all([runPython([file, '--no-melody']), getVoiceFile(song, file, voiceFile)])"
   ],
   [
    "module.exports = { analyze };",
    "module.exports = { analyze, separateSongVoice };"
   ]
  ]
 ],
 [
  "server/jobs/analysisWorker.js",
  [
   [
    "const AnalysisRun = require('../models/AnalysisRun');\n",
    "const AnalysisRun = require('../models/AnalysisRun');\nconst voiceWorker = require('./voiceWorker');\n"
   ],
   [
    "  console.log(`Analysis worker started (checks every ${POLL_MS / 1000}s).`);\n}",
    "  console.log(`Analysis worker started (checks every ${POLL_MS / 1000}s).`);\n  voiceWorker.start();\n}"
   ],
   [
    "  if (timer) clearInterval(timer);\n  timer = null;\n}",
    "  if (timer) clearInterval(timer);\n  timer = null;\n  voiceWorker.stop();\n}"
   ]
  ]
 ],
 [
  "server/modules/analysis/analysis.controller.js",
  [
   [
    "const AnalysisRun = require('../../models/AnalysisRun');\n",
    "const AnalysisRun = require('../../models/AnalysisRun');\nconst voiceTracks = require('../../jobs/voiceTracks');\n"
   ],
   [
    "      .limit(20);\n    res.json({ runs });",
    "      .limit(20);\n    const voice = await voiceTracks.statusFor(song);\n    res.json({ runs, voice });"
   ]
  ]
 ],
 [
  "server/modules/songs/audio.controller.js",
  [
   [
    "const storage = require('../../storage');\n",
    "const storage = require('../../storage');\nconst voiceTracks = require('../../jobs/voiceTracks');\n"
   ],
   [
    "    if (oldKey) {\n      await storage.remove(oldKey).catch(() => {});\n    }\n",
    "    if (oldKey) {\n      await storage.remove(oldKey).catch(() => {});\n    }\n\n    // Prepare the singer's voice track in the background (see jobs/voiceWorker.js).\n    voiceTracks\n      .enqueue(song)\n      .catch((err) => console.error('Could not queue the voice track:', err.message));\n"
   ]
  ]
 ],
 [
  "client/js/analysis-panel.js",
  [
   [
    "  let runVoice = false; // the run being waited for is a voice-only run\n",
    "  let runVoice = false; // the run being waited for is a voice-only run\n  let voiceStatus = 'none'; // the song's voice track: none | preparing | ready | failed\n"
   ],
   [
    "el('p', 'analysis-sub', 'Slower: takes about as long as the song. Use it when the melody picks up instruments or backing singers.')",
    "el('p', 'analysis-sub', voiceHint())"
   ],
   [
    "  async function start() {",
    "function voiceHint() {\n    if (voiceStatus === 'ready') return 'The voice track is ready, so this takes only a few seconds.';\n    if (voiceStatus === 'preparing') {\n      return 'Preparing the voice track in the background. You can already start; it will use it when it is ready.';\n    }\n    return 'Slower: takes about as long as the song. Use it when the melody picks up instruments or backing singers.';\n  }\n\n  // While the voice track is being prepared, check now and then so the hint updates by itself.\n  async function watchVoice() {\n    for (let i = 0; i < 120 && voiceStatus === 'preparing'; i += 1) {\n      await new Promise((resolve) => setTimeout(resolve, 10000));\n      try {\n        const { ok, data } = await api(base);\n        const next = ok && data.voice && data.voice.status;\n        if (next && next !== voiceStatus) {\n          voiceStatus = next;\n          if (view.kind !== 'running' && !busy) render();\n        }\n      } catch (err) {\n        // try again at the next check\n      }\n    }\n  }\n\n  async function start() {"
   ],
   [
    "      section.hidden = false;\n      const latest = (data.runs || [])[0];",
    "      section.hidden = false;\n      voiceStatus = (data.voice && data.voice.status) || 'none';\n      if (voiceStatus === 'preparing') watchVoice();\n      const latest = (data.runs || [])[0];"
   ]
  ]
 ]
];

const pending = [];
for (const [rel, list] of edits) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.error('Missing file: ' + rel + ' (run this from the songlens folder, after steps 2e to 2i)'); process.exit(1); }
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
for (const [rel, content] of newFiles) {
  const file = path.join(root, rel);
  if (!fs.existsSync(path.dirname(file))) { console.error('Missing folder for ' + rel); process.exit(1); }
  pending.push([file, content]);
}
for (const [file, text] of pending) fs.writeFileSync(file, text);
console.log('Done. Updated ' + pending.length + ' files.');
