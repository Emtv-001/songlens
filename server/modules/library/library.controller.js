const mongoose = require('mongoose');
const Song = require('../../models/Song');
const UserLibrary = require('../../models/UserLibrary');

function canAccess(song, user) {
  if (song.visibility === 'public') return true;
  return Boolean(song.ownerId && song.ownerId.equals(user._id));
}

async function listLibrary(req, res, next) {
  try {
    const entries = await UserLibrary.find({ userId: req.user._id })
      .sort({ savedAt: -1 })
      .populate({ path: 'songId', select: '-audio.storageKey' });

    const items = entries
      .filter((entry) => entry.songId && canAccess(entry.songId, req.user))
      .map((entry) => ({
        song: entry.songId,
        collectionName: entry.collectionName,
        isFavourite: entry.isFavourite,
        savedAt: entry.savedAt,
      }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function addToLibrary(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId);
    if (!song || !canAccess(song, req.user)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    try {
      await UserLibrary.create({ userId: req.user._id, songId: song._id });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(200).json({ message: 'Already in your library' });
      }
      throw err;
    }

    res.status(201).json({ message: 'Saved to your library' });
  } catch (err) {
    next(err);
  }
}

async function removeFromLibrary(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Not in your library' });
    }

    const result = await UserLibrary.deleteOne({
      userId: req.user._id,
      songId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Not in your library' });
    }

    res.json({ message: 'Removed from your library' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listLibrary, addToLibrary, removeFromLibrary };