const express = require('express');
const optionalAuth = require('../../middleware/optionalAuth');
const requireAuth = require('../../middleware/requireAuth');
const { getTimeline, saveTimeline } = require('./timeline.controller');

const router = express.Router();

router.get('/:songId/timeline', optionalAuth, getTimeline);
router.put('/:songId/timeline', requireAuth, saveTimeline);

module.exports = router;