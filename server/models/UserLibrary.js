const mongoose = require('mongoose');

const userLibrarySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
    collectionName: { type: String, trim: true, maxlength: 100, default: 'Saved' },
    isFavourite: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'savedAt', updatedAt: 'updatedAt' } }
);

userLibrarySchema.index({ userId: 1, songId: 1 }, { unique: true });

module.exports = mongoose.model('UserLibrary', userLibrarySchema);