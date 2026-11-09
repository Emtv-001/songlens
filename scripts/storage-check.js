// Quick check of the storage driver chosen in .env (local or s3).
// Run with: node scripts/storage-check.js
// It uploads a small test file, reads it back (whole and a byte range), then deletes it.
require('dotenv').config();
const crypto = require('crypto');
const { Readable } = require('stream');
const storage = require('../server/storage');

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log(`Storage driver: ${process.env.STORAGE_DRIVER || 'local'}`);
  const key = `checks/storage-check-${Date.now()}`;
  const data = crypto.randomBytes(200 * 1024);

  const result = await storage.put(key, Readable.from([data]), { maxBytes: 5 * 1024 * 1024 });
  check('upload', result.sizeBytes === data.length, `${result.sizeBytes} bytes`);

  const stats = await storage.stat(key);
  check('size lookup', stats.size === data.length, `${stats.size} bytes`);

  const whole = await readAll(storage.createReadStream(key));
  check('read whole file', whole.equals(data));

  const part = await readAll(storage.createReadStream(key, { start: 1000, end: 1999 }));
  check('read a byte range', part.equals(data.subarray(1000, 2000)), `${part.length} bytes`);

  let tooLarge = false;
  try {
    await storage.put(`${key}-big`, Readable.from([data]), { maxBytes: 1024 });
  } catch (err) {
    tooLarge = err.message === 'FILE_TOO_LARGE';
  }
  check('size limit is enforced', tooLarge);
  await storage.remove(`${key}-big`).catch(() => {});

  await storage.remove(key);
  let gone = false;
  try {
    await storage.stat(key);
  } catch (err) {
    gone = true;
  }
  check('delete', gone);

  console.log(process.exitCode ? 'Some checks FAILED.' : 'All storage checks passed.');
}

main().catch((err) => {
  console.error('Storage check failed:', err.message);
  process.exit(1);
});