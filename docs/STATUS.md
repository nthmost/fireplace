# Status & handoff

_Snapshot of where the project stands, and the plan for a learning-oriented
GitHub page. Last updated 2026-10-31._

## What exists today

Three surfaces, one shared fire model (progress comes through a single
`poll() -> Progress`, so the renderer never knows the source):

| Surface | Where | Source(s) |
|---------|-------|-----------|
| **TUI** | `fireplace/` (Python pkg, zero deps) | `SimulatedSource`, `TransmissionSource` |
| **Web (static demo)** | `web/` → **https://fireplace.nthmost.com** | `SimulatedSource` (+ scenario bands) |
| **Live web monitor** | `server/` → **http://loki.local:8673/** | backend proxies Transmission → `LiveSource` |

- **Repo:** https://github.com/nthmost/fireplace (public, MIT)
- **Public site:** static files in `/var/www/fireplace.nthmost.com` on zephyr (Apache), deployed via `web/deploy.sh`. Now sends `Cache-Control: no-cache`.
- **Live monitor:** systemd service `fireplace-monitor` on **loki**, installed via `server/deploy-loki.sh` (git clone + `.env` from the daemon's `postprocess.conf`). Also `no-cache`.
- Deploy infra details are in memory `reference-nthmost-web-deploy`.

## The fire model (what maps to what)

- **flame height** = download speed · **flame width** = ratcheted peak speed (spreads, eases, never contracts; remembered per-torrent) · **coal bed width** = % complete (two rows, darker in front) · **heat** (color + flicker) = seeders · **smoke** = active upload/seeding · plus **sparks** and colored **flares** (web only).

## Web specifics

- **Scenario sidebar** (left): a live mini-fire thumbnail per preset — **Slow burn** (60 min `arc`: builds rare→healthy, fades, then seeds to ~5), Healthy, Rare (1–3 seeders), 12 GB seeding (8–20, uploads too), Flash crowd — plus **Live** when a backend is present. Click to switch the main view.
- **`arc` scenarios**: `SimulatedSource` supports `arc: true`, which sweeps rate & seeders low→peak→low across the whole download (rateBand/seedBand read as `[start/end, peak]`). Used by Slow burn.
- **Per-canvas state**: `makeFireState()` — each canvas (main + every thumbnail) owns its particles/ratchet/settings, so they don't interfere. (This was a required refactor for the thumbnails.)
- **Controls**: `⛶`/`f` fullscreen (just the fire, square), `‹ ›`/`←→` cycle torrents (live, >1), `⚙` panel = Custom tuning. URL params: `?scenario=`, and for custom `?name=&size=&duration=&maxRate=&seeders=&fps=&loop=`.

## Open / loose ends

1. **"Configs not respected" (unresolved-by-repro).** User reported the public (sim) site ignoring configurations. Could not reproduce by inspection; the big sidebar refactor replaced that code path, and `no-cache` now rules out stale JS. **Pending:** user to hard-refresh and confirm the sidebar scenarios change the fire; if a specific setting still fails, get the exact repro and fix that path.
2. **Smoke during download.** Smoke now rises whenever we're feeding peers (not only when done), so "seeding while downloading" is visible — this also affects the live monitor. Flagged to user; one-line revert to done-only if they prefer.
3. **TUI particle parity.** Sparks/smoke are web-only (particles need cross-frame state the pure ANSI renderer avoids). Could add if wanted.
4. **Scenarios are web-only.** Could add a `--scenario` flag to the TUI.
5. **Public site can't mirror a real client** (by design — would need the backend exposed/proxied beyond the LAN).

## Plan: the learning / GitHub page

Goal: help people *understand* the metaphor and *use* all three surfaces.

Suggested sections:
1. **Hero** — one-liner + an animated GIF of the fire (ideally the Flash-crowd scenario, fullscreen).
2. **What the fire means** — the mapping table above, with a small labelled screenshot.
3. **Try it now** — link to the live demo; call out the scenario sidebar + fullscreen.
4. **Run it in your terminal** — `python3 -m fireplace` (+ the scenario-ish flags).
5. **Point it at your own torrents** — `--transmission HOST` quickstart (creds via env); note webseed fuel.
6. **Host a live web monitor** — `server/` + `deploy-loki.sh`, the auto-detect (live vs simulated) behaviour.
7. **How it works** — the `poll()` seam, per-canvas state, the three renderers sharing one model.

Assets to capture (need a browser — can't be generated headlessly here):
- GIFs/screenshots of each scenario, a fullscreen shot, and the TUI (asciinema or a terminal screenshot).

Options for hosting the page: enhance `README.md` (simplest), or GitHub Pages from `docs/` (Jekyll/plain HTML) for something richer with the GIFs.
