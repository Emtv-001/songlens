// Plays the recording in another key by shifting its pitch in the browser, without changing the
// speed. It uses the SoundTouch audio worklet (MPL-2.0, see vendor/SOUNDTOUCH-LICENSE.txt).
// The <audio> element stays the clock, so every view keeps following the playback.
const KeyShifter = (() => {
  const PROCESSOR_URL = '/js/vendor/soundtouch-processor.js';
  const PROCESSOR_NAME = 'soundtouch-processor';
  const MAX_SHIFT = 6; // beyond this the sound gets rough, so it is moved by an octave instead
  const LOAD_TIMEOUT_MS = 20000;

  function supported() {
    return Boolean(window.AudioContext && window.AudioWorklet && window.AudioWorkletNode);
  }

  // +9 half steps is the same key as -3 (an octave apart), so the sound stays within -6..+6.
  function soundShift(semitones) {
    let n = semitones;
    while (n > MAX_SHIFT) n -= 12;
    while (n < -MAX_SHIFT) n += 12;
    return n;
  }

  // The sentence shown under "Change key". problem: '' | 'loading' | 'unsupported' | 'storage' | 'browser'
  function describe({ on, transpose, problem }) {
    const tail = ' Your saved chords are not changed.';
    if (!on) return 'Only what you see changes. The recording sounds the same.' + tail;
    if (problem === 'unsupported') return "This browser can't change the sound, so only what you see changes." + tail;
    if (problem === 'storage') {
      return "The sound can't be changed yet because the audio storage is not set up for it. Only what you see changes." + tail;
    }
    if (problem === 'browser') return 'The sound could not be changed here, so only what you see changes.' + tail;
    if (problem === 'loading') return 'Getting the sound ready…' + tail;
    if (transpose === 0) return 'The recording plays in its original key.' + tail;
    const shift = soundShift(transpose);
    const steps = Math.abs(shift);
    let text = 'The recording sounds ' + steps + ' half step' + (steps === 1 ? '' : 's') + (shift > 0 ? ' higher.' : ' lower.');
    if (shift !== transpose) {
      text += ' That is the same key as ' + (transpose > 0 ? '+' : '') + transpose + ', one octave ' + (shift < transpose ? 'lower' : 'higher') + '.';
    }
    return text + tail;
  }

  // audio: the <audio> element. freshUrl(): returns a new signed link to the recording.
  function create(audio, freshUrl) {
    let ctx = null;
    let node = null;
    let source = null;
    let ready = false;
    let failed = '';
    let testing = false;
    let wanted = 0;
    let through = false;
    let queue = Promise.resolve();

    function isCrossOrigin() {
      try {
        return new URL(audio.currentSrc || audio.src, window.location.href).origin !== window.location.origin;
      } catch (err) {
        return false;
      }
    }

    // Reloads the recording with or without the "anonymous" setting, so the browser is allowed
    // to process audio that comes from another address (the storage bucket).
    function reload(cors, position, wasPlaying) {
      return new Promise((resolve) => {
        testing = true;
        let timer = null;
        const finish = (ok) => {
          clearTimeout(timer);
          audio.removeEventListener('loadedmetadata', onLoaded);
          audio.removeEventListener('error', onError);
          if (ok) {
            try {
              audio.currentTime = position;
            } catch (err) {
              // the position is restored when possible
            }
            if (wasPlaying) audio.play().catch(() => {});
          }
          setTimeout(() => {
            testing = false;
          }, 500);
          resolve(ok);
        };
        const onLoaded = () => finish(true);
        const onError = () => finish(false);
        audio.addEventListener('loadedmetadata', onLoaded);
        audio.addEventListener('error', onError);
        timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
        Promise.resolve(freshUrl())
          .then((url) => {
            if (cors) audio.crossOrigin = 'anonymous';
            else audio.removeAttribute('crossorigin');
            audio.src = url;
            audio.load();
          })
          .catch(() => finish(false));
      });
    }

    async function prepare() {
      if (ready) return true;
      if (failed) return false;
      if (!audio.src) return false; // nothing loaded yet; try again at the next change

      if (isCrossOrigin() && audio.crossOrigin !== 'anonymous') {
        const position = audio.currentTime;
        const wasPlaying = !audio.paused;
        const ok = await reload(true, position, wasPlaying);
        if (!ok) {
          await reload(false, position, wasPlaying); // back to normal playback, same place
          failed = 'storage';
          return false;
        }
      }

      try {
        ctx = new window.AudioContext();
        await ctx.audioWorklet.addModule(PROCESSOR_URL);
        node = new window.AudioWorkletNode(ctx, PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { sampleBufferType: 'circular' },
        });
        node.connect(ctx.destination);
        source = ctx.createMediaElementSource(audio); // from here on, the sound goes through ctx
        source.connect(ctx.destination);
        audio.addEventListener('play', () => {
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        });
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        ready = true;
        return true;
      } catch (err) {
        failed = 'browser';
        if (ctx && !source) ctx.close().catch(() => {});
        return false;
      }
    }

    function route(shifted) {
      if (through === shifted) return;
      source.disconnect();
      source.connect(shifted ? node : ctx.destination);
      through = shifted;
    }

    function apply() {
      if (!ready) return;
      if (wanted === 0) {
        audio.preservesPitch = true;
        route(false);
        return;
      }
      audio.preservesPitch = false; // SoundTouch keeps the pitch right, so the browser must not
      const p = node.parameters;
      p.get('playbackRate').value = audio.playbackRate;
      p.get('pitch').value = 1;
      p.get('pitchSemitones').value = wanted;
      route(true);
    }

    // Shifts the sound by semitones (already within -6..+6). Resolves to '' or a problem name.
    function set(semitones) {
      wanted = semitones;
      queue = queue.then(async () => {
        if (!ready && wanted === 0) return failed;
        if (!(await prepare())) return failed || 'browser';
        apply();
        return '';
      });
      return queue;
    }

    return {
      set,
      refresh: apply, // call after the playback speed changes
      ready: () => ready,
      testing: () => testing,
    };
  }

  return { supported, soundShift, describe, create };
})();
