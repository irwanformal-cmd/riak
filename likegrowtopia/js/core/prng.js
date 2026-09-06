// Deterministic PRNG + value noise. World gen is reproducible from a seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable 2D integer hash -> [0,1)
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// 1D value noise
export function noise1(x, seed) {
  const xi = Math.floor(x), xf = x - xi;
  const a = hash2(xi, 0, seed), b = hash2(xi + 1, 0, seed);
  return a + (b - a) * smooth(xf);
}

// 2D value noise
export function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal brownian motion
export function fbm1(x, seed, octaves = 4) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += noise1(x * freq, seed + i * 101) * amp;
    freq *= 2; amp *= 0.5;
  }
  return v;
}
export function fbm2(x, y, seed, octaves = 4) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += noise2(x * freq, y * freq, seed + i * 131) * amp;
    freq *= 2; amp *= 0.5;
  }
  return v;
}
