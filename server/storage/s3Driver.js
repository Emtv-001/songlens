// Storage driver for any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, MinIO...).
// It offers the same four functions as the local driver, so nothing else in the app changes:
//   put(key, stream, { maxBytes })  -> { sizeBytes }
//   stat(key)                       -> { size }
//   createReadStream(key, range)    -> readable stream ({ start, end } is optional)
//   remove(key)
// The bucket stays PRIVATE. Files are only ever served through the app's signed audio links.
const { PassThrough, Transform, pipeline } = require('stream');

const PART_SIZE = 5 * 1024 * 1024; // the smallest multipart size S3 accepts

function isNotFound(err) {
  return (
    err &&
    (err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.Code === 'NoSuchKey' ||
      (err.$metadata && err.$metadata.httpStatusCode === 404))
  );
}

// `sdk` holds the AWS SDK pieces so the driver can be tested without the network:
// { client, Upload, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand }
function createS3Driver(sdk, { bucket }) {
  const { client, Upload, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = sdk;

  async function put(key, stream, options = {}) {
    const { maxBytes } = options;
    let size = 0;
    let streamError = null;

    const counter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (maxBytes && size > maxBytes) return callback(new Error('FILE_TOO_LARGE'));
        return callback(null, chunk);
      },
    });
    counter.on('error', (err) => {
      if (!streamError) streamError = err;
    });

    // Errors from the incoming stream (for example INVALID_AUDIO) stop the upload.
    const body = pipeline(stream, counter, () => {});

    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: key, Body: body, ContentType: 'application/octet-stream' },
      queueSize: 2,
      partSize: PART_SIZE,
      leavePartsOnError: false,
    });

    try {
      await upload.done();
    } catch (err) {
      await Promise.resolve(upload.abort()).catch(() => {});
      await remove(key).catch(() => {});
      // Report the real reason (too large, not audio) rather than a wrapped SDK error.
      throw streamError || err;
    }

    return { sizeBytes: size };
  }

  async function stat(key) {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: head.ContentLength };
    } catch (err) {
      if (isNotFound(err)) {
        const missing = new Error('NOT_FOUND');
        missing.code = 'ENOENT';
        throw missing;
      }
      console.error('Storage error while reading file details:', err.name || err.message);
      throw err;
    }
  }

  // The caller needs a stream straight away, but S3 answers asynchronously,
  // so we hand back a pass-through stream and fill it when the answer arrives.
  function createReadStream(key, range) {
    const out = new PassThrough();
    const params = { Bucket: bucket, Key: key };
    if (range && Number.isInteger(range.start) && Number.isInteger(range.end)) {
      params.Range = `bytes=${range.start}-${range.end}`;
    }

    let source = null;
    let closed = false;
    out.on('close', () => {
      closed = true;
      if (source && typeof source.destroy === 'function') source.destroy();
    });

    client
      .send(new GetObjectCommand(params))
      .then((response) => {
        if (closed) {
          if (response.Body && response.Body.destroy) response.Body.destroy();
          return;
        }
        source = response.Body;
        source.on('error', (err) => out.destroy(err));
        source.pipe(out);
      })
      .catch((err) => {
        if (!closed) out.destroy(err);
      });

    return out;
  }

  async function remove(key) {
    // Deleting something that is already gone is not an error in S3.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  return { put, stat, createReadStream, remove };
}

// Builds the driver from environment variables (see .env.example).
function createFromEnv() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET in your .env file');
  }

  let clientS3;
  let libStorage;
  try {
    clientS3 = require('@aws-sdk/client-s3');
    libStorage = require('@aws-sdk/lib-storage');
  } catch (err) {
    throw new Error(
      'STORAGE_DRIVER=s3 needs the AWS SDK. Run: npm install @aws-sdk/client-s3 @aws-sdk/lib-storage'
    );
  }

  const config = {
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  };
  if (process.env.S3_ENDPOINT) config.endpoint = process.env.S3_ENDPOINT;
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }

  return createS3Driver(
    {
      client: new clientS3.S3Client(config),
      Upload: libStorage.Upload,
      HeadObjectCommand: clientS3.HeadObjectCommand,
      GetObjectCommand: clientS3.GetObjectCommand,
      DeleteObjectCommand: clientS3.DeleteObjectCommand,
    },
    { bucket }
  );
}

module.exports = { createS3Driver, createFromEnv };