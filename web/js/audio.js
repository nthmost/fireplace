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

    // crackles go through their own bus
    this.crackleBus = ctx.createGain(); this.crackleBus.gain.value = 1;
    this.crackleBus.connect(this.master);
  }

  // One pop: a short enveloped noise burst through a resonant filter. "tick" =
  // bright snap, otherwise a deeper woody pop. Scheduled at absolute time `t`.
  _pop(t, loud) {
    const ctx = this.ctx;
    const tick = Math.random() < 0.72;
    const dur = tick ? 0.002 + Math.random() * 0.006 : 0.01 + Math.random() * 0.022;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.7 + Math.random() * 1.8;
    const off = Math.random() * (this.white.duration - dur - 0.01);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    if (tick) { bp.frequency.value = 1600 + Math.random() * 2800; bp.Q.value = 5 + Math.random() * 7; }
    else { bp.frequency.value = 260 + Math.random() * 640; bp.Q.value = 2 + Math.random() * 4; }
    const g = ctx.createGain();
    const peak = (tick ? 0.10 : 0.17) * loud * (0.55 + Math.random() * 0.45);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.crackleBus);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.05);
  }

  // A crackle "event" is usually a single pop, sometimes a quick little roll.
  _emit(t) {
    const loud = 0.5 + 0.5 * this._v;
    let n = 1;
    if (Math.random() < 0.35) n++;
    if (Math.random() < 0.15) n++;
    let tt = t;
    for (let i = 0; i < n; i++) {
      this._pop(tt, loud);
      tt += 0.012 + Math.random() * 0.055;
    }
  }

  // Scheduler (~16ms). Emits due events and picks the next gap from an exponential
  // distribution — mean gap shrinks as heat rises, so a cold fire is nearly silent
  // with long pauses and a hot one crackles busily.
  _tick() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this._next < now) this._next = now;
    while (this._next <= now + 0.05) {
      this._emit(this._next);
      const rate = 0.45 + 9 * this._h * (0.4 + 0.6 * this._v) + (this._done ? 0.25 : 0);
      const meanGap = 1 / Math.max(0.25, rate);
      this._next += -Math.log(Math.random() + 1e-6) * meanGap;
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
