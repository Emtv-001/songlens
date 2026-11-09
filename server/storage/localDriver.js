const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const root = path.resolve(
  process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '../../storage')
);

function resolveKey(key) {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return full;
}

async function put(key, readable, { maxBytes } = {}) {
  const full = resolveKey(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });

  let sizeBytes = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;
      if (maxBytes && sizeBytes > maxBytes) {
        return callback(new Error('FILE_TOO_LARGE'));
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(readable, limiter, fs.createWriteStream(full));
  } catch (err) {
    await fs.promises.rm(full, { force: true });
    throw err;
  }

  return { sizeBytes };
}

async function exists(key) {
  try {
    await fs.promises.access(resolveKey(key));
    return true;
  } catch (err) {
    return false;
  }
}

async function stat(key) {
  return fs.promises.stat(resolveKey(key));
}

function createReadStream(key, options) {
  return fs.createReadStream(resolveKey(key), options);
}

async function remove(key) {
  await fs.promises.rm(resolveKey(key), { force: true });
}

module.exports = { put, exists, stat, createReadStream, remove };