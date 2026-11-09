const mongoose = require('mongoose');

// One automatic-analysis attempt for a song. Runs are kept as history and never edit the
// song's timeline directly: the timeline holds what the user has corrected, while the run
// keeps what the analyzer originally produced.
const analysisRunSchema = new mongoose.Schema(
  {
    songId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'succeeded', 'failed'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    engine: {
      name: { type: String, default: null },
      version: { type: String, default: null },
    },
    // Filled in by the analyzer when the run succeeds (defined in a later step).
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

analysisRunSchema.index({ songId: 1, createdAt: -1 });

module.exports = mongoose.model('AnalysisRun', analysisRunSchema);