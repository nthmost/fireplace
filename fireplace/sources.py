"""Progress sources for the furnace.

A ProgressSource is the ONE thing the renderer depends on. Everything that can
drive the fire — a fake simulation today, a Transmission/qBittorrent client
tomorrow, a web backend after that — just implements this interface.

    poll() -> Progress

The renderer never knows (or cares) where the numbers came from.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Progress:
    """A single snapshot of whatever the fire is mirroring."""

    fraction: float          # 0.0 .. 1.0  (how "smelted" / downloaded)
    rate_bps: float = 0.0    # current throughput, bytes/sec (0 if unknown)
    downloaded: int = 0      # bytes done   (0 if unknown)
    total: int = 0           # bytes total  (0 if unknown)
    name: str = ""           # torrent / item name
    peers: int = 0           # connected peers (flavor)
    state: str = "active"    # active | paused | done | stalled

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

        return Progress(
            fraction=min(1.0, frac),
            rate_bps=0.0 if done else rate,
            downloaded=int(frac * self.total_bytes),
            total=self.total_bytes,
            name=self.name,
            peers=peers,
            state=state,
        )
