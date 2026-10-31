"""Renders the furnace as a list of ANSI-colored text lines.

Pure function of (Progress, frame_counter) -> list[str]. No I/O, no timing.
That keeps it testable (render one frame, inspect it) and reusable: the web
version can port this same logic to <canvas> / CSS later.

The Minecraft-furnace metaphor:
  * input slot  = the torrent being "smelted"
  * arrow fill  = download progress  (━━━▶ fills left-to-right)
  * flame       = burns while actively downloading, dies to embers when done
  * output slot = the finished file (an ingot) once it's complete
"""

from __future__ import annotations

import math
import random

from .sources import Progress

# ---- ANSI helpers ---------------------------------------------------------

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"


def fg(n: int) -> str:
    """256-color foreground."""
    return f"\033[38;5;{n}m"


# Fire gradient, coolest (deep red, top of flame) -> hottest (white, base).
FIRE = [52, 88, 124, 160, 196, 202, 208, 214, 220, 226, 229, 231]
STONE = 244
STONE_DARK = 240
STONE_LIGHT = 250
EMBER = [52, 88, 124, 166]
SMOKE = 243

# Occasional mineral-colored tongues that lick through the flame (copper greens,
# cool blues at the base, rare violet). Each is a gradient dark→bright like FIRE.
FLARE_BLUE = [18, 20, 21, 27, 33, 39, 45]
FLARE_GREEN = [22, 28, 34, 40, 82, 118]
FLARE_PURPLE = [54, 55, 57, 93, 99, 135, 141]

GLYPHS = "▁▂▃▄▅▆▇█"


def seeders_to_heat(peers: int) -> float:
    """Seeders are the fuel. One lone seeder → a low, cool, slow fire; a big
    swarm → a white-hot roar. Saturating curve so the first few seeders matter
    most and it tops out rather than growing without bound.

        1 → 0.08   6 → 0.39   12 → 0.63   24 → 0.86   48 → 0.98
    """
    return 1.0 - math.exp(-max(0, peers) / 12.0)


# ---- fire field -----------------------------------------------------------

def _render_fire(
    width: int,
    height: int,
    width_frac: float,
    height_level: float,
    heat: float,
    frame: int,
) -> list[str]:
    """The active flame — a central column of flame.

      * width_frac   (0..1) — how wide the flame body spreads. This is ratcheted
        by the caller (a fire spreads but doesn't contract), so it only grows.
      * height_level (0..1) — how tall the flames leap = current download speed;
        this still rises and falls, so a wide fire can burn low.
      * heat         (0..1) — seeders/fuel: color temperature + flicker speed. A
        lone seeder smoulders deep-red and slow; a swarm roars white-hot and fast.

    Columns are rendered with a sub-cell vertical fill (partial top glyph) so a
    weak fire shows a genuinely short flame instead of snapping on at a
    threshold. Horizontal taper + layered-sine flicker give it a flame shape
    that sways smoothly over time.
    """
    if height_level <= 0 or width_frac <= 0:
        return [" " * width for _ in range(height)]

    t = frame * (0.07 + 0.20 * heat)     # more fuel → livelier crackle
    heat_color = 0.30 + 0.70 * heat      # how far up the color gradient we climb
    bucket = frame // 3                   # colored licks persist a few frames

    active_w = max(2.0, width_frac * width)   # flame body width (ratcheted peak)
    center = (width - 1) / 2.0
    half = active_w / 2.0

    # Flame height per column: tallest at the centre, tapering to the edges, with
    # one smooth coherent flicker across the whole body (the original waves —
    # columns move together, no equalizer-bar look).
    col_rows = [0.0] * width
    for x in range(width):
        d = abs(x - center)
        if d <= half:
            taper = 1.0 - (d / half) ** 1.6
            wave = (
                math.sin(t + x * 0.55)
                + 0.5 * math.sin(t * 1.7 + x * 0.9)
                + 0.3 * math.sin(t * 0.4 + x * 0.23)
            ) / 1.8
            flick = 0.85 + 0.15 * wave
            col_rows[x] = max(0.0, height_level * height * taper * flick)

    rows: list[str] = []
    for row in range(height):
        rfb = height - 1 - row           # 0 at the base row, up to height-1
        line = []
        for x in range(width):
            ph = col_rows[x]             # this column's flame height, in rows
            fill = ph - rfb              # how much of THIS cell is flame
            if fill <= 0:
                line.append(" ")
                continue
            # Sub-cell fill: a full cell is a solid block; the tip is a partial
            # glyph scaled to how far the flame reaches into it.
            gi = len(GLYPHS) - 1 if fill >= 1 else min(
                len(GLYPHS) - 1, max(0, int(fill * len(GLYPHS)))
            )
            # Hottest at the base of the column, cooling toward the tip.
            depth = (ph - rfb) / max(1e-6, ph)        # ~1 at base, →0 at tip
            inten = 0.35 + 0.65 * depth

            # A rare single-cell "lick" of mineral color dropped into the flame:
            # greens tend to sit at the very base, blue/violet flick off the tips
            # of the flames. Just one square here and there — reseeded per bucket
            # so they wink and drift instead of streaking into lines.
            color = None
            roll = random.Random(
                (x * 73856093 ^ rfb * 19349663 ^ bucket * 83492791) & 0xFFFFFFFF
            ).random()
            if rfb == 0:                                   # base of the fire
                if roll < 0.10:
                    color = FLARE_GREEN[-1 - int(roll * 30) % 3]   # bright green
                elif roll < 0.13:
                    color = FLARE_BLUE[-2]
            elif fill < 1.0:                               # tip of a flame lick
                if roll < 0.08:
                    color = FLARE_BLUE[-1 - int(roll * 40) % 3]
                elif roll < 0.11:
                    color = FLARE_PURPLE[-1 - int(roll * 50) % 3]

            if color is None:
                ci = min(len(FIRE) - 1, max(0, int(inten * (len(FIRE) - 1) * heat_color)))
                color = FIRE[ci]
            line.append(f"{fg(color)}{GLYPHS[gi]}")
        rows.append("".join(line) + RESET)
    return rows


def _render_embers(width: int, coal_frac: float, heat: float, frame: int) -> str:
    """The bed of coals beneath the flame. Unlike the flame, the coals
    *accumulate*: the lit band widens with `coal_frac` (% downloaded) and stays
    wide and glowing as the fire dies — hot coals remaining when the flame has
    drawn back. Brightness/color rise with `heat` (seeders). Reseeded every few
    frames so it smoulders rather than sparkles."""
    rng = random.Random((frame // 5) * 40503 & 0xFFFFFFFF)
    active_w = coal_frac * width
    left = (width - active_w) / 2.0
    lit = 0.35 + 0.55 * heat
    base = int(heat * (len(EMBER) - 1))   # hotter swarm → brighter coals
    out = []
    for x in range(width):
        if left <= x < left + active_w:
            ci = max(0, min(len(EMBER) - 1, base + rng.randint(-1, 1)))
            if rng.random() < lit:
                out.append(f"{fg(EMBER[ci])}▪")       # a glowing coal
            else:
                out.append(f"{fg(EMBER[0])}▪")        # a dark lump of char
        else:
            out.append(f"{fg(STONE_DARK)}▄")          # bare hearth floor
    return "".join(out) + RESET


# ---- formatting helpers ---------------------------------------------------

def _human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{int(n)}B"
        n /= 1024
    return f"{n:.1f}TB"


def _smelt_arrow(width: int, frac: float) -> str:
    """Minecraft-style progress arrow: ━━━━▶ fills left-to-right."""
    filled = int(round(frac * (width - 1)))
    parts = []
    for i in range(width - 1):
        if i < filled:
            parts.append(f"{fg(214)}━")
        else:
            parts.append(f"{DIM}{fg(STONE_DARK)}─")
    head_color = 220 if frac > 0 else STONE_DARK
    parts.append(f"{fg(head_color)}▶")
    return "".join(parts) + RESET


def _bar(width: int, frac: float) -> str:
    filled = int(round(frac * width))
    return (
        f"{fg(208)}{'█' * filled}{RESET}"
        f"{DIM}{fg(STONE_DARK)}{'░' * (width - filled)}{RESET}"
    )


# ---- the furnace ----------------------------------------------------------

INNER = 36  # inner width of the furnace box

# Width ratchet: a fire spreads but never contracts — the flame holds the widest
# it has ever grown for the current torrent (height still tracks live speed).
# Reset when the torrent changes or restarts (see render()).
_SPREAD = {"key": None, "frac": 0.0, "peak": 0.0}


def render(p: Progress, frame: int) -> list[str]:
    """Return the full furnace as a list of printable (ANSI) lines."""
    g = fg(STONE)
    gl = fg(STONE_LIGHT)
    gd = fg(STONE_DARK)

    def box(content_line: str, visible_len: int) -> str:
        pad = INNER - visible_len
        return f"  {g}║{RESET} {content_line}{' ' * max(0, pad)} {g}║{RESET}"

    lines: list[str] = []

    # Header
    title = "D I G I T A L   F U R N A C E"
    lines.append(f"  {BOLD}{fg(214)}{title.center(INNER + 2)}{RESET}")
    lines.append("")

    # Top of the stone box
    lines.append(f"  {g}╔{'═' * (INNER + 2)}╗{RESET}")

    # Item name
    name = p.name or "(no item)"
    if len(name) > INNER:
        name = name[: INNER - 1] + "…"
    lines.append(box(f"{gl}{name}{RESET}", len(name)))

    # Smelting row:  [ore] ━━━▶ [ingot]
    ore = f"{fg(94)}◆{RESET}"
    done = p.is_done
    ingot = f"{fg(231)}▣{RESET}" if done else f"{gd}▢{RESET}"
    arrow = _smelt_arrow(18, p.fraction)
    row = f"{g}▐{ore}▌{RESET} {arrow} {g}▐{ingot}▌{RESET}"
    # visible chars: ▐◆▌(3) + space + 18 arrow + space + ▐▣▌(3) = 26
    lines.append(box(row, 26))

    lines.append(box("", 0))

    # Fire chamber. The flame grows from a narrow column and spreads with the
    # download *speed* (vigor); the coal bed widens with % *complete* and lingers
    # hot; seeders are the fuel that sets the heat.
    MAX_RATE = 5 * 1024 * 1024  # 5 MB/s reads as a full, roaring blaze
    heat = seeders_to_heat(p.peers)
    # Flame height tracks current speed; a small flame even when slow, none done.
    vigor = 0.0 if done else max(0.16, min(1.0, p.rate_bps / MAX_RATE))

    # Width ratchet (monotonic): the fire spreads but never contracts. Reset on a
    # torrent switch (name change) or restart (fraction jumps backwards).
    if p.name != _SPREAD["key"] or p.fraction < _SPREAD["frac"] - 0.05:
        _SPREAD.update(key=p.name, frac=p.fraction, peak=0.0)
    _SPREAD["frac"] = p.fraction
    if not done:
        _SPREAD["peak"] = max(_SPREAD["peak"], vigor)
    width_frac = _SPREAD["peak"]

    # Coals accumulate with progress and keep a warm afterglow once it's done.
    coal_frac = max(0.0, p.fraction)
    coal_heat = max(heat, 0.45) if done else heat

    fire_w = INNER - 4
    fire = _render_fire(fire_w, 5, width_frac, vigor, heat, frame)
    for frow in fire:
        inner = f" {gd}({RESET}{frow}{gd}){RESET}"
        # visible width inside: " " + "(" + fire_w + ")" = fire_w + 3
        lines.append(box(inner, fire_w + 3))

    # Ember / log base
    lines.append(box(_render_embers(INNER, coal_frac, coal_heat, frame), INNER))

    # Bottom of box
    lines.append(f"  {g}╚{'═' * (INNER + 2)}╝{RESET}")
    lines.append("")

    # Readout
    pct = f"{p.percent:5.1f}%"
    bar = _bar(22, p.fraction)
    seeders = f"{p.peers} seeder{'' if p.peers == 1 else 's'}"
    if done:
        status = f"{fg(118)}✓ complete — seeding{RESET}"
    elif p.state == "paused":
        status = f"{fg(244)}⏸ paused{RESET} {gd}· {seeders}{RESET}"
    elif p.state == "stalled":
        status = f"{fg(244)}… connecting to peers{RESET}"
    else:
        status = f"{fg(214)}{_human_bytes(p.rate_bps)}/s{RESET} {gd}· {seeders}{RESET}"
    lines.append(f"  {BOLD}{fg(220)}{pct}{RESET}  {bar}")
    size = f"{_human_bytes(p.downloaded)} / {_human_bytes(p.total)}"
    lines.append(f"  {gd}{size}{RESET}   {status}")

    return lines
