// Wires config → source → canvas furnace. Config vars can be set two ways when
// you run the demo: via URL query params (shareable) or the live control panel.
//
//   https://fireplace.nthmost.com/?name=debian-13.iso&size=3.7&duration=60&maxRate=8&seeders=45&loop=1

import { SimulatedSource, LiveSource, liveBackendAvailable } from "./sources.js";
import { draw } from "./furnace.js";

const DEFAULTS = {
  name: "ubuntu-25.10-desktop-amd64.iso",
  size: 1.4, // GB
  duration: 45, // seconds
  maxRate: 5, // MB/s that reads as a full blaze
  seeders: "", // "" = auto-ramp the swarm; a number pins it
  fps: 24,
  loop: true,
};

function readConfig() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : d);
  return {
    name: q.get("name") || DEFAULTS.name,
    size: num("size", DEFAULTS.size),
    duration: num("duration", DEFAULTS.duration),
    maxRate: num("maxRate", DEFAULTS.maxRate),
    seeders: q.has("seeders") ? q.get("seeders") : DEFAULTS.seeders,
    fps: num("fps", DEFAULTS.fps),
    loop: q.has("loop") ? q.get("loop") !== "0" && q.get("loop") !== "false" : DEFAULTS.loop,
  };
}

function writeConfigToURL(cfg) {
  const q = new URLSearchParams();
  q.set("name", cfg.name);
  q.set("size", cfg.size);
  q.set("duration", cfg.duration);
  q.set("maxRate", cfg.maxRate);
  if (cfg.seeders !== "" && cfg.seeders != null) q.set("seeders", cfg.seeders);
  q.set("fps", cfg.fps);
  q.set("loop", cfg.loop ? "1" : "0");
  history.replaceState(null, "", "?" + q.toString());
}

const canvas = document.getElementById("furnace");
const ctx = canvas.getContext("2d");
const el = (id) => document.getElementById(id);

let cfg = readConfig();
let source, frame, finishedAt, paused = false;
let live = false;           // mirroring a real Transmission torrent?
let liveSource = null;      // created once when a backend is detected

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

function start() {
  draw.maxRateMBs = cfg.maxRate;
  if (live) {
    source = liveSource;            // one persistent live source; just reset the view
  } else {
    source = new SimulatedSource({
      duration: cfg.duration,
      sizeGB: cfg.size,
      name: cfg.name,
      seeders: cfg.seeders === "" || cfg.seeders == null ? null : Number(cfg.seeders),
    });
  }
  frame = 0;
  finishedAt = null;
  dims = sizeCanvas();
  syncControls();
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
  const r = draw(ctx, p, frame, dims.W, dims.H);
  updateReadout(r);
  frame++;

  // A real torrent keeps being monitored after it completes (seeding); only the
  // simulated demo loops back to the start.
  if (p.done && !live) {
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

// ---- control panel ---------------------------------------------------------
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

// Boot: if a live backend is answering /api/progress, mirror the real torrent;
// otherwise fall back to the simulated demo. Same page, both modes.
(async () => {
  live = await liveBackendAvailable();
  if (live) {
    liveSource = new LiveSource();
    document.body.classList.add("live");
  }
  start();
  requestAnimationFrame(loop);
})();
