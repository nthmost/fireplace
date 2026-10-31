"""fireplace — a digital Minecraft-furnace that mirrors torrent progress."""

from .sources import Progress, ProgressSource, SimulatedSource

__version__ = "0.1.0"
__all__ = ["Progress", "ProgressSource", "SimulatedSource"]
