// Background worker that prepares each song's voice track after it is uploaded. It handles one
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
