// Procedural fire audio — no sound files, synthesized with the Web Audio API and
// reactive to the fire. Three layers:
//   * roar  — brown noise through a low-pass; louder with flame height (vigor)
//   * sizzle— white noise through a band-pass; rises with heat (seeders)
//   * crackle — short random noise pops; rate/loudness scale with the blaze
// Muted by default; must be enabled by a user gesture (browser autoplay policy).

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
    this.volume = 0.85;
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

    // roar: brown noise → lowpass
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 480; lp.Q.value = 0.6;
    const roarSrc = ctx.createBufferSource(); roarSrc.buffer = this.brown; roarSrc.loop = true;
    roarSrc.connect(lp).connect(this.roarGain).connect(this.master);
    roarSrc.start();

    // sizzle: white noise → bandpass
    this.sizzleGain = ctx.createGain(); this.sizzleGain.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.5;
    const sizSrc = ctx.createBufferSource(); sizSrc.buffer = this.white; sizSrc.loop = true;
    sizSrc.connect(bp).connect(this.sizzleGain).connect(this.master);
    sizSrc.start();

    // crackle bus
    this.crackleBus = ctx.createGain(); this.crackleBus.gain.value = 0.9;
    this.crackleBus.connect(this.master);
  }

  _pop(intensity) {
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 0.008 + Math.random() * 0.045;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.6 + Math.random() * 1.6;
    const off = Math.random() * (this.white.duration - dur - 0.01);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500 + Math.random() * 2800;
    bp.Q.value = 1 + Math.random() * 3;
    const g = ctx.createGain();
    const peak = (0.06 + Math.random() * 0.18) * intensity;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.crackleBus);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.05);
  }

  _tick() {
    if (!this.enabled) return;
    // crackle probability per ~16ms tick: a lively fire pops constantly, embers rarely
    const intensity = Math.max(this._done ? 0.12 : 0.0, this._v) * (0.35 + 0.65 * this._h);
    const p = 0.02 + 0.45 * intensity;
    if (Math.random() < p) this._pop(0.5 + 0.5 * this._v);
    if (Math.random() < p * 0.4) this._pop(0.4 + 0.4 * this._v);
  }

  update(vigor, heat, done) {
    this._v = vigor; this._h = heat; this._done = done;
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // roar follows flame height; a little floor so embers still breathe
    const roar = (done ? 0.03 : 0.04) + 0.22 * vigor;
    const sizzle = 0.012 + 0.06 * heat * (0.4 + 0.6 * vigor);
    this.roarGain.gain.setTargetAtTime(roar, t, 0.3);
    this.sizzleGain.gain.setTargetAtTime(sizzle, t, 0.3);
  }

  toggle() {
    if (!this.ctx) this._init();
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    if (this.enabled) {
      this.ctx.resume?.();
      this.master.gain.setTargetAtTime(this.volume, t, 0.2);
      if (!this._timer) this._timer = setInterval(() => this._tick(), 16);
    } else {
      this.master.gain.setTargetAtTime(0, t, 0.2);
      clearInterval(this._timer); this._timer = null;
    }
    return this.enabled;
  }
}
