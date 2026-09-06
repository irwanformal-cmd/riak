"""High-resolution temporal utilities — single source of truth for time.

Internal base unit is SECONDS (continuous). Existing engine data stores
per-edge delays as whole days (`delay_days`, timeline `day`); this module
normalizes them losslessly (day * 86400) and formats any offset into the
most readable unit — seconds, minutes, hours, days, weeks, months, years —
without ever producing awkward decimals like "0.00215 days".

Months/years use civil averages (30d / 365d) and are display-only: the
underlying value always stays an exact integer second count.
"""

SECOND = 1
MINUTE = 60
HOUR = 3600
DAY = 86400
WEEK = 604800
MONTH = 2592000      # 30d, display granularity only
YEAR = 31536000      # 365d, display granularity only

_UNITS = (
    ("y", YEAR), ("mo", MONTH), ("w", WEEK), ("d", DAY),
    ("h", HOUR), ("m", MINUTE), ("s", SECOND),
)


def normalize_seconds(value, unit: str = "s") -> int:
    """Any engine time value -> exact integer seconds."""
    if value is None:
        return 0
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0
    factor = {"s": SECOND, "m": MINUTE, "h": HOUR, "d": DAY,
              "day": DAY, "days": DAY, "w": WEEK}.get(unit, SECOND)
    return int(round(v * factor))


def days_to_seconds(days) -> int:
    """Lossless conversion for the engine's integer-day fields."""
    return normalize_seconds(days, "d")


def format_duration(seconds, lang: str = "en", max_parts: int = 2) -> str:
    """Adaptive human duration: 3 -> '3s', 138 -> '2m 18s',
    93720 -> '1d 2h 2m', 39679200 -> '1y 3mo'. Largest units first,
    at most `max_parts` components; zero -> '0s'."""
    try:
        s = int(round(float(seconds)))
    except (TypeError, ValueError):
        return "0s"
    if s <= 0:
        return "0s"
    parts = []
    for name, size in _UNITS:
        if s >= size:
            q, s = divmod(s, size)
            parts.append(f"{q}{name}")
            if len(parts) >= max_parts:
                break
    return " ".join(parts) if parts else "0s"


def format_offset(seconds, lang: str = "en") -> str:
    """Timeline offset label: 'T+3s', 'T+1d 2h'."""
    return "T+" + format_duration(seconds, lang)


def choose_scale(seconds) -> str:
    """Coarse scale bucket for timeline tick layout."""
    s = max(0, int(seconds or 0))
    if s < HOUR:
        return "seconds"
    if s < DAY:
        return "hours"
    if s < 90 * DAY:
        return "days"
    if s < 2 * YEAR:
        return "months"
    return "years"
