const { Transform } = require('stream');

function detectAudio(buf) {
  if (buf.length < 12) return null;

  if (buf.toString('latin1', 0, 3) === 'ID3') {
    return { mime: 'audio/mpeg' };
  }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { mime: 'audio/mpeg' };
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') {
    return { mime: 'audio/wav' };
  }
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    return { mime: 'audio/mp4' };
  }
  if (buf.toString('latin1', 0, 4) === 'OggS') {
    return { mime: 'audio/ogg' };
  }
  if (buf.toString('latin1', 0, 4) === 'fLaC') {
    return { mime: 'audio/flac' };
  }
  return null;
}

function createSniffer(onDetect) {
  let head = Buffer.alloc(0);
  let checked = false;

  return new Transform({
    transform(chunk, encoding, callback) {
      if (!checked) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= 12) {
          const type = detectAudio(head);
          if (!type) return callback(new Error('INVALID_AUDIO'));
          checked = true;
          onDetect(type);
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!checked) return callback(new Error('INVALID_AUDIO'));
      callback();
    },
  });
}

module.exports = { detectAudio, createSniffer };
