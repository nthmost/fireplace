"""The terminal loop: poll a source, render the furnace, repeat.

Everything that is *terminal-specific* lives here (alt screen, cursor hiding,
frame timing). The furnace renderer and the progress source know nothing about
the terminal, so swapping either one is trivial.
"""

from __future__ import annotations

import signal
import sys
import time

import os

from . import furnace
from .sources import ProgressSource, SimulatedSource, TransmissionSource

HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
ALT_SCREEN = "\033[?1049h"
MAIN_SCREEN = "\033[?1049l"
CLEAR = "\033[2J"
HOME = "\033[H"


def run(source: ProgressSource, fps: float = 12.0, hold: float = 4.0,
        exit_on_done: bool = True) -> None:
    """Render `source` until it completes, then hold the final frame briefly.

    `hold` = seconds to linger on the 'complete — seeding' frame so the payoff
    is visible before we bow out. `exit_on_done=False` keeps watching forever
    (for a live torrent monitor) — leave with Ctrl-C.
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

            if p.is_done and exit_on_done:
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
    ap.add_argument("--fps", type=float, default=12.0,
                    help="animation frames per second (default: 12)")
    # Simulated source (default)
    ap.add_argument("--duration", type=float, default=45.0,
                    help="[sim] simulated download length in seconds (default: 45)")
    ap.add_argument("--name", default="ubuntu-25.10-desktop-amd64.iso",
                    help="[sim] item name to display")
    ap.add_argument("--size", type=float, default=1.4,
                    help="[sim] simulated payload size in GB (default: 1.4)")
    # Real Transmission source
    ap.add_argument("--transmission", metavar="HOST[:PORT]",
                    help="mirror a real Transmission daemon instead of simulating "
                         "(e.g. loki.local or loki.local:9091)")
    ap.add_argument("--rpc-user", default=os.environ.get("TR_RPC_USER", ""),
                    help="Transmission RPC username (or env TR_RPC_USER)")
    ap.add_argument("--rpc-pass", default=os.environ.get("TR_RPC_PASS", ""),
                    help="Transmission RPC password (or env TR_RPC_PASS)")
    ap.add_argument("--torrent", default=None,
                    help="which torrent: id, name substring, or omit to auto-pick")
    args = ap.parse_args(argv)

    if args.transmission:
        host, _, port = args.transmission.partition(":")
        source = TransmissionSource(
            host=host,
            port=int(port) if port else 9091,
            username=args.rpc_user,
            password=args.rpc_pass,
            torrent=args.torrent,
        )
        exit_on_done = False  # live monitor — keep burning until Ctrl-C
    else:
        source = SimulatedSource(
            duration=args.duration,
            total_bytes=int(args.size * 1_000_000_000),
            name=args.name,
        )
        exit_on_done = True

    try:
        run(source, fps=args.fps, exit_on_done=exit_on_done)
    except KeyboardInterrupt:
        pass
    return 0
