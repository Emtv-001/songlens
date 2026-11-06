const express = require('express');
const requireAuth = require('../../middleware/requireAuth');
const {
  listLibrary,
  addToLibrary,
  removeFromLibrary,
} = require('./library.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', listLibrary);
router.post('/:songId', addToLibrary);
router.delete('/:songId', removeFromLibrary);

module.exports = router;