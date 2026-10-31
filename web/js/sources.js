// Progress sources for the web furnace — the browser twin of fireplace/sources.py.
// A source just needs poll() -> {fraction, rate_bps, downloaded, total, name,
// peers, state, done}. SimulatedSource fakes it; LiveSource mirrors a real
// Transmission torrent through the local backend (server/server.py).

export function seedersToHeat(peers) {
  // Seeders are the fuel: one lone seeder barely smoulders, a swarm roars.
  return 1 - Math.exp(-Math.max(0, peers) / 12);
}

// Live source: polls a backend's /api/progress, which mirrors a real Transmission
// torrent. Same shape as SimulatedSource. The fetch is async but the furnace
// renders every frame, so we keep the latest snapshot and return it synchronously
// from poll(); a background timer refreshes it about once a second.
export class LiveSource {
  constructor(base = "/api/progress", refreshMs = 1000) {
    this.base = base;
    this.url = base;
    this._latest = {
      fraction: 0, rate_bps: 0, downloaded: 0, total: 0,
      name: "…", peers: 0, state: "stalled", done: false,
      id: null, index: 0, count: 0, torrents: [],
    };
    this._tick();
    this._timer = setInterval(() => this._tick(), refreshMs);
  }

  // Switch which torrent to mirror; refresh immediately so the UI reacts at once.
  setId(id) {
    this.url = id == null ? this.base : `${this.base}?id=${encodeURIComponent(id)}`;
    this._tick();
  }

  async _tick() {
    try {
      const r = await fetch(this.url, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        if (!d.error) this._latest = d;
      }
    } catch (_) {
      /* transient hiccup — keep the last snapshot */
    }
  }

  poll() {
    return this._latest;
  }
}

// Is a live backend present? (The static public site 404s this → simulated.)
export async function liveBackendAvailable(url = "/api/progress") {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok;
  } catch (_) {
    return false;
  }
}

export class SimulatedSource {
  constructor(opts = {}) {
    this.duration = Math.max(1, opts.duration ?? 45);
    this.totalBytes = Math.round((opts.sizeGB ?? 1.4) * 1e9);
    this.name = opts.name ?? "ubuntu-25.10-desktop-amd64.iso";
    // null => auto-ramp the swarm; a number pins it (so you can dial the heat).
    this.fixedSeeders = opts.seeders ?? null;
    // Scenario bands (optional). When given they shape the download's character:
    //   rateBand [minMBs,maxMBs]  — download speed band (flame height)
    //   seedBand [min,max]        — seeder count band (fuel / heat)
    //   seedBias 0..1             — higher = cluster toward the low end ("usually 1")
    //   upBand   [min,max]        — peers downloading FROM us (seeding → smoke),
    //                               active even while still downloading
    this.rateBand = opts.rateBand ?? null;
    this.seedBand = opts.seedBand ?? null;
    this.seedBias = opts.seedBias ?? 0.3;
    this.upBand = opts.upBand ?? null;
    this.reset();
  }

  reset() {
    this._start = performance.now() / 1000;
    this._lastT = this._start;
    this._lastFrac = 0;
    this._peers = this.fixedSeeders ?? (this.seedBand ? this.seedBand[0] : 2);
    this._rateEma = 0;
    this._up = 0;           // peers we're seeding to (drives the smoke)
  }

  _curve(t) {
    // Slow to catch peers, fast through the middle, taper on the final pieces.
    const x = Math.min(1, t / this.duration);
    return x * x * (3 - 2 * x);
  }

  poll() {
    const now = performance.now() / 1000;
    const frac = this._curve(now - this._start);
    const done = frac >= 0.999;
    const momentum = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, frac)); // slow at ends

    // --- download rate → flame height ---
    if (this.rateBand) {
      // band-driven: a realistic speed that ebbs with the download's momentum
      const [lo, hi] = this.rateBand;
      const target = (lo + (hi - lo) * momentum) * (1 + (Math.random() * 0.5 - 0.25)) * 1e6;
      this._rateEma = 0.92 * this._rateEma + 0.08 * target;
    } else {
      // derive from fraction moved (original behaviour)
      const dt = Math.max(1e-3, now - this._lastT);
      const dfrac = Math.max(0, frac - this._lastFrac);
      const baseRate = (dfrac * this.totalBytes) / dt;
      const jitter = 1 + (Math.random() * 0.6 - 0.25);
      this._rateEma = 0.75 * this._rateEma + 0.25 * baseRate * jitter;
    }
    const rate = this._rateEma;
    this._lastT = now;
    this._lastFrac = frac;

    // --- seeders (fuel / heat) ---
    if (this.fixedSeeders != null) {
      this._peers = this.fixedSeeders;
    } else if (this.seedBand) {
      const [lo, hi] = this.seedBand;
      const mean = lo + (hi - lo) * (1 - this.seedBias) * 0.5;   // biased toward lo
      this._peers += 0.08 * (mean - this._peers) + (Math.random() - 0.5) * 1.5;
      this._peers = Math.max(lo, Math.min(hi, this._peers));
    } else {
      const target = 3 + 34 * Math.sin(Math.PI * Math.min(1, frac));
      this._peers += 0.12 * (target - this._peers) + (Math.random() * 2 - 1);
      this._peers = Math.max(1, Math.min(60, this._peers));
    }
    const peers = done ? 0 : Math.max(1, Math.round(this._peers));
    const state = done ? "done" : rate < 1 ? "stalled" : "active";

    // --- upload / seeding → smoke ---
    // With an upBand, we seed to leechers throughout (and after) the download.
    // Otherwise we only seed once complete (original behaviour).
    let upTarget;
    if (this.upBand) upTarget = (this.upBand[0] + this.upBand[1]) / 2;
    else upTarget = done ? 5 : 0;
    this._up += 0.1 * (upTarget - this._up) + (Math.random() * 1.6 - 0.8);
    const upHi = this.upBand ? this.upBand[1] : 12;
    this._up = Math.max(0, Math.min(upHi, this._up));
    const upPeers = this._up > 0.5 ? Math.round(this._up) : 0;

    return {
      fraction: Math.min(1, frac),
      rate_bps: done ? 0 : rate,
      downloaded: Math.round(frac * this.totalBytes),
      total: this.totalBytes,
      name: this.name,
      peers,
      state,
      done,
      up_peers: upPeers,
      up_rate_bps: upPeers * 55000,
    };
  }
}
