const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const Song = require('../../models/Song');

const HIDDEN_FIELDS = '-audio.storageKey';

async function listSongs(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const q = (req.query.q || '').toString().trim();

    const filter = { visibility: 'public' };
    if (q) filter.$text = { $search: q };

    const [songs, total] = await Promise.all([
      Song.find(filter)
        .select(HIDDEN_FIELDS)
        .sort({ title: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Song.countDocuments(filter),
    ]);

    res.json({ songs, page, limit, total });
  } catch (err) {
    next(err);
  }
}

// GET /songs/mine  (the logged-in user's own songs, private or not)
async function listMine(req, res, next) {
  try {
    const songs = await Song.find({ ownerId: req.user._id })
      .select(HIDDEN_FIELDS)
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ songs });
  } catch (err) {
    next(err);
  }
}

async function getSong(req, res, next) {
  try {
    const { songId } = req.params;
    if (!mongoose.isValidObjectId(songId)) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const song = await Song.findById(songId).select(HIDDEN_FIELDS);
    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    const isPublic = song.visibility === 'public';
    const isOwner =
      req.user && song.ownerId && song.ownerId.equals(req.user._id);

    if (!isPublic && !isOwner) {
      return res.status(404).json({ message: 'Song not found' });
    }

    res.json({ song });
  } catch (err) {
    next(err);
  }
}

async function createSong(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { title, artist, description } = req.body;

    const song = await Song.create({
      title,
      artist,
      description,
      sourceType: 'user_upload',
      ownerId: req.user._id,
      visibility: 'private',
    });

    res.status(201).json({ song });
  } catch (err) {
    next(err);
  }
}

module.exports = { listSongs, listMine, getSong, createSong };
