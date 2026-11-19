// Keeps each song's separated voice track: queueing it, storing it, fetching it and cleaning up.
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
