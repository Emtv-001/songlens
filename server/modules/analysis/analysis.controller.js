const mongoose = require('mongoose');
const Song = require('../../models/Song');
const AnalysisRun = require('../../models/AnalysisRun');
const SongTimeline = require('../../models/SongTimeline');

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

// POST /songs/:songId/analysis/:runId/apply
// Copies the chosen findings of a finished run into the song's timeline. The run itself is
// never changed, so the original analysis stays available. Chords, melody and lyrics in the
// timeline are not touched.
// Body (all optional): { key: boolean, tempo: boolean, bpm: number }
async function applyRun(req, res, next) {
  try {
    const song = await loadManageableSong(req, res);
    if (!song) return;

    const { runId } = req.params;
    if (!mongoose.isValidObjectId(runId)) {
      return res.status(404).json({ message: 'Analysis not found' });
    }
    const run = await AnalysisRun.findOne({ _id: runId, songId: song._id });
    if (!run) return res.status(404).json({ message: 'Analysis not found' });
    if (run.status !== 'succeeded' || !run.result) {
      return res.status(409).json({ message: 'This analysis has not finished successfully.' });
    }

    const body = req.body || {};
    const useKey = body.key !== false;
    const useTempo = body.tempo !== false;
    if (!useKey && !useTempo) {
      return res.status(400).json({ message: 'Choose the key, the tempo, or both.' });
    }

    const result = run.result;
    const changes = { analysisId: run._id };

    if (useKey) {
      const validKey =
        Number.isInteger(result.keyPc) &&
        result.keyPc >= 0 &&
        result.keyPc <= 11 &&
        (result.mode === 'major' || result.mode === 'minor');
      if (!validKey) {
        return res.status(400).json({ message: 'This analysis did not find a key.' });
      }
      changes.keyPc = result.keyPc;
      changes.mode = result.mode;
    }

    if (useTempo) {
      let bpm = result.bpm;
      if (body.bpm !== undefined) {
        const allowed = [result.bpm, ...(Array.isArray(result.bpmAlternatives) ? result.bpmAlternatives : [])];
        if (typeof body.bpm !== 'number' || !allowed.includes(body.bpm)) {
          return res.status(400).json({ message: 'That tempo is not one the analysis found.' });
        }
        bpm = body.bpm;
      }
      if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
        return res.status(400).json({ message: 'This analysis did not find a tempo.' });
      }
      changes.bpm = bpm;
    }

    const saved = await SongTimeline.findOneAndUpdate(
      { songId: song._id },
      { $set: changes, $inc: { revision: 1 } },
      { upsert: true, new: true, runValidators: true }
    )
      .select('keyPc mode bpm revision')
      .lean();

    res.json({ timeline: saved });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestAnalysis, listRuns, getRun, applyRun };