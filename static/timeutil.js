/* High-resolution temporal utilities — frontend mirror of engine/timeutil.py.
 * Base unit: SECONDS. One formatter for the whole app — no duplicated logic. */
window.TimeUtil = (() => {
  const MIN = 60, H = 3600, D = 86400, W = 604800, MO = 2592000, Y = 31536000;
  const UNITS = [["y", Y], ["mo", MO], ["w", W], ["d", D], ["h", H], ["m", MIN], ["s", 1]];

  function formatDuration(seconds, maxParts = 2) {
    let s = Math.round(Number(seconds) || 0);
    if (s <= 0) return "0s";
    const parts = [];
    for (const [name, size] of UNITS) {
      if (s >= size) {
        const q = Math.floor(s / size);
        s -= q * size;
        parts.push(q + name);
        if (parts.length >= maxParts) break;
      }
    }
    return parts.length ? parts.join(" ") : "0s";
  }

  function formatOffset(seconds) { return "T+" + formatDuration(seconds); }

  function chooseScale(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s < H) return "seconds";
    if (s < D) return "hours";
    if (s < 90 * D) return "days";
    if (s < 2 * Y) return "months";
    return "years";
  }

  return { formatDuration, formatOffset, chooseScale };
})();
