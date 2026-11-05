const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../../models/User');

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function publicUser(user) {
  return { id: user._id, username: user.username, email: user.email, role: user.role };
}

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({
    errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
  });
  return true;
}

async function register(req, res, next) {
  try {
    if (validationFailed(req, res)) return;

    const { username, email, password } = req.body;

    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    });
    if (existing) {
      return res.status(409).json({ message: 'Email or username already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash });

    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    if (validationFailed(req, res)) return;

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    const valid = user && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.cookie('token', token, cookieOptions);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  res.clearCookie('token', { ...cookieOptions, maxAge: undefined });
  res.json({ message: 'Logged out' });
}

function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

module.exports = { register, login, logout, me };