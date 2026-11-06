// Procedural fire audio — synthesized (no files), reactive to the fire, and with
// SWAPPABLE meaning modes so we can experiment with what the sound *represents*:
//
//   'aesthetic' — crackle rate from a heat×speed blend (by-ear, no literal meaning)
//   'pieces'    — crackle rate = download speed ÷ piece size: each pop ≈ one piece
//                 of the file arriving. seeders → warmth of the bed. (meaningful)
//   'events'    — 'pieces' PLUS a soft "give"/exhale whenever we're seeding to a
//                 peer, so receiving (sharp crackle) and giving (soft breath) sound
//                 different. every sound maps to a real torrent event.
//
// A real fire is mostly *gaps*: faint low warmth, discrete crackles, silence
// between. Muted by default; enabled by a user gesture (autoplay policy).

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
  constructor(mode = "pieces") {
    this.ctx = null;
    this.enabled = false;
    this.mode = mode;
    this._timer = null;
    this._v = 0; this._h = 0; this._done = false;
    this._pieceRate = 0;   // pieces/sec arriving (speed ÷ piece size)
    this._up = 0;          // peers we're seeding to
    this._next = 0;        // next crackle time
    this._nextGive = 0;    // next "give" exhale time
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

    this.crackleBus = ctx.createGain(); this.crackleBus.gain.value = 1.5;
    this.crackleBus.connect(this.master);
    this.giveBus = ctx.createGain(); this.giveBus.gain.value = 0.9;
    this.giveBus.connect(this.master);
  }

  setMode(m) {
    this.mode = m;
    if (this.ctx) this._nextGive = this.ctx.currentTime;
  }

  // One crackle. "tick" = a crack (moderate-Q band-pass), else a deeper woody pop.
  _pop(t, loud) {
    const ctx = this.ctx;
    const tick = Math.random() < 0.72;
    const dur = tick ? 0.003 + Math.random() * 0.007 : 0.012 + Math.random() * 0.022;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = tick ? 0.9 + Math.random() * 1.4 : 0.6 + Math.random() * 1.0;
    const off = Math.random() * (this.white.duration - dur - 0.01);
    const filt = ctx.createBiquadFilter();
    if (tick) { filt.type = "bandpass"; filt.frequency.value = 1500 + Math.random() * 2600; filt.Q.value = 3 + Math.random() * 3.5; }
    else { filt.type = "bandpass"; filt.frequency.value = 230 + Math.random() * 640; filt.Q.value = 1.4 + Math.random() * 2.2; }
    const g = ctx.createGain();
    const peak = (tick ? 0.17 : 0.26) * loud * (0.6 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.crackleBus);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.05);
  }

  // A soft low "exhale" — a piece going OUT to a leecher (seeding).
  _whoosh(t) {
    const ctx = this.ctx;
    const dur = 0.18 + Math.random() * 0.22;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.5 + Math.random() * 0.4;
    const off = Math.random() * (this.white.duration - dur - 0.01);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 300 + Math.random() * 240; lp.Q.value = 0.4;
    const g = ctx.createGain();
    const peak = 0.05 + Math.random() * 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);      // slow breath
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(this.giveBus);
    src.start(t, off, dur + 0.05);
    src.stop(t + dur + 0.1);
  }

  _emit(t) {
    const loud = 0.5 + 0.5 * this._v;
    let last = t;
    this._pop(last, loud);
    if (Math.random() < 0.16) { last += 0.08 + Math.random() * 0.08; this._pop(last, loud * 0.85); }
    if (Math.random() < 0.04) { last += 0.08 + Math.random() * 0.08; this._pop(last, loud * 0.7); }
    return last;
  }

  _crackleRate() {
    if (this.mode === "aesthetic") {
      const intensity = this._h * (0.45 + 0.55 * this._v);
      return 0.7 + 4.8 * intensity + (this._done ? 0.2 : 0);
    }
    return this._pieceRate;   // pieces/sec — zero when nothing's arriving
  }

  _tick() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime, MIN_GAP = 0.11;
    if (this._next < now) this._next = now;
    let guard = 0;
    while (this._next <= now + 0.05 && guard++ < 64) {
      const rate = this._crackleRate();
      if (rate < 0.08) { this._next = now + 0.35; break; }   // nothing arriving → silence
      const end = this._emit(this._next);
      const meanGap = 1 / Math.min(6, rate);                 // cap top rate for air
      this._next = end + MIN_GAP + (-Math.log(Math.random() + 1e-6)) * meanGap;
    }
    // "give" exhales while seeding (events mode)
    if (this.mode === "events" && this._up > 0.5) {
      if (this._nextGive < now) this._nextGive = now;
      let g2 = 0;
      while (this._nextGive <= now + 0.05 && g2++ < 16) {
        this._whoosh(this._nextGive);
        const giveRate = 0.25 + 0.6 * Math.min(1, this._up / 6);
        this._nextGive += 0.4 + (-Math.log(Math.random() + 1e-6)) / giveRate;
      }
    } else {
      this._nextGive = now;
    }
  }

  update(vigor, heat, done, extra = {}) {
    this._v = vigor; this._h = heat; this._done = done;
    this._pieceRate = extra.pieceRate || 0;
    this._up = extra.upPeers || 0;
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    // aesthetic: warmth tracks flame height; pieces/events: warmth tracks fuel (seeders)
    const bed = this.mode === "aesthetic"
      ? (done ? 0.012 : 0.015) + 0.045 * vigor
      : 0.012 + 0.05 * heat + 0.02 * vigor;
    this.bedGain.gain.setTargetAtTime(bed, t, 0.4);
  }

  toggle() {
    if (!this.ctx) this._init();
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    if (this.enabled) {
      this.ctx.resume?.();
      this._next = t; this._nextGive = t;
      this.master.gain.setTargetAtTime(this.volume, t, 0.2);
      if (!this._timer) this._timer = setInterval(() => this._tick(), 16);
    } else {
      this.master.gain.setTargetAtTime(0, t, 0.2);
      clearInterval(this._timer); this._timer = null;
    }
    return this.enabled;
  }
}
