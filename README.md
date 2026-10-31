# 🔥 fireplace

A digital **Minecraft-furnace** that mirrors the progress of a torrent — as a
zero-dependency terminal animation and as a web page.

**Live demo (simulated): https://fireplace.nthmost.com**

The **fire is a live readout of the swarm** — a furnace smelting the torrent into
being. It behaves like a real fire: igniting as a narrow column, spreading wide
and tall at full burn, then drawing back to a low flame over a wide bed of
glowing coals:

| Part | Driven by | Behavior |
|------|-----------|----------|
| **Active flame height** | **download speed** | ignites low, leaps taller the faster it downloads, sinks to a low flame as the download slows |
| **Active flame width** | **widest speed so far** (ratchet) | spreads as the fire picks up and **holds that width** — a fire doesn't contract once it's caught, so it can burn wide but low |
| **Coal bed** (width) | **% complete** | coals *accumulate* as data arrives — the glowing bed widens with progress and lingers hot after the flame dies down |
| **Heat** (color + flicker speed) | **seeders** (the fuel) | 1 seeder → dim, deep-red, slow smoulder; a big swarm → white-hot and fast |

Plus rare single-cell **licks** of mineral color sprinkled through the flame —
greens at the base, blue and violet flicking off the tips.

```
      D I G I T A L   F U R N A C E

  ╔══════════════════════════════════════╗
  ║ ubuntu-25.10-desktop-amd64.iso       ║
  ║ ▐◆▌ ━━━━━━━──────────▶ ▐▢▌           ║
  ║                                      ║
  ║  (             ▃▃▄▆▄▃             )  ║
  ║  (     ▄▅▅▅▆█▇▇▆█▇█▇▆▆▆▇▅▅▅       )  ║
  ║  (███▇▇███▇█▇█▇▇██▇▇███▇▇██▇▇▇███▇)  ║
  ║ ▪▪▄▪▪▄▄▪▪▪▄▪▪▄▄▪▄▪▪▄▄▄▄▪▪▪▪▄▪▄▪▪▄▪▄▪ ║
  ╚══════════════════════════════════════╝

   43.0%  █████████░░░░░░░░░░░░░
  574.1MB / 1.3GB   2.1MB/s · 23 seeders
```

## Terminal (TUI)

No dependencies, just Python 3.9+:

```shell
python3 -m fireplace                       # 45s simulated download
python3 -m fireplace --duration 20 --fps 15
python3 -m fireplace --name "big-linux-iso.torrent" --size 4.7
```

Press `Ctrl-C` to bail out (the terminal is restored cleanly). The TUI also draws
the classic Minecraft-furnace header — input slot `◆`, smelting arrow `━━▶`,
output ingot `▣` — above the fire (the web version drops it as redundant).

## Real torrents (Transmission)

Point the TUI at a running [Transmission](https://transmissionbt.com/) daemon and
the same furnace burns on live data — no simulation:

```shell
export TR_RPC_USER=myuser TR_RPC_PASS=mypass
python3 -m fireplace --transmission HOST[:PORT]        # e.g. nas.local or nas.local:9091
python3 -m fireplace --transmission nas.local --torrent "ubuntu"   # pick by id or name
```

Credentials come from `--rpc-user/--rpc-pass` or the `TR_RPC_USER`/`TR_RPC_PASS`
env vars (never hard-code them). With no `--torrent`, it auto-picks the liveliest
download. It runs as a **live monitor** — it keeps burning (even through
completion/seeding) until you `Ctrl-C`.

The fuel (heat) counts **every source feeding you** — BitTorrent seeders *and*
HTTP webseeds (`peersSendingToUs + webseedsSendingToUs`), so archive.org-style
webseed torrents still light the fire. `TransmissionSource` is just another
`poll()` — the furnace and TUI are unchanged.

## Web

A vanilla-JS canvas port of the same fire model lives in [`web/`](web/) — no build
step, no framework. Open `web/index.html` directly, or serve the folder:

```shell
cd web && python3 -m http.server 8000      # then open http://localhost:8000
```

### Config vars

Set them via **URL query params** (shareable) or the in-page **⚙ control panel**:

```
https://fireplace.nthmost.com/?name=debian-13.iso&size=3.7&duration=60&maxRate=8&seeders=45&loop=1
```

| Param | Meaning | Default |
|-------|---------|---------|
| `name` | item name shown on the furnace | an Ubuntu ISO |
| `size` | payload size in GB | `1.4` |
| `duration` | simulated download length, seconds | `45` |
| `maxRate` | download speed (MB/s) that reads as a full blaze | `5` |
| `seeders` | pin the swarm size (omit / blank = auto-ramp) | auto |
| `fps` | animation frame rate | `24` |
| `loop` | restart when the download completes | `1` |

### Deploy (static, simulated)

```shell
cd web && ./deploy.sh        # rsync to nthmost@nthmost.com:/var/www/fireplace.nthmost.com
```

## Live web monitor (real torrent)

The static page can't reach Transmission directly (creds, CORS, RPC whitelist), so
[`server/`](server/) adds a tiny zero-dependency backend that serves the same
`web/` furnace **and** a `GET /api/progress` endpoint mirroring a real torrent —
credentials stay server-side. The page auto-detects it: if `/api/progress`
answers it goes **live** (badge + no sim controls), otherwise it falls back to the
simulated demo. Run it on the box that runs Transmission.

```shell
# locally:
export TR_RPC_USER=… TR_RPC_PASS=… TR_HOST=127.0.0.1 TR_TORRENT=Pimsleur
python3 server/server.py                      # → http://localhost:8673/

# as a systemd service on the Transmission host (pulls creds from the daemon's
# own postprocess.conf; writes a local .env; needs passwordless sudo):
ssh myhost 'bash -s' < server/deploy-loki.sh  # → http://myhost.local:8673/
```

Config (env): `FIREPLACE_PORT` `FIREPLACE_HOST` `TR_HOST` `TR_PORT`
`TR_RPC_USER` `TR_RPC_PASS` `TR_TORRENT` (id or name substring).

### Cycling torrents

In live mode, if the daemon holds more than one torrent, **‹ / ›** arrows appear
in the furnace's side margins (and the **← / →** keys work) to cycle through them,
with an `n / m` indicator. `GET /api/progress?id=<n>` selects a specific torrent
and returns the full torrent list + current index; switching re-reads the chosen
torrent cleanly (smoothing resets so values don't carry over).

## Architecture

The whole thing is built around one tiny seam so each phase is a drop-in swap:
**a progress source exposes a single `poll()` and the renderer never knows where
the numbers came from.**

| Piece | TUI | Web |
|-------|-----|-----|
| **Progress source** (`poll()`) | `fireplace/sources.py` | `web/js/sources.js` |
| **Renderer** (pure `(progress, frame) → pixels`) | `fireplace/furnace.py` | `web/js/furnace.js` |
| **Loop** (display-specific) | `fireplace/tui.py` | `web/js/app.js` |

The TUI ships two sources — `SimulatedSource` and `TransmissionSource` — and the
renderer can't tell them apart. New backends (qBittorrent, a web endpoint) just
add another `poll()`.

## Roadmap

- [x] **Phase 1** — TUI furnace, simulated progress
- [x] **Phase 2** — web version at [fireplace.nthmost.com](https://fireplace.nthmost.com), simulated
- [x] **Phase 3** — real torrents via `TransmissionSource` (BitTorrent + webseed fuel)
- [x] **Phase 4** — live web monitor (`server/`): real torrent in the browser, with
      multi-torrent cycling
- [ ] more sources (`QBittorrentSource`, …) — each just implements `poll()`

## License

MIT — see [LICENSE](LICENSE).
