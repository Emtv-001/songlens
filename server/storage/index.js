// Picks the storage driver from STORAGE_DRIVER in .env:
//   local (default) - files on this computer, in the storage/ folder
//   s3              - any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, MinIO...)
const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

if (driver === 'local') {
  module.exports = require('./localDriver');
} else if (driver === 's3') {
  module.exports = require('./s3Driver').createFromEnv();
} else {
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}. Use "local" or "s3".`);
}