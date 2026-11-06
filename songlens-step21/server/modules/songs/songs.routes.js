const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const optionalAuth = require('../../middleware/optionalAuth');
const requireAuth = require('../../middleware/requireAuth');
const { listSongs, listMine, getSong, createSong } = require('./songs.controller');
const { uploadAudio, getAudioUrl, streamAudio } = require('./audio.controller');

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many uploads. Please try again later.' },
});

router.get('/', listSongs);

// Must come before '/:songId' so "mine" is not read as an id.
router.get('/mine', requireAuth, listMine);

router.post(
  '/',
  requireAuth,
  [
    body('title')
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Title is required (max 200 characters)'),
    body('artist')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Artist must be 200 characters or fewer'),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must be 2000 characters or fewer'),
  ],
  createSong
);

router.post('/:songId/audio', requireAuth, uploadLimiter, uploadAudio);
router.get('/:songId/audio-url', optionalAuth, getAudioUrl);
router.get('/:songId/stream', streamAudio);

router.get('/:songId', optionalAuth, getSong);

module.exports = router;
