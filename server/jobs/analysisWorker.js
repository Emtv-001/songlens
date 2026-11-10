const Song = require('../models/Song');
const AnalysisRun = require('../models/AnalysisRun');
// ANALYSIS_ENGINE=placeholder in .env switches back to the fake analyzer (no Python needed).
const analyzer =
  process.env.ANALYSIS_ENGINE === 'placeholder'
    ? require('./analyzers/placeholder')
    : require('./analyzers/dsp');

const POLL_MS = Number(process.env.ANALYSIS_POLL_MS) || 3000;
const STALE_MS = 10 * 60 * 1000; // a run "running" for longer than this is assumed lost
const MAX_ATTEMPTS = 3;

let timer = null;
let busy = false;

// A run left "running" by a crash or restart goes back in the queue, up to MAX_ATTEMPTS.
async function recoverStaleRuns() {
  const cutoff = new Date(Date.now() - STALE_MS);
  await AnalysisRun.updateMany(
    { status: 'running', startedAt: { $lt: cutoff }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { status: 'queued', startedAt: null } }
  );
  await AnalysisRun.updateMany(
    { status: 'running', startedAt: { $lt: cutoff }, attempts: { $gte: MAX_ATTEMPTS } },
    { $set: { status: 'failed', error: 'The analysis timed out.', finishedAt: new Date() } }
  );
}

// Taking a run and marking it "running" is one atomic step, so two workers can never
// pick up the same run.
function claimNextRun() {
  return AnalysisRun.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', startedAt: new Date(), error: null }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
}

// Only updates a run that is still "running", so a run whose song was deleted meanwhile
// is not brought back to life.
function finishRun(run, fields) {
  return AnalysisRun.findOneAndUpdate(
    { _id: run._id, status: 'running' },
    { $set: { ...fields, finishedAt: new Date() } }
  );
}

async function processRun(run) {
  try {
    const song = await Song.findById(run.songId);
    if (!song) throw new Error('The song no longer exists.');
    if (!song.audio || !song.audio.storageKey) throw new Error('The song has no audio.');

    const { engine, result } = await analyzer.analyze(song, run);
    await finishRun(run, { status: 'succeeded', engine, result });
  } catch (err) {
    console.error('Analysis failed:', err.message);
    await finishRun(run, { status: 'failed', error: String(err.message || err).slice(0, 500) });
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await recoverStaleRuns();
    let run = await claimNextRun();
    while (run) {
      await processRun(run);
      run = await claimNextRun();
    }
  } catch (err) {
    console.error('Analysis worker error:', err.message);
  } finally {
    busy = false;
  }
}

function start() {
  if (timer) return;
  if (process.env.ANALYSIS_WORKER === 'off') {
    console.log('Analysis worker is switched off (ANALYSIS_WORKER=off).');
    return;
  }
  timer = setInterval(tick, POLL_MS);
  timer.unref();
  console.log(`Analysis worker started (checks every ${POLL_MS / 1000}s).`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };