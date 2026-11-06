const mongoose = require('mongoose');

const lyricSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const chordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    root: { type: Number, required: true, min: 0, max: 11 },
    quality: { type: String, required: true },
    bass: { type: Number, default: null, min: 0, max: 11 },
  },
  { _id: false }
);

const songTimelineSchema = new mongoose.Schema(
  {
    songId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      unique: true,
    },
    analysisId: { type: mongoose.Schema.Types.ObjectId, default: null },
    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    keyPc: { type: Number, default: null, min: 0, max: 11 },
    mode: { type: String, enum: ['major', 'minor', null], default: null },
    bpm: { type: Number, default: null },
    timeSignature: { type: String, default: '4/4' },
    lyrics: { type: [lyricSchema], default: [] },
    chords: { type: [chordSchema], default: [] },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SongTimeline', songTimelineSchema);