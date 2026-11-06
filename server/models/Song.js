const mongoose = require('mongoose');

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    artist: { type: String, trim: true, maxlength: 200, default: '' },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    sourceType: {
      type: String,
      enum: ['public_domain', 'user_upload'],
      required: true,
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    visibility: {
      type: String,
      enum: ['private', 'public'],
      default: 'private',
    },
    audio: {
      storageKey: { type: String, default: null },
      originalName: { type: String, default: null },
      mimeType: { type: String, default: null },
      sizeBytes: { type: Number, default: null },
    },
    durationSeconds: { type: Number, default: null },
    latestAnalysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AnalysisRun',
      default: null,
    },
  },
  { timestamps: true }
);

songSchema.index({ title: 'text', artist: 'text' });
songSchema.index({ visibility: 1, createdAt: -1 });
songSchema.index({ ownerId: 1 });

module.exports = mongoose.model('Song', songSchema);