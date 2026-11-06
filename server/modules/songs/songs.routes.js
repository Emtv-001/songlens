const express = require('express');
const optionalAuth = require('../../middleware/optionalAuth');
const { listSongs, getSong } = require('./songs.controller');

const router = express.Router();

router.get('/', listSongs);
router.get('/:songId', optionalAuth, getSong);

module.exports = router;