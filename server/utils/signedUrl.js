const crypto = require('crypto');

function getSecret() {
  const secret = process.env.AUDIO_URL_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET (or AUDIO_URL_SECRET) is missing in .env');
  return secret;
}

function sign(songId, exp) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${songId}.${exp}`)
    .digest('hex');
}

// Returns a relative URL that stays valid for ttlSeconds.
function createSignedPath(songId, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(songId, exp);
  return `/api/v1/songs/${songId}/stream?exp=${exp}&sig=${sig}`;
}

function verifySignature(songId, exp, sig) {
  const expNum = parseInt(exp, 10);
  if (!expNum || typeof sig !== 'string') return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(sign(songId, expNum), 'hex');
  let given;
  try {
    given = Buffer.from(sig, 'hex');
  } catch (err) {
    return false;
  }
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

module.exports = { createSignedPath, verifySignature };
