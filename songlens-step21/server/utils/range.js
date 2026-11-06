// Parses an HTTP Range header like "bytes=0-1023" for a file of `size` bytes.
// Returns { start, end } (inclusive), null if there is no Range header,
// or 'invalid' if the range cannot be satisfied.
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  let start;
  let end;

  if (match[1] === '' && match[2] === '') return 'invalid';

  if (match[1] === '') {
    // Suffix range: last N bytes
    const suffix = parseInt(match[2], 10);
    if (!suffix) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  }

  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

module.exports = { parseRange };
