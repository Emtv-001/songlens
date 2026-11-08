# SongLens

See what you hear.

SongLens is an AI-powered music analysis and learning platform.

## Setup

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in your values.
4. Run `npm run dev` and open http://localhost:5000.

## Environment variables

See `.env.example`. Never commit your real `.env` file.

## What works now

- Accounts: register, log in, log out (JWT in an httpOnly cookie).
- Public song library with search, and a personal library.
- Audio upload (MP3, WAV, M4A, OGG, FLAC) with content checks and a size limit.
- Audio playback through expiring signed links, with seeking.
- Music workspace: shared playback clock, chord timeline, interactive piano,
  synchronized lyrics, and a manual editor for chords, lyrics, key and tempo.

## Known limitations

- Audio is stored on local disk (`storage/`). The S3-compatible driver is still to do.
- Chords, lyrics, key and tempo are entered manually. Automatic analysis comes later.
- Roman numerals, solfege, transposition, staff notation and melody are not built yet.

## Status

Phase 1 (foundation and authentication): complete.
Phase 2 (songs and uploads): complete except external object storage.
Phase 3 (musical workspace): complete.

© 2026 EMTV TECH. All rights reserved.