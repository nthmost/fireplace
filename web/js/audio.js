// Procedural fire audio — no sound files, synthesized with the Web Audio API and
// reactive to the fire. A real fire is mostly *gaps*: a faint low warmth with
// discrete crackles/pops punctuating silence. So:
//   * bed    — very quiet low rumble (brown noise, heavily low-passed) ∝ vigor
//   * crackle— discrete pop EVENTS with Poisson spacing (genuine whitespace
//              between them); event RATE ∝ heat (seeders), pop loudness ∝ vigor.
// No continuous mid/high noise (that's what made it sound like the ocean).
// Muted by default; enabled by a user gesture (browser autoplay policy).

function makeNoise(ctx, seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; }
    else d[i] = white;
  }
  return buf;
}

export class FireAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this._timer = null;
    this._v = 0; this._h = 0; this._done = false;
    this._next = 0;          // next crackle-event time (ctx clock)
    this.volume = 0.9;
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.brown = makeNoise(ctx, 2.5, true);
    this.white = makeNoise(ctx, 2.5, false);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // bed: a soft low rumble only — nothing in the hiss range
    this.bedGain = ctx.createGain(); this.bedGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180; lp.Q.value = 0.5;
    const bed = ctx.createBufferSource(); bed.buffer = this.brown; bed.loop = true;
    bed.connect(lp).connect(this.bedGain).connect(this.master);
    bed.start();

    // crackles go through their own (slightly hotter) bus
    this.crackleBus = ctx.createGain(); this.crackleBus.gain.value = 1.5;
    this.crackleBus.connect(this.master);
  }

  // One pop. "tick" = a bright broadband SNAP (high-pass, near-instant attack —
  // not a tuned ring), otherwise a deeper woody pop. Scheduled at absolute `t`.
  _pop(t, loud) {
    const ctx = this.ctx;
    const tick = Math.random() < 0.72;
    const dur = tick ? 0.003 + Math.random() * 0.007 : 0.012 + Math.random() * 0.022;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = tick ? 0.9 + Math.random() * 1.4 : 0.6 + Math.random() * 1.0;
    const off = Math.random() * (this.white.duration - dur - 0.01);
    const filt = ctx.createBiquadFilter();
    if (tick) {
      // band-pass with a MODERATE Q: some resonant "crack" body, but not the
      // tonal high-Q plink (raindrop) nor the open high-pass hiss (ripping fabric)
      filt.type = "bandpass";
      filt.frequency.value = 1500 + Math.random() * 2600;
      filt.Q.value = 3 + Math.random() * 3.5;
    } else {
      filt.type = "bandpass";
      filt.frequency.value = 230 + Math.random() * 640;
      filt.Q.value = 1.4 + Math.random() * 2.2;
    }
    const g = ctx.createGain();
    const peak = (tick ? 0.17 : 0.26) * loud * (0.6 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);    // ~1ms attack: snappy, not harsh
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.crackleBus);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.05);
  }

  // A crackle "event" is usually a single pop; occasionally a distinct double/
  // triple "knock" — but spaced widely (80–160ms) so it never buzzes/rips.
  // Returns the time of the last pop, so the next event can be spaced from there.
  _emit(t) {
    const loud = 0.5 + 0.5 * this._v;
    let last = t;
    this._pop(last, loud);
    if (Math.random() < 0.16) { last += 0.08 + Math.random() * 0.08; this._pop(last, loud * 0.85); }
    if (Math.random() < 0.04) { last += 0.08 + Math.random() * 0.08; this._pop(last, loud * 0.7); }
    return last;
  }

  // Scheduler (~16ms). The gap to the next event = a hard MIN_GAP + an exponential
  // term, measured from the END of the previous cluster — so pops never bunch up
  // (what read as heavy rain / ripping). Mean gap shrinks with heat; top rate is
  // capped so even a roaring fire stays spacious.
  _tick() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const MIN_GAP = 0.11;
    if (this._next < now) this._next = now;
    while (this._next <= now + 0.05) {
      const end = this._emit(this._next);
      const intensity = this._h * (0.45 + 0.55 * this._v);
      const rate = 0.7 + 4.8 * intensity + (this._done ? 0.2 : 0);   // ~0.7 .. ~5.5 /s
      const meanGap = 1 / Math.max(0.3, rate);
      this._next = end + MIN_GAP + (-Math.log(Math.random() + 1e-6)) * meanGap;
    }
  }

  update(vigor, heat, done) {
    this._v = vigor; this._h = heat; this._done = done;
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const bed = (done ? 0.012 : 0.015) + 0.045 * vigor;   // soft low warmth only
    this.bedGain.gain.setTargetAtTime(bed, t, 0.4);
  }

  toggle() {
    if (!this.ctx) this._init();
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    if (this.enabled) {
      this.ctx.resume?.();
      this._next = t;
      this.master.gain.setTargetAtTime(this.volume, t, 0.2);
      if (!this._timer) this._timer = setInterval(() => this._tick(), 16);
    } else {
      this.master.gain.setTargetAtTime(0, t, 0.2);
      clearInterval(this._timer); this._timer = null;
    }
    return this.enabled;
  }
}
