const express = require('express');
const rateLimit = require('express-rate-limit');
const requireAuth = require('../../middleware/requireAuth');
const { requestAnalysis, listRuns, getRun } = require('./analysis.controller');

const router = express.Router();

const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many analysis requests. Please try again later.' },
});

router.post('/:songId/analysis', requireAuth, analysisLimiter, requestAnalysis);
router.get('/:songId/analysis', requireAuth, listRuns);
router.get('/:songId/analysis/:runId', requireAuth, getRun);

module.exports = router;