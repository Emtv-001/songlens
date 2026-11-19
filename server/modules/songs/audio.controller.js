const path = require('path');
const { pipeline } = require('stream');
const mongoose = require('mongoose');
const Song = require('../../models/Song');
const storage = require('../../storage');
const voiceTracks = require('../../jobs/voiceTracks');
const { createSniffer } = require('../../utils/audioType');
const { createSignedPath, verifySignature } = require('../../utils/signedUrl');
const { parseRange } = require('../../utils/range');

const MAX_MB = parseInt(process.env.AUDIO_MAX_MB, 10) || 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const URL_TTL_SECONDS = 60 * 60;

function cleanName(raw) {
  const base = path.basename((raw || '').toString());
  return base.replace(/[^\w.\- ]/g, '_').slice(0, 200) || null;
}

function canView(song, user) {
  if (song.visibility === 'public') return true;
  return Boolean(user && song.ownerId && song.ownerId.equals(user._id));
}

// POST /songs/:songId/audio  (owner only)
async function uploadAudio(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId);
    const isOwner = song && song.ownerId && song.ownerId.equals(req.user._id);
    if (!song || !isOwner) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const contentType = (req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('audio/')) {
      return res
        .status(415)
        .json({ message: 'Send the file as the request body with an audio/* content type' });
    }

    const declared = parseInt(req.headers['content-length'], 10);
    if (declared > MAX_BYTES) {
      return res.status(413).json({ message: `File too large (max ${MAX_MB} MB)` });
    }

    let detected = null;
    const sniffer = createSniffer((type) => {
      detected = type;
    });
    const body = pipeline(req, sniffer, () => {});

    const key = `audio/${req.user._id}/${song._id}-${Date.now()}`;

    let result;
    try {
      result = await storage.put(key, body, { maxBytes: MAX_BYTES });
    } catch (err) {
      if (err.message === 'FILE_TOO_LARGE') {
        return res.status(413).json({ message: `File too large (max ${MAX_MB} MB)` });
      }
      if (err.message === 'INVALID_AUDIO') {
        return res.status(415).json({
          message: 'Unsupported file. Use MP3, WAV, M4A, OGG or FLAC.',
        });
      }
      throw err;
    }

    const oldKey = song.audio && song.audio.storageKey;

    song.audio = {
      storageKey: key,
      originalName: cleanName(req.headers['x-file-name']),
      mimeType: detected.mime,
      sizeBytes: result.sizeBytes,
    };
    await song.save();

    if (oldKey) {
      await storage.remove(oldKey).catch(() => {});
    }

    // Prepare the singer's voice track in the background (see jobs/voiceWorker.js).
    voiceTracks
      .enqueue(song)
      .catch((err) => console.error('Could not queue the voice track:', err.message));

    const output = song.toObject();
    delete output.audio.storageKey;
    res.json({ song: output });
  } catch (err) {
    next(err);
  }
}

// GET /songs/:songId/audio-url  (public songs: anyone; private: owner)
async function getAudioUrl(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId);
    if (!song || !canView(song, req.user)) {
      return res.status(404).json({ message: 'Song not found' });
    }
    if (!song.audio || !song.audio.storageKey) {
      return res.status(404).json({ message: 'This song has no audio yet' });
    }

    res.json({
      url: createSignedPath(song._id.toString(), URL_TTL_SECONDS),
      expiresInSeconds: URL_TTL_SECONDS,
      mimeType: song.audio.mimeType,
    });
  } catch (err) {
    next(err);
  }
}

// GET /songs/:songId/stream?exp=...&sig=...  (the signature is the permission)
async function streamAudio(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (!verifySignature(songId, req.query.exp, req.query.sig)) {
      return res.status(403).json({ message: 'This audio link is invalid or has expired' });
    }

    const song = await Song.findById(songId);
    if (!song || !song.audio || !song.audio.storageKey) {
      return res.status(404).json({ message: 'Not found' });
    }

    const key = song.audio.storageKey;
    let stats;
    try {
      stats = await storage.stat(key);
    } catch (err) {
      return res.status(404).json({ message: 'Audio file is missing' });
    }

    const size = stats.size;
    const range = parseRange(req.headers.range, size);

    res.setHeader('Content-Type', song.audio.mimeType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }

    let stream;
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      stream = storage.createReadStream(key, { start: range.start, end: range.end });
    } else {
      res.setHeader('Content-Length', size);
      stream = storage.createReadStream(key);
    }

    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadAudio, getAudioUrl, streamAudio };
