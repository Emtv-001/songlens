const mongoose = require('mongoose');
const Song = require('../../models/Song');
const AnalysisRun = require('../../models/AnalysisRun');

const ACTIVE = ['queued', 'running'];

// Only the owner (or an admin) may analyse a song. Everyone else gets the same
// "Song not found" as elsewhere, so private songs stay private.
async function loadManageableSong(req, res) {
  const { songId } = req.params;
  if (!mongoose.isValidObjectId(songId)) {
    res.status(404).json({ message: 'Song not found' });
    return null;
  }
  const song = await Song.findById(songId);
  const isAdmin = req.user.role === 'admin';
  const isOwner = song && song.ownerId && song.ownerId.equals(req.user._id);
  if (!song || !(isAdmin || isOwner)) {
    res.status(404).json({ message: 'Song not found' });
    return null;
  }
  return song;
}

// POST /songs/:songId/analysis
async function requestAnalysis(req, res, next) {
  try {
    const song = await loadManageableSong(req, res);
    if (!song) return;

    if (!song.audio || !song.audio.storageKey) {
      return res.status(400).json({ message: 'Upload audio for this song before analysing it.' });
    }

    const active = await AnalysisRun.findOne({ songId: song._id, status: { $in: ACTIVE } });
    if (active) {
      return res.status(409).json({
        message: 'An analysis is already in progress for this song.',
        run: active,
      });
    }

    const run = await AnalysisRun.create({
      songId: song._id,
      requestedBy: req.user._id,
      status: 'queued',
    });
    res.status(202).json({ run });
  } catch (err) {
    next(err);
  }
}

// GET /songs/:songId/analysis  (newest first)
async function listRuns(req, res, next) {
  try {
    const song = await loadManageableSong(req, res);
    if (!song) return;

    const runs = await AnalysisRun.find({ songId: song._id })
      .select('-result')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ runs });
  } catch (err) {
    next(err);
  }
}

// GET /songs/:songId/analysis/:runId
async function getRun(req, res, next) {
  try {
    const song = await loadManageableSong(req, res);
    if (!song) return;

    const { runId } = req.params;
    if (!mongoose.isValidObjectId(runId)) {
      return res.status(404).json({ message: 'Analysis not found' });
    }
    const run = await AnalysisRun.findOne({ _id: runId, songId: song._id });
    if (!run) return res.status(404).json({ message: 'Analysis not found' });
    res.json({ run });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestAnalysis, listRuns, getRun };