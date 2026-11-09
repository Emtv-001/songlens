const mongoose = require('mongoose');
const Song = require('../../models/Song');
const SongTimeline = require('../../models/SongTimeline');
const { validateTimeline } = require('../../utils/validateTimeline');

function canView(song, user) {
  if (song.visibility === 'public') return true;
  return Boolean(user && song.ownerId && song.ownerId.equals(user._id));
}

function canEdit(song, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(song.ownerId && song.ownerId.equals(user._id));
}

function emptyTimeline(songId) {
  return {
    songId,
    source: 'manual',
    keyPc: null,
    mode: null,
    bpm: null,
    timeSignature: '4/4',
    lyrics: [],
    chords: [],
    melody: [],
    revision: 0,
  };
}

// GET /songs/:songId/timeline
async function getTimeline(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId);
    if (!song || !canView(song, req.user)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const stored = await SongTimeline.findOne({ songId }).select('-__v').lean();
    res.json({
      // Defaults first, so timelines saved before the melody existed still have a melody list.
      timeline: { ...emptyTimeline(songId), ...(stored || {}) },
      canEdit: canEdit(song, req.user),
    });
  } catch (err) {
    next(err);
  }
}

// PUT /songs/:songId/timeline  (owner or admin)
async function saveTimeline(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId);
    if (!song || !canView(song, req.user) || !canEdit(song, req.user)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const { error, value } = validateTimeline(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const saved = await SongTimeline.findOneAndUpdate(
      { songId },
      {
        $set: { ...value, source: 'manual' },
        $setOnInsert: { songId },
        $inc: { revision: 1 },
      },
      { upsert: true, new: true, runValidators: true }
    )
      .select('-__v')
      .lean();

    res.json({ timeline: { ...emptyTimeline(songId), ...saved } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getTimeline, saveTimeline };