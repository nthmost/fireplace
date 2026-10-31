// Progress sources for the web furnace — the browser twin of fireplace/sources.py.
// A source just needs poll() -> {fraction, rate_bps, downloaded, total, name,
// peers, state, done}. Today it's simulated; a future WebSocket/HTTP source that
// mirrors a real torrent client implements the same shape and nothing else changes.

export function seedersToHeat(peers) {
  // Seeders are the fuel: one lone seeder barely smoulders, a swarm roars.
  return 1 - Math.exp(-Math.max(0, peers) / 12);
}

export class SimulatedSource {
  constructor(opts = {}) {
    this.duration = Math.max(1, opts.duration ?? 45);
    this.totalBytes = Math.round((opts.sizeGB ?? 1.4) * 1e9);
    this.name = opts.name ?? "ubuntu-25.10-desktop-amd64.iso";
    // null => auto-ramp the swarm; a number pins it (so you can dial the heat).
    this.fixedSeeders = opts.seeders ?? null;
    this.reset();
  }

  reset() {
    this._start = performance.now() / 1000;
    this._lastT = this._start;
    this._lastFrac = 0;
    this._peers = this.fixedSeeders ?? 2;
    this._rateEma = 0;
  }

  _curve(t) {
    // Slow to catch peers, fast through the middle, taper on the final pieces.
    const x = Math.min(1, t / this.duration);
    return x * x * (3 - 2 * x);
  }

  poll() {
    const now = performance.now() / 1000;
    const frac = this._curve(now - this._start);

    // Instantaneous rate from fraction moved, jittered, then EMA-smoothed so the
    // flame height drifts instead of flashing every frame.
    const dt = Math.max(1e-3, now - this._lastT);
    const dfrac = Math.max(0, frac - this._lastFrac);
    const baseRate = (dfrac * this.totalBytes) / dt;
    const jitter = 1 + (Math.random() * 0.6 - 0.25);
    this._rateEma = 0.75 * this._rateEma + 0.25 * baseRate * jitter;
    const rate = this._rateEma;
    this._lastT = now;
    this._lastFrac = frac;

    // Seeders drift smoothly toward their target (never a per-frame jump).
    const target =
      this.fixedSeeders != null
        ? this.fixedSeeders
        : 3 + 34 * Math.sin(Math.PI * Math.min(1, frac));
    this._peers += 0.12 * (target - this._peers) + (Math.random() * 2 - 1);
    this._peers = Math.max(1, Math.min(60, this._peers));

    const done = frac >= 0.999;
    const peers = done ? 0 : Math.max(1, Math.round(this._peers));
    const state = done ? "done" : rate < 1 ? "stalled" : "active";

    return {
      fraction: Math.min(1, frac),
      rate_bps: done ? 0 : rate,
      downloaded: Math.round(frac * this.totalBytes),
      total: this.totalBytes,
      name: this.name,
      peers,
      state,
      done,
    };
  }
}
