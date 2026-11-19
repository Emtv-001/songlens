const mongoose = require('mongoose');

// The singer's voice, separated from a song once and kept so that "follow the singer's voice
// only" analysis takes seconds. It belongs to one version of the song's audio (audioKey): when
// the audio is replaced the track no longer matches and is replaced too.
const voiceTrackSchema = new mongoose.Schema(
  {
    songId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      unique: true,
    },
    audioKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'ready', 'failed'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    storageKey: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VoiceTrack', voiceTrackSchema);
