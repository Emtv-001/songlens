const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());

// Timelines can be large, so they get a bigger body limit than the rest of the API.
app.use('/api/v1/songs/:songId/timeline', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, '../client')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', app: 'SongLens' });
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth', require('./modules/auth/auth.routes'));
app.use('/api/v1/songs', require('./modules/songs/songs.routes'));
app.use('/api/v1/songs', require('./modules/timeline/timeline.routes'));
app.use('/api/v1/songs', require('./modules/analysis/analysis.routes'));
app.use('/api/v1/users/me/library', require('./modules/library/library.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;