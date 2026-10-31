"""Progress sources for the furnace.

A ProgressSource is the ONE thing the renderer depends on. Everything that can
drive the fire — a fake simulation today, a Transmission/qBittorrent client
tomorrow, a web backend after that — just implements this interface.

    poll() -> Progress

The renderer never knows (or cares) where the numbers came from.
"""

from __future__ import annotations

import base64
import json
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class Progress:
    """A single snapshot of whatever the fire is mirroring."""

    fraction: float          # 0.0 .. 1.0  (how "smelted" / downloaded)
    rate_bps: float = 0.0    # current download throughput, bytes/sec
    downloaded: int = 0      # bytes done   (0 if unknown)
    total: int = 0           # bytes total  (0 if unknown)
    name: str = ""           # torrent / item name
    peers: int = 0           # sources feeding us (download fuel)
    state: str = "active"    # active | paused | done | stalled
    up_peers: int = 0        # peers downloading FROM us (seeding activity → smoke)
    up_rate_bps: float = 0.0 # current upload throughput, bytes/sec

    @property
    def percent(self) -> float:
        return max(0.0, min(1.0, self.fraction)) * 100.0

    @property
    def is_done(self) -> bool:
        return self.fraction >= 1.0 or self.state == "done"


class ProgressSource:
    """Base class. Subclass and implement poll()."""

    def poll(self) -> Progress:  # pragma: no cover - interface
        raise NotImplementedError


class SimulatedSource(ProgressSource):
    """Fakes a torrent download so we can build the fire before wiring a client.

    Progress eases toward 100% over `duration` seconds. Download rate wobbles
    like a real torrent (ramps up, dips, surges on burst peers) so the flame
    has something lively to react to.
    """

    def __init__(
        self,
        duration: float = 45.0,
        total_bytes: int = 1_400_000_000,  # ~1.4 GB, a plausible-looking payload
        name: str = "ubuntu-25.10-desktop-amd64.iso",
        seed: int | None = 1312,
    ):
        import random

        self.duration = max(1.0, duration)
        self.total_bytes = total_bytes
        self.name = name
        self._start = time.monotonic()
        self._rng = random.Random(seed)
        self._last_t = self._start
        self._last_frac = 0.0
        self._peers = 2.0       # drifts smoothly (fuel shouldn't strobe the fire)
        self._rate_ema = 0.0    # smoothed throughput (ditto for flame height)
        self._up = 0.0          # seeding peers once complete (drives the smoke)

    def _curve(self, t: float) -> float:
        # Slow start (connecting to peers), fast middle, taper at the end
        # (last few pieces are always the slowest). Smoothstep-ish.
        x = min(1.0, t / self.duration)
        return x * x * (3 - 2 * x)

    def poll(self) -> Progress:
        now = time.monotonic()
        elapsed = now - self._start
        frac = self._curve(elapsed)

        # Derive an instantaneous rate from how much fraction moved since the
        # last poll, add jitter so it isn't robotic, then smooth with an EMA so
        # the flame height drifts instead of flashing every frame.
        dt = max(1e-3, now - self._last_t)
        dfrac = max(0.0, frac - self._last_frac)
        base_rate = (dfrac * self.total_bytes) / dt
        jitter = 1.0 + self._rng.uniform(-0.25, 0.35)
        inst_rate = base_rate * jitter
        self._rate_ema = 0.75 * self._rate_ema + 0.25 * inst_rate
        rate = self._rate_ema

        self._last_t = now
        self._last_frac = frac

        # Seeders (fuel) drift smoothly toward a target that swells as more peers
        # discover the swarm, then eases off near the end — a slow random walk,
        # never a per-frame jump.
        target = 3.0 + 34.0 * math.sin(math.pi * min(1.0, frac))
        self._peers += 0.12 * (target - self._peers) + self._rng.uniform(-1.0, 1.0)
        self._peers = max(1.0, min(60.0, self._peers))

        done = frac >= 0.999
        peers = 0 if done else max(1, round(self._peers))
        state = "done" if done else ("stalled" if rate < 1 else "active")

        # Once complete, simulate seeding to a drifting handful of leechers so the
        # finished fire puffs smoke (no upload activity while still downloading).
        if done:
            self._up += 0.1 * (5.0 - self._up) + self._rng.uniform(-0.8, 0.8)
            self._up = max(0.0, min(12.0, self._up))
            up_peers = round(self._up) if self._up > 0.5 else 0
        else:
            up_peers = 0

        return Progress(
            fraction=min(1.0, frac),
            rate_bps=0.0 if done else rate,
            downloaded=int(frac * self.total_bytes),
            total=self.total_bytes,
            name=self.name,
            peers=peers,
            state=state,
            up_peers=up_peers,
            up_rate_bps=up_peers * 55_000,
        )


class TransmissionSource(ProgressSource):
    """A real torrent, read from a Transmission daemon over its RPC API.

    Implements the same ``poll() -> Progress`` contract as SimulatedSource, so
    the furnace and the TUI don't change at all — this is Phase 3.

    Mapping into the fire's axes:
      * ``percentDone``       → fraction (flame width/height arc + coal bed)
      * ``rateDownload``      → rate_bps (flame height = speed)
      * ``peersSendingToUs``  → peers    (seeders = the fuel = heat)

    Transmission's RPC needs a session-id handshake (first call 409s with the
    ``X-Transmission-Session-Id`` header, which is echoed back thereafter) and
    HTTP Basic auth. Results are cached for ``refresh`` seconds so the animation
    can run at a high frame rate without hammering the daemon — the flames keep
    flickering (frame-driven) while the numbers update about once a second.
    """

    FIELDS = ["id", "name", "percentDone", "rateDownload", "sizeWhenDone",
              "peersSendingToUs", "webseedsSendingToUs", "peersConnected", "status",
              "peersGettingFromUs", "rateUpload"]
    # Transmission status codes → our state vocabulary.
    _STATUS = {0: "paused", 1: "stalled", 2: "stalled", 3: "stalled",
               4: "active", 5: "stalled", 6: "done"}

    def __init__(
        self,
        host: str = "localhost",
        port: int = 9091,
        username: str = "",
        password: str = "",
        torrent: int | str | None = None,  # id, name-substring, or None=auto-pick
        refresh: float = 1.0,
    ):
        self.url = f"http://{host}:{port}/transmission/rpc"
        self._auth = "Basic " + base64.b64encode(
            f"{username}:{password}".encode()
        ).decode()
        self.torrent = torrent
        self.refresh = max(0.2, refresh)
        self._sid = ""
        self._last_rpc = 0.0
        self._cache: Progress | None = None
        self._rate_ema = 0.0
        self._peers_ema = 0.0
        self.current_id: int | None = None   # id of the torrent last selected
        self.current_name = ""
        self.last_list: list[dict] = []       # [{"id", "name"}] of all torrents

    def select(self, torrent: int | str | None) -> None:
        """Switch which torrent is mirrored (resets the cache + smoothing so the
        fire re-reads the new torrent cleanly instead of carrying values over)."""
        if torrent != self.torrent:
            self.torrent = torrent
            self._cache = None
            self._last_rpc = 0.0
            self._rate_ema = 0.0
            self._peers_ema = 0.0

    def list_torrents(self) -> list[dict]:
        """Lightweight {id, name} list of everything in the daemon."""
        out = self._call({"method": "torrent-get",
                          "arguments": {"fields": ["id", "name"]}})
        return [{"id": t["id"], "name": t["name"]}
                for t in out["arguments"]["torrents"]]

    def _call(self, body: dict) -> dict:
        data = json.dumps(body).encode()
        for attempt in (0, 1):  # retry once to pick up a fresh session id
            req = urllib.request.Request(
                self.url,
                data=data,
                headers={
                    "Authorization": self._auth,
                    "X-Transmission-Session-Id": self._sid,
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=8) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 409 and attempt == 0:
                    self._sid = e.headers.get("X-Transmission-Session-Id", "")
                    continue
                raise
        raise RuntimeError("transmission rpc: session handshake failed")

    def _select(self, torrents: list[dict]) -> dict | None:
        if not torrents:
            return None
        want = self.torrent
        if isinstance(want, int) or (isinstance(want, str) and want.isdigit()):
            wid = int(want)
            for t in torrents:
                if t["id"] == wid:
                    return t
        if isinstance(want, str) and want:
            for t in torrents:
                if want.lower() in t["name"].lower():
                    return t
        # Auto: the liveliest download, else the least-complete, else the first.
        downloading = [t for t in torrents if t["status"] == 4]
        if downloading:
            return max(downloading, key=lambda t: t["rateDownload"])
        incomplete = [t for t in torrents if t["percentDone"] < 1.0]
        if incomplete:
            return min(incomplete, key=lambda t: t["percentDone"])
        return torrents[0]

    def poll(self) -> Progress:
        now = time.monotonic()
        if self._cache is not None and now - self._last_rpc < self.refresh:
            return self._cache  # serve cache; the fire animates on the frame clock

        try:
            out = self._call({"method": "torrent-get",
                              "arguments": {"fields": self.FIELDS}})
            all_torrents = out["arguments"]["torrents"]
            self.last_list = [{"id": x["id"], "name": x["name"]} for x in all_torrents]
            t = self._select(all_torrents)
        except Exception:
            # Don't crash the fire on a transient network hiccup — keep the last
            # frame, or show a cold, stalled hearth if we never connected.
            if self._cache is not None:
                return self._cache
            return Progress(fraction=0.0, name="(transmission unreachable)",
                            state="stalled")

        self._last_rpc = now
        if t is None:
            self.current_id, self.current_name = None, ""
            self._cache = Progress(fraction=0.0, name="(no torrents)",
                                   state="stalled")
            return self._cache
        self.current_id, self.current_name = t["id"], t["name"]

        frac = float(t["percentDone"])
        rate = float(t["rateDownload"])
        # "Fuel" = every source actively feeding us: BitTorrent seeders AND HTTP
        # webseeds (archive.org-style torrents are often pure webseed, 0 peers).
        peers = float(t["peersSendingToUs"] + t.get("webseedsSendingToUs", 0))
        first = self._cache is None
        # Light smoothing so flame height / heat drift rather than snap each tick.
        self._rate_ema = rate if first else 0.6 * self._rate_ema + 0.4 * rate
        self._peers_ema = peers if first else 0.7 * self._peers_ema + 0.3 * peers

        done = frac >= 1.0 or t["status"] == 6
        state = "done" if done else self._STATUS.get(t["status"], "stalled")
        if state == "active" and self._rate_ema < 1:
            state = "stalled"

        self._cache = Progress(
            fraction=min(1.0, frac),
            rate_bps=0.0 if done else self._rate_ema,
            downloaded=int(frac * t["sizeWhenDone"]),
            total=int(t["sizeWhenDone"]),
            name=t["name"],
            peers=0 if done else int(round(self._peers_ema)),
            state=state,
            up_peers=int(t.get("peersGettingFromUs", 0)),   # leechers we're feeding
            up_rate_bps=float(t.get("rateUpload", 0.0)),
        )
        return self._cache
