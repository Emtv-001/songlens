// Stand-in analyzer used until the real one exists (Step 40). It does not listen to the
// audio: it only proves that the queue, the worker and the status flow work end to end.
// The result is clearly marked as a placeholder so it can never be mistaken for analysis.
const DELAY_MS = 2000;

async function analyze() {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  return {
    engine: { name: 'placeholder', version: '0' },
    result: {
      placeholder: true,
      keyPc: null,
      mode: null,
      bpm: null,
      timeSignature: null,
      chords: [],
      melody: [],
    },
  };
}

module.exports = { analyze };