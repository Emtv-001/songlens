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

// One melody note. The pitch is a MIDI number (middle C = 60); names, solfege and
// staff notation are all derived from it.
const noteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    midi: { type: Number, required: true, min: 0, max: 127 },
  },
  { _id: false }
);

// Where the key changes during the song (empty when the key stays the same).
const keySectionSchema = new mongoose.Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    keyPc: { type: Number, required: true, min: 0, max: 11 },
    mode: { type: String, required: true, enum: ['major', 'minor'] },
  },
  { _id: false }
);

// A stretch of the song with one repeating chord progression, found by the analysis.
const progressionChordSchema = new mongoose.Schema(
  {
    root: { type: Number, required: true, min: 0, max: 11 },
    quality: { type: String, required: true },
  },
  { _id: false }
);

const progressionSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: ['loop', 'free'] },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    cycles: { type: Number, default: null },
    pattern: { type: [progressionChordSchema], default: [] },
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
    melody: { type: [noteSchema], default: [] },
    keySections: { type: [keySectionSchema], default: [] },
    sections: { type: [progressionSchema], default: [] },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SongTimeline', songTimelineSchema);