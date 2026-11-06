// Canvas furnace renderer — the browser port of fireplace/furnace.py.
// Same model: the active flame grows wider AND taller with download SPEED, the
// coal bed widens with % COMPLETE and lingers hot, SEEDERS are the fuel that set
// the heat (color temperature + flicker speed), and rare single-cell licks of
// blue/green/violet get sprinkled through the flame.

import { seedersToHeat } from "./sources.js";

// Color gradients (coolest → hottest), ported from the xterm-256 palettes.
const FIRE = ["#5f0000","#870000","#af0000","#d70000","#ff0000","#ff5f00",
              "#ff8700","#ffaf00","#ffd700","#ffff00","#ffffaf","#ffffff"];
const EMBER = ["#3a0000","#5f0000","#870000","#af0000","#d75f00","#ff8700"];
const FLARE_BLUE = ["#0000af","#0000d7","#0000ff","#005fff","#0087ff","#00afff","#00d7ff"];
const FLARE_GREEN = ["#005f00","#008700","#00af00","#00d700","#5fd700","#87ff00"];
const FLARE_PURPLE = ["#5f005f","#5f0087","#5f00ff","#8700ff","#875fff","#af5fff","#d75fff"];

const STONE = "#4a4441";
const STONE_DARK = "#2a2522";
const STONE_LIGHT = "#6b625c";
const CHAMBER = "#140b06";

// Small deterministic hash → [0,1): stable per (cell, time-bucket), so the
// colored licks wink and drift rather than strobing every frame.
function hash01(n) {
  let a = n | 0;
  a = (a + 0x7ed55d16 + (a << 12)) | 0;
  a = (a ^ 0xc761c23c ^ (a >>> 19)) | 0;
  a = (a + 0x165667b1 + (a << 5)) | 0;
  a = ((a + 0xd3a2646c) ^ (a << 9)) | 0;
  a = (a + 0xfd7046c5 + (a << 3)) | 0;
  a = (a ^ 0xb55a4f09 ^ (a >>> 16)) | 0;
  return (a >>> 0) / 4294967296;
}
const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(r * arr.length)))];

const MAX_SPARKS = 420;   // rising embers off the flame tips
const MAX_SMOKE = 150;    // wisps off the coals when seeding
const SPREAD_EASE = 0.03; // how fast the fire creeps wider (smaller = slower)

// Each canvas needs its OWN fire state (particles + per-torrent width ratchet +
// render settings), so the main view and the sidebar thumbnails don't corrupt
// each other. Pass the returned object to draw().
export function makeFireState() {
  return {
    sparks: [],          // {x,y,vx,vy,life,...} rising embers
    smoke: [],           // {x,y,...} seeding smoke
    spread: new Map(),   // per-torrent width ratchet: key -> {frac, peak}
    lastKey: null,       // which torrent is currently on this canvas
    maxRateMBs: 5,       // download speed that reads as a full blaze
    fill: false,         // hug the box to the edges (fullscreen)
  };
}
const _defaultState = makeFireState();

function humanBytes(n) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? Math.round(n) : n.toFixed(1)) + u[i];
}

// Draw the whole scene onto ctx at logical size (W, H). `frame` advances time.
// `state` (from makeFireState) holds this canvas's particles + settings.
export function draw(ctx, p, frame, W, H, state = _defaultState) {
  const done = !!p.done;
  const MAX_RATE = (state.maxRateMBs || 5) * 1024 * 1024;
  const heat = seedersToHeat(p.peers);
  const vigor = done ? 0 : Math.max(0.16, Math.min(1, p.rate_bps / MAX_RATE));
  const coalFrac = Math.max(0, p.fraction);
  const coalHeat = done ? Math.max(heat, 0.45) : heat;

  // Per-torrent width ratchet: each torrent remembers how wide it has spread, so
  // switching away and back resumes instead of rebuilding from scratch. Only a
  // true restart of that torrent (fraction jumps backwards) resets its width.
  const spreadKey = p.id != null ? "id:" + p.id : "name:" + (p.name || "");
  let spread = state.spread.get(spreadKey);
  if (!spread) {
    spread = { frac: p.fraction, peak: 0 };
    state.spread.set(spreadKey, spread);
  }
  if (p.fraction < spread.frac - 0.05) spread.peak = 0;   // this torrent restarted
  spread.frac = p.fraction;
  if (!done) {
    // ease toward the current vigor, but never recede (max keeps it a ratchet)
    spread.peak = Math.max(spread.peak, spread.peak + (vigor - spread.peak) * SPREAD_EASE);
  }
  const widthFrac = spread.peak;             // flame width = widest it's ever been

  // The transient particle layers belong to the on-screen fire; clear them only
  // when the viewed torrent actually changes (not every frame).
  if (spreadKey !== state.lastKey) {
    state.sparks.length = 0;
    state.smoke.length = 0;
    state.lastKey = spreadKey;
  }

  ctx.clearRect(0, 0, W, H);

  // Cozy backdrop + a warm glow behind the fire that breathes with vigor.
  ctx.fillStyle = "#0a0604";
  ctx.fillRect(0, 0, W, H);

  // Furnace geometry. In fill (fullscreen) mode the box hugs the edges so the
  // fire nearly fills its containing square; otherwise it sits inset on the page.
  const mx = state.fill ? 0.03 : 0.14;
  const my = state.fill ? 0.03 : 0.1;
  const fx = W * mx, fy = H * my, fw = W * (1 - 2 * mx), fh = H * (1 - 2 * my);
  const cx = W / 2;

  const glowY = fy + fh * 0.78;
  const g = ctx.createRadialGradient(cx, glowY, 10, cx, glowY, fw * 0.75);
  const glowC = pick(FIRE, 0.3 + 0.6 * heat);
  g.addColorStop(0, hexA(glowC, 0.33 * (0.3 + 0.7 * vigor)));
  g.addColorStop(1, hexA(glowC, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stone furnace body.
  roundRect(ctx, fx - 10, fy - 10, fw + 20, fh + 20, 10);
  ctx.fillStyle = STONE_DARK; ctx.fill();
  roundRect(ctx, fx - 10, fy - 10, fw + 20, fh + 20, 10);
  ctx.lineWidth = 3; ctx.strokeStyle = STONE_LIGHT; ctx.stroke();
  // Inner chamber.
  roundRect(ctx, fx, fy, fw, fh, 6);
  ctx.fillStyle = CHAMBER; ctx.fill();
  ctx.save();
  roundRect(ctx, fx, fy, fw, fh, 6); ctx.clip();

  // ---- Fire grid -----------------------------------------------------------
  // (Progress is read from the fire + the bar below; the old smelting arrow was
  // redundant, so the flames now claim that top space.)
  const areaX = fx + fw * 0.08;
  const areaW = fw * 0.84;
  const baseY = fy + fh * 0.84;           // top of the coal bed
  const areaTop = fy + fh * 0.1;          // flames start near the top of the box
  const cell = Math.max(5, areaW / 72);
  const FW = Math.floor(areaW / cell);
  const FH = Math.max(6, Math.floor((baseY - areaTop) / cell));
  const t = frame * (0.07 + 0.2 * heat);
  const bucket = Math.floor(frame / 3);
  const heatColor = 0.3 + 0.7 * heat;

  const activeW = Math.max(2, widthFrac * FW);   // width = ratcheted peak
  const centerCol = (FW - 1) / 2;
  const half = activeW / 2;

  // Per-column flame height in (fractional) rows: central hump, smooth coherent
  // flicker (one wave across the body — no equalizer bars).
  const colRows = new Float64Array(FW);
  for (let x = 0; x < FW; x++) {
    const d = Math.abs(x - centerCol);
    if (d > half) continue;
    const taper = 1 - Math.pow(d / half, 1.6);
    const wave =
      (Math.sin(t + x * 0.55) +
       0.5 * Math.sin(t * 1.7 + x * 0.9) +
       0.3 * Math.sin(t * 0.4 + x * 0.23)) / 1.8;
    const flick = 0.85 + 0.15 * wave;
    colRows[x] = Math.max(0, vigor * FH * taper * flick);
  }

  for (let x = 0; x < FW; x++) {
    const ph = colRows[x];
    if (ph <= 0) continue;
    const px = areaX + x * cell;
    for (let rfb = 0; rfb < FH; rfb++) {
      const fill = ph - rfb;
      if (fill <= 0) break;
      const depth = (ph - rfb) / Math.max(1e-6, ph); // ~1 base → 0 tip
      const inten = 0.35 + 0.65 * depth;

      // Rare single-cell mineral lick: greens at the base, blue/violet at tips.
      let color = null;
      const roll = hash01((x * 73856093) ^ (rfb * 19349663) ^ (bucket * 83492791));
      if (rfb === 0) {
        if (roll < 0.1) color = pick(FLARE_GREEN, 0.5 + roll);
        else if (roll < 0.13) color = FLARE_BLUE[FLARE_BLUE.length - 2];
      } else if (fill < 1) {
        if (roll < 0.08) color = pick(FLARE_BLUE, 0.6 + roll);
        else if (roll < 0.11) color = pick(FLARE_PURPLE, 0.6 + roll);
      }
      if (!color) color = pick(FIRE, inten * heatColor);

      const ch = fill >= 1 ? cell : Math.max(1, fill * cell);
      const py = baseY - (rfb + 1) * cell + (cell - ch);
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cell) - 1, Math.ceil(ch) - 1);
    }
  }

  // ---- Rising sparks -------------------------------------------------------
  // Spawn off the flame tips — denser the hotter/faster it burns; none once done.
  const litCols = [];
  for (let x = 0; x < FW; x++) if (colRows[x] > 0.6) litCols.push(x);
  if (!done && litCols.length) {
    const rate = vigor * (0.4 + 0.6 * heat) * 2.4;    // avg new sparks per frame
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (; n > 0 && state.sparks.length < MAX_SPARKS; n--) {
      const cx = litCols[(Math.random() * litCols.length) | 0];
      state.sparks.push({
        x: areaX + cx * cell + cell / 2,
        y: baseY - colRows[cx] * cell - cell * 0.5,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.5 + Math.random() * 1.3),            // rise
        life: 1,
        decay: 0.010 + Math.random() * 0.02,
        size: Math.random() < 0.22 ? 2 : 1,
        hue: Math.random(),                           // rare blue/green ember
      });
    }
  }
  // Update + draw (newest spawns are hottest; they cool to deep red as they fade).
  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const s = state.sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy *= 0.985;                                     // slow as it rises
    s.vx += (Math.random() - 0.5) * 0.06;             // wander
    s.life -= s.decay;
    if (s.life <= 0 || s.y < fy + 2) { state.sparks.splice(i, 1); continue; }
    let c;
    if (s.hue < 0.04) c = pick(FLARE_BLUE, 0.4 + s.life * 0.5);
    else if (s.hue < 0.06) c = pick(FLARE_GREEN, 0.4 + s.life * 0.5);
    else c = pick(FIRE, 0.45 + 0.55 * s.life);        // bright → ember as it ages
    ctx.globalAlpha = Math.min(1, s.life * 1.3);
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
  }
  ctx.globalAlpha = 1;

  // ---- Coal bed: two stacked rows, each coloured independently -------------
  // widens with % complete, lingers hot. The two rows use different seeds +
  // brightness bias so the bed reads as layered coals, not one flat spread.
  const coalActive = coalFrac * FW;
  const coalLeft = (FW - coalActive) / 2;
  const lit = 0.35 + 0.55 * coalHeat;
  const baseIdx = coalHeat * (EMBER.length - 1);
  const COAL_ROWS = 2;
  for (let row = 0; row < COAL_ROWS; row++) {
    const yRow = baseY + row * cell;
    const top = row === 0;
    const rowBias = top ? 0.5 : -1.6;   // front (bottom) row sits distinctly darker
    for (let x = 0; x < FW; x++) {
      const px = areaX + x * cell;
      let color;
      if (x >= coalLeft && x < coalLeft + coalActive) {
        // independent hashes per (x, row): lit pattern and shade differ by row
        const hLit = hash01((x * 2654435761) ^ (row * 668265263) ^ (bucket * 40503));
        const hShade = hash01((x * 40503) ^ (row * 19349663) ^ (bucket * 2246822519));
        // top row varies -1..+1; front row skews downward (-1..0) so it stays dark
        const jitter = top ? Math.floor(hShade * 3) - 1 : Math.floor(hShade * 2) - 1;
        const ci = Math.max(0, Math.min(EMBER.length - 1,
          Math.round(baseIdx + rowBias + jitter)));
        color = hLit < lit ? EMBER[ci] : EMBER[0];
      } else {
        color = STONE_DARK;
      }
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(px), Math.floor(yRow), Math.ceil(cell) - 1, Math.ceil(cell * 0.9));
    }
  }

  // ---- Smoke -----------------------------------------------------------------
  // Lifts off the coals whenever peers are downloading FROM us (seeding — during
  // the download or after it completes); denser the more leechers.
  const upPeers = p.up_peers || 0;
  if (upPeers > 0) {   // smoke whenever we're feeding peers (seeding, during or after)
    const rate = Math.min(1, upPeers / 6) * 0.9;      // wisps per frame
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    const left = coalLeft + coalActive * 0.15;
    const wspan = Math.max(1, coalActive * 0.7);
    for (; n > 0 && state.smoke.length < MAX_SMOKE; n--) {
      state.smoke.push({
        x: areaX + (left + Math.random() * wspan) * cell,
        y: baseY,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.15 + Math.random() * 0.4),            // slow rise
        life: 1,
        decay: 0.004 + Math.random() * 0.006,
        size: cell * (0.6 + Math.random() * 0.6),
        grow: cell * (0.01 + Math.random() * 0.02),
      });
    }
  }
  for (let i = state.smoke.length - 1; i >= 0; i--) {
    const s = state.smoke[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy *= 0.994;
    s.vx += (Math.random() - 0.5) * 0.03;
    s.size += s.grow;
    s.life -= s.decay;
    if (s.life <= 0 || s.y < fy + 2) { state.smoke.splice(i, 1); continue; }
    const g = Math.round(70 + 80 * s.life);           // warmer/brighter near coals
    ctx.globalAlpha = Math.min(0.26, s.life * 0.3);
    ctx.fillStyle = `rgb(${g},${g - 6},${g - 14})`;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.ceil(s.size), Math.ceil(s.size));
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  return {
    percent: (p.fraction * 100).toFixed(1),
    rate: humanBytes(p.rate_bps),
    downloaded: humanBytes(p.downloaded),
    total: humanBytes(p.total),
    peers: p.peers,
    state: p.state,
    name: p.name,
    done,
    vigor,           // 0..1 flame height — drives audio roar/crackle
    heat,            // 0..1 seeders — drives audio sizzle/crackle
    up: p.up_peers || 0,
  };
}

// ---- drawing helpers -------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
