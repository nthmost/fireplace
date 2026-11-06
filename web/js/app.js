// Wires config → source → canvas furnace. Pick a scenario from the left sidebar
// (each is a live mini-fire thumbnail), or mirror a real torrent ("Live"), or
// hand-tune via the ⚙ panel. State is shareable through URL query params.
//
//   ?scenario=big   ?scenario=custom&duration=60&maxRate=8&seeders=45

import { SimulatedSource, LiveSource, liveBackendAvailable } from "./sources.js";
import { draw, makeFireState } from "./furnace.js";
import { FireAudio } from "./audio.js";

const fireAudio = new FireAudio();

const DEFAULTS = {
  name: "ubuntu-25.10-desktop-amd64.iso",
  size: 1.4, duration: 45, maxRate: 5, seeders: "", fps: 24, loop: true,
  scenario: "healthy",
};

// Preset demos. Each sets the visible fields and (except 'custom') the sim's
// character bands: rateBand [MB/s], seedBand [count], seedBias (→ low end),
// upBand [peers we seed to]. See SimulatedSource.
const SCENARIOS = {
  epic: { label: "Slow burn", sub: "60 min · builds, fades, seeds",
    name: "the-complete-archive-4k-remaster.mkv", size: 6, duration: 3600, maxRate: 4,
    arc: true, rateBand: [0.03, 3.5], seedBand: [1, 22], seedBias: 0.5 },
  healthy: { label: "Healthy", sub: "steady swarm",
    name: "ubuntu-25.10-desktop-amd64.iso", size: 1.4, duration: 45, maxRate: 5 },
  rare: { label: "Rare", sub: "1–3 seeders · crawls",
    name: "lost-pilot-1983-telecine.avi", size: 1.1, duration: 180, maxRate: 1.2,
    rateBand: [0.02, 0.35], seedBand: [1, 3], seedBias: 0.82, upBand: [0, 0] },
  big: { label: "12 GB, seeding", sub: "8–20 seeders · uploads too",
    name: "planet-earth-II-2016-2160p.mkv", size: 12, duration: 150, maxRate: 3,
    rateBand: [0.5, 2.4], seedBand: [8, 20], seedBias: 0.4, upBand: [2, 10] },
  flash: { label: "Flash crowd", sub: "huge swarm · white-hot",
    name: "big-buck-bunny-4k-remaster.mkv", size: 4.2, duration: 60, maxRate: 10,
    rateBand: [2, 9], seedBand: [50, 180], seedBias: 0.3, upBand: [15, 45] },
  custom: { label: "Custom", sub: "⚙ panel" },
};
const PRESET_ORDER = ["epic", "healthy", "rare", "big", "flash"];

const validScenario = (k) => k === "live" || !!SCENARIOS[k];

function readConfig() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : d);
  const scenario = validScenario(q.get("scenario")) ? q.get("scenario") : DEFAULTS.scenario;
  const c = {
    name: q.get("name") || DEFAULTS.name,
    size: num("size", DEFAULTS.size),
    duration: num("duration", DEFAULTS.duration),
    maxRate: num("maxRate", DEFAULTS.maxRate),
    seeders: q.has("seeders") ? q.get("seeders") : DEFAULTS.seeders,
    fps: num("fps", DEFAULTS.fps),
    loop: q.has("loop") ? q.get("loop") !== "0" && q.get("loop") !== "false" : DEFAULTS.loop,
    scenario,
  };
  const s = SCENARIOS[scenario];
  if (s && scenario !== "custom") {   // a preset drives the fields unless overridden
    if (!q.has("name")) c.name = s.name;
    if (!q.has("size")) c.size = s.size;
    if (!q.has("duration")) c.duration = s.duration;
    if (!q.has("maxRate")) c.maxRate = s.maxRate;
  }
  return c;
}

function writeConfigToURL(cfg) {
  const q = new URLSearchParams();
  q.set("scenario", cfg.scenario);
  if (cfg.scenario === "custom") {
    q.set("name", cfg.name);
    q.set("size", cfg.size);
    q.set("duration", cfg.duration);
    q.set("maxRate", cfg.maxRate);
    if (cfg.seeders !== "" && cfg.seeders != null) q.set("seeders", cfg.seeders);
  }
  q.set("fps", cfg.fps);
  q.set("loop", cfg.loop ? "1" : "0");
  history.replaceState(null, "", "?" + q.toString());
}

const canvas = document.getElementById("furnace");
const ctx = canvas.getContext("2d");
const el = (id) => document.getElementById(id);

let cfg = readConfig();
let source, frame, finishedAt, paused = false;
let liveAvailable = false;   // backend present?
let liveSource = null;
let navTorrents = [];
let navIndex = 0;
const fireState = makeFireState();   // the main canvas's own particle/ratchet state
let thumbs = [];                     // sidebar mini-fires

const isLive = () => cfg.scenario === "live";

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: rect.width, H: rect.height };
}
let dims = { W: 640, H: 420 };
window.addEventListener("resize", () => { dims = sizeCanvas(); });

function buildSource() {
  if (cfg.scenario === "live" && liveSource) return liveSource;
  const sc = SCENARIOS[cfg.scenario] || {};
  fireState.maxRateMBs = cfg.maxRate;
  return new SimulatedSource({
    duration: cfg.duration, sizeGB: cfg.size, name: cfg.name,
    seeders: cfg.seeders !== "" && cfg.seeders != null ? Number(cfg.seeders) : null,
    rateBand: sc.rateBand, seedBand: sc.seedBand, seedBias: sc.seedBias, upBand: sc.upBand,
    arc: sc.arc,
  });
}

function start() {
  source = buildSource();
  frame = 0;
  finishedAt = null;
  document.body.classList.toggle("live", isLive());   // hides sim-only config panel
  dims = sizeCanvas();
  syncControls();
  updateSidebarActive();
}

// Switch to a scenario (or 'live'). Presets fill the visible fields.
function activate(key) {
  cfg.scenario = key;
  const s = SCENARIOS[key];
  if (s && key !== "custom") {
    cfg.name = s.name; cfg.size = s.size; cfg.duration = s.duration;
    cfg.maxRate = s.maxRate; cfg.seeders = "";
  }
  writeConfigToURL(cfg);
  start();
}

// ---- render loop (throttled to cfg.fps) -----------------------------------
let lastDraw = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (paused) return;
  const interval = 1000 / cfg.fps;
  if (now - lastDraw < interval) return;
  lastDraw = now;

  const p = source.poll();
  const r = draw(ctx, p, frame, dims.W, dims.H, fireState);
  updateReadout(r);
  fireAudio.update(r.vigor, r.heat, r.done);
  if (isLive()) updateNav(p);
  frame++;

  // sidebar mini-fires
  for (const t of thumbs) {
    t.frame++;
    draw(t.ctx, t.src.poll(), t.frame, t.W, t.H, t.state);
  }

  // The simulated demo loops back; a real torrent keeps being monitored.
  if (p.done && !isLive()) {
    if (finishedAt == null) finishedAt = now;
    else if (cfg.loop && now - finishedAt > 3500) start();
  }
}

function updateReadout(r) {
  el("percent").textContent = r.percent + "%";
  el("bar-fill").style.width = r.percent + "%";
  el("name").textContent = r.name;
  el("size").textContent = `${r.downloaded} / ${r.total}`;
  const seeders = `${r.peers} seeder${r.peers === 1 ? "" : "s"}`;
  if (r.done) {
    el("status").textContent = "✓ complete — seeding";
    el("status").className = "status done";
  } else if (r.state === "paused") {
    el("status").textContent = `⏸ paused · ${seeders}`;
    el("status").className = "status stalled";
  } else if (r.state === "stalled") {
    el("status").textContent = "… connecting to peers";
    el("status").className = "status stalled";
  } else {
    el("status").textContent = `${r.rate}/s · ${seeders}`;
    el("status").className = "status active";
  }
}

// ---- torrent nav (live mode) ----------------------------------------------
function updateNav(p) {
  navTorrents = p.torrents || [];
  navIndex = p.index || 0;
  const show = navTorrents.length > 1;
  el("nav-prev").style.display = show ? "flex" : "none";
  el("nav-next").style.display = show ? "flex" : "none";
  const ind = el("nav-indicator");
  if (show) {
    ind.style.display = "block";
    ind.textContent = `${navIndex + 1} / ${navTorrents.length}`;
  } else {
    ind.style.display = "none";
  }
}

function cycle(delta) {
  if (!isLive() || navTorrents.length < 2) return;
  const n = navTorrents.length;
  navIndex = (((navIndex + delta) % n) + n) % n;
  liveSource.setId(navTorrents[navIndex].id);
}

el("nav-prev").addEventListener("click", () => cycle(-1));
el("nav-next").addEventListener("click", () => cycle(1));
window.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft") cycle(-1);
  else if (e.key === "ArrowRight") cycle(1);
  else if (e.key === "f" || e.key === "F") toggleFullscreen();
  else if (e.key === "m" || e.key === "M") toggleAudio();
});

// ---- fire sound (procedural, muted by default) ----------------------------
function toggleAudio() {
  const on = fireAudio.toggle();
  const btn = el("audio");
  btn.textContent = on ? "🔊" : "🔇";
  btn.classList.toggle("on", on);
}
el("audio").addEventListener("click", toggleAudio);

// ---- scenario sidebar (live mini-fire thumbnails) -------------------------
const THUMB_W = 150, THUMB_H = 96;

function buildSidebar() {
  const bar = el("sidebar");
  bar.innerHTML = "";
  thumbs = [];
  const keys = [];
  if (liveAvailable) keys.push("live");
  keys.push(...PRESET_ORDER);

  for (const key of keys) {
    const meta = key === "live"
      ? { label: "Live", sub: "real torrent" }
      : SCENARIOS[key];

    const item = document.createElement("button");
    item.className = "scene";
    item.dataset.key = key;
    item.title = `${meta.label} — ${meta.sub}`;

    const cv = document.createElement("canvas");
    cv.className = "thumb";
    const dpr = window.devicePixelRatio || 1;
    cv.width = THUMB_W * dpr; cv.height = THUMB_H * dpr;
    cv.style.width = THUMB_W + "px"; cv.style.height = THUMB_H + "px";
    const tctx = cv.getContext("2d");
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const lab = document.createElement("div");
    lab.className = "scene-label";
    lab.innerHTML = `<strong>${meta.label}</strong><span>${meta.sub}</span>`;

    item.append(cv, lab);
    item.addEventListener("click", () => activate(key));
    bar.appendChild(item);

    // mini-fire source + its own state
    const state = makeFireState();
    let src;
    if (key === "live") {
      src = liveSource;
      state.maxRateMBs = 5;
    } else {
      const sc = SCENARIOS[key];
      state.maxRateMBs = sc.maxRate;
      src = new SimulatedSource({
        duration: 300, sizeGB: sc.size, name: sc.name,
        rateBand: sc.rateBand, seedBand: sc.seedBand, seedBias: sc.seedBias, upBand: sc.upBand,
        arc: sc.arc,
      });
      src._start = performance.now() / 1000 - (sc.arc ? 150 : 120);   // mid-download (peak for arc)
      for (let i = 0; i < 160; i++) draw(tctx, src.poll(), i, THUMB_W, THUMB_H, state); // warm up
    }
    thumbs.push({ key, ctx: tctx, src, state, frame: 160, W: THUMB_W, H: THUMB_H });
  }
  updateSidebarActive();
}

function updateSidebarActive() {
  for (const item of document.querySelectorAll(".scene")) {
    item.classList.toggle("active", item.dataset.key === cfg.scenario);
  }
}

// ---- control panel (custom tuning) ----------------------------------------
function syncControls() {
  el("c-name").value = cfg.name;
  el("c-size").value = cfg.size;
  el("c-duration").value = cfg.duration;
  el("c-maxRate").value = cfg.maxRate;
  el("c-seeders").value = cfg.seeders;
  el("c-fps").value = cfg.fps;
  el("c-loop").checked = cfg.loop;
}

el("apply").addEventListener("click", () => {
  cfg = {
    scenario: "custom",
    name: el("c-name").value || DEFAULTS.name,
    size: Number(el("c-size").value) || DEFAULTS.size,
    duration: Number(el("c-duration").value) || DEFAULTS.duration,
    maxRate: Number(el("c-maxRate").value) || DEFAULTS.maxRate,
    seeders: el("c-seeders").value.trim(),
    fps: Number(el("c-fps").value) || DEFAULTS.fps,
    loop: el("c-loop").checked,
  };
  writeConfigToURL(cfg);
  start();
});
el("restart").addEventListener("click", start);
el("pause").addEventListener("click", (e) => {
  paused = !paused;
  e.target.textContent = paused ? "Resume" : "Pause";
});
el("toggle-panel").addEventListener("click", () => {
  el("panel").classList.toggle("collapsed");
});

// ---- fullscreen: just the fire, filling the screen ------------------------
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen?.() ?? Promise.reject()).catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}
document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle("fs", on);
  fireState.fill = on;                            // box hugs the edges in fullscreen
  requestAnimationFrame(() => { dims = sizeCanvas(); });
});
el("fullscreen").addEventListener("click", toggleFullscreen);

// ---- boot -----------------------------------------------------------------
(async () => {
  liveAvailable = await liveBackendAvailable();
  if (liveAvailable) {
    liveSource = new LiveSource();
    // default to the real torrent unless the URL pinned a scenario
    if (!new URLSearchParams(location.search).has("scenario")) cfg.scenario = "live";
  } else if (cfg.scenario === "live") {
    cfg.scenario = "healthy";   // no backend → can't go live
  }
  buildSidebar();
  start();
  requestAnimationFrame(loop);
})();
