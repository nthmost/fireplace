"""The terminal loop: poll a source, render the furnace, repeat.

Everything that is *terminal-specific* lives here (alt screen, cursor hiding,
frame timing). The furnace renderer and the progress source know nothing about
the terminal, so swapping either one is trivial.
"""

from __future__ import annotations

import signal
import sys
import time

from . import furnace
from .sources import ProgressSource, SimulatedSource

HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
ALT_SCREEN = "\033[?1049h"
MAIN_SCREEN = "\033[?1049l"
CLEAR = "\033[2J"
HOME = "\033[H"


def run(source: ProgressSource, fps: float = 12.0, hold: float = 4.0) -> None:
    """Render `source` until it completes, then hold the final frame briefly.

    `hold` = seconds to linger on the 'complete — seeding' frame so the payoff
    is visible before we bow out.
    """
    out = sys.stdout
    interval = 1.0 / fps
    frame = 0
    finished_at: float | None = None

    def cleanup(*_a):
        out.write(SHOW_CURSOR + MAIN_SCREEN)
        out.flush()

    # Restore the terminal on Ctrl-C / SIGTERM.
    signal.signal(signal.SIGINT, lambda *a: (cleanup(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda *a: (cleanup(), sys.exit(0)))

    out.write(ALT_SCREEN + HIDE_CURSOR + CLEAR)
    try:
        while True:
            p = source.poll()
            lines = furnace.render(p, frame)
            out.write(HOME)
            out.write("\n".join(lines))
            out.write("\033[0J")  # clear anything below (shorter final frames)
            out.flush()

            if p.is_done:
                if finished_at is None:
                    finished_at = time.monotonic()
                elif time.monotonic() - finished_at >= hold:
                    break

            frame += 1
            time.sleep(interval)
    finally:
        cleanup()


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(
        prog="fireplace",
        description="A Minecraft-furnace fireplace that mirrors torrent progress.",
    )
    ap.add_argument("--duration", type=float, default=45.0,
                    help="simulated download length in seconds (default: 45)")
    ap.add_argument("--fps", type=float, default=12.0,
                    help="animation frames per second (default: 12)")
    ap.add_argument("--name", default="ubuntu-25.10-desktop-amd64.iso",
                    help="item name to display")
    ap.add_argument("--size", type=float, default=1.4,
                    help="simulated payload size in GB (default: 1.4)")
    args = ap.parse_args(argv)

    source = SimulatedSource(
        duration=args.duration,
        total_bytes=int(args.size * 1_000_000_000),
        name=args.name,
    )
    try:
        run(source, fps=args.fps)
    except KeyboardInterrupt:
        pass
    return 0
