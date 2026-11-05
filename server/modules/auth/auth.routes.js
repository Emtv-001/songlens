const express = require('express');
const { body } = require('express-validator');
const { register, login, logout, me } = require('./auth.controller');
const requireAuth = require('../../middleware/requireAuth');

const router = express.Router();

router.post(
  '/register',
  [
    body('username')
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage('Username must be 3 to 30 characters'),
    body('email').trim().isEmail().withMessage('A valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  register
);

router.post(
  '/login',
  [
    body('email').trim().isEmail().withMessage('A valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  login
);

router.post('/logout', logout);

router.get('/me', requireAuth, me);

module.exports = router;