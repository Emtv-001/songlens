// One shared playback clock. The <audio> element is the single source of truth.
// Components subscribe and receive the same state; none of them keeps its own timer.
class PlaybackClock {
  constructor(audio) {
    this.audio = audio;
    this.listeners = new Set();
    this.raf = null;
    this.loop = this.loop.bind(this);

    const emit = (reason) => () => this.emit(reason);

    audio.addEventListener('play', () => {
      this.startLoop();
      this.emit('play');
    });
    audio.addEventListener('pause', () => {
      this.stopLoop();
      this.emit('pause');
    });
    audio.addEventListener('ended', () => {
      this.stopLoop();
      this.emit('ended');
    });
    audio.addEventListener('seeking', emit('seek'));
    audio.addEventListener('seeked', emit('seek'));
    audio.addEventListener('ratechange', emit('rate'));
    audio.addEventListener('loadedmetadata', emit('ready'));
    // While paused, scrubbing still changes the time.
    audio.addEventListener('timeupdate', () => {
      if (!this.playing) this.emit('scrub');
    });
  }

  get time() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  get rate() {
    return this.audio.playbackRate || 1;
  }

  state(reason) {
    return {
      reason,
      time: this.time,
      duration: this.duration,
      playing: this.playing,
      rate: this.rate,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state('subscribe'));
    return () => this.listeners.delete(listener);
  }

  emit(reason) {
    const state = this.state(reason);
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('Clock listener failed:', err);
      }
    });
  }

  startLoop() {
    if (this.raf === null) this.raf = requestAnimationFrame(this.loop);
  }

  stopLoop() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  loop() {
    this.raf = null;
    this.emit('tick');
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  }
}

if (typeof module !== 'undefined') module.exports = PlaybackClock;