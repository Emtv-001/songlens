const express = require('express');

const app = express();

app.use(express.json());

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', app: 'SongLens' });
});

app.use('/api/v1/auth', require('./modules/auth/auth.routes'));

module.exports = app;