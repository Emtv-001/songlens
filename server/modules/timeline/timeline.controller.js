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

// True when the two chord lists are the same chords at the same times (ids are ignored).
function sameChords(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every(
    (c, i) =>
      c.start === b[i].start &&
      c.end === b[i].end &&
      c.root === b[i].root &&
      c.quality === b[i].quality &&
      (c.bass ?? null) === (b[i].bass ?? null)
  );
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
    keySections: [],
    sections: [],
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

    // Key changes and chord sections come from an analysis. If the chords or the main key are
    // edited by hand, they no longer describe the song, so they are cleared.
    const before = await SongTimeline.findOne({ songId }).select('chords keyPc mode').lean();
    const set = { ...value, source: 'manual' };
    if (!before || !sameChords(before.chords, value.chords)) set.sections = [];
    if (!before || before.keyPc !== value.keyPc || before.mode !== value.mode) set.keySections = [];

    const saved = await SongTimeline.findOneAndUpdate(
      { songId },
      {
        $set: set,
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