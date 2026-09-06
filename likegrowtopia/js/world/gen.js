// ============================================================================
// Procedural world generation — deterministic from a world seed.
// Multi-scale terrain: continental → hills → detail + ridge.
// Parameterized trees/mushrooms with per-instance seeded jitter.
// Biomes will later plug in here.
// ============================================================================

import { TILE } from '../data/tiles.js';
import { mulberry32, fbm1, fbm2, noise1, noise2 } from '../core/prng.js';

export const WORLD_W = 400;
export const WORLD_H = 140;
const SEA_LEVEL = 85;

// --- terrain: multi-scale height ---
export function surfaceHeight(x, seed) {
  // continental: slow undulation (range ~18)
  const continental = fbm1(x * 0.006, seed, 3) * 18;
  // hills: medium scale (range ~12)
  const hills = fbm1(x * 0.022, seed + 200, 4) * 12;
  // detail: small bumps (range ~4)
  const detail = fbm1(x * 0.08, seed + 500, 3) * 4;
  // ridge: occasional sharp features
  const ridge = Math.abs(fbm1(x * 0.035, seed + 700, 3) - 0.5) * 8;

  const h = SEA_LEVEL - continental - hills - detail - ridge * 0.3;
  return Math.floor(Math.max(20, Math.min(WORLD_H - 15, h)));
}

// --- column-level feature decisions (cached, deterministic) ---
const colCache = new Map();
function columnInfo(x, seed) {
  const ck = seed + ':' + x;
  let c = colCache.get(ck);
  if (c) return c;
  const surf = surfaceHeight(x, seed);
  const rng = mulberry32((x * 2654435761 ^ seed) >>> 0);
  const roll = rng();

  // gate: frequency control for features (cluster them)
  const gate = fbm1(x * 0.045, seed + 55, 2);
  let feature = null;

  if (gate > 0.48) {
    if (roll < 0.13) {
      // tree: varied height, canopy spread
      feature = {
        kind: 'tree',
        h: 5 + Math.floor(rng() * 6),           // 5–10 tall
        canopyR: 2 + Math.floor(rng() * 2),      // canopy radius 2–3
        canopyH: 2 + Math.floor(rng() * 2),      // canopy height 2–3
        lean: (rng() - 0.5) * 0.3,               // slight lean
        variant: Math.floor(rng() * 3),           // 3 canopy shapes
      };
    } else if (roll < 0.24) {
      // giant mushroom
      feature = {
        kind: 'mushroom',
        h: 4 + Math.floor(rng() * 5),            // 4–8 tall
        capR: 1 + Math.floor(rng() * 2),         // cap radius 1–2
        capH: 1 + Math.floor(rng() * 2),         // cap height 1–2
        curve: (rng() - 0.5) * 0.4,              // cap curve
        spots: 2 + Math.floor(rng() * 3),        // number of glow spots
      };
    } else if (roll < 0.32) {
      feature = { kind: 'flower' };
    } else if (roll < 0.40) {
      feature = { kind: 'magic_bush', h: 1 + Math.floor(rng() * 2) };
    } else if (roll < 0.44) {
      feature = { kind: 'crystal_cluster', count: 2 + Math.floor(rng() * 3) };
    }
  }

  c = { surf, feature };
  if (colCache.size > 5000) colCache.clear();
  colCache.set(ck, c);
  return c;
}

// --- caves: wormy biomes ---
function caveAt(x, y, seed) {
  const n1 = fbm2(x * 0.055, y * 0.075, seed + 21, 3);
  const n2 = fbm2(x * 0.09 + 50, y * 0.09 + 50, seed + 42, 2);
  return (n1 > 0.63 || n2 > 0.72) && y > 25;
}

// --- base terrain (no features) ---
export function generateTile(x, y, seed) {
  const { surf } = columnInfo(x, seed);
  if (y < surf) return TILE.AIR;

  const depth = y - surf;

  // surface
  if (depth === 0) {
    const hasM = hasPatch(x, seed);
    return hasM ? TILE.MAGICAL_GRASS : TILE.GRASS;
  }
  if (depth < 5) {
    return hasPatch(x, seed) ? TILE.MAGICAL_SOIL : TILE.DIRT;
  }

  // caves
  if (caveAt(x, y, seed) && depth > 6) return TILE.AIR;

  // crystal seams
  if (depth > 25 && noise2(x * 0.14, y * 0.14, seed + 99) > 0.76) return TILE.CRYSTAL;

  // magical soil pockets
  if (depth > 10 && depth < 28 && noise2(x * 0.11, y * 0.11, seed + 77) > 0.70) {
    return TILE.MAGICAL_SOIL;
  }

  // underground glowcap patches
  if (depth > 12 && depth < 30 && noise2(x * 0.08, y * 0.08, seed + 55) > 0.74) {
    return TILE.GLOW_CAP_BLOCK;
  }

  return TILE.STONE;
}

// --- magical patch (surface glow) ---
function hasPatch(x, seed) {
  for (let dx = -2; dx <= 2; dx++) {
    const f = columnInfo(x + dx, seed).feature;
    if (f && f.kind === 'magic_bush' && Math.abs(dx) <= 2) return true;
  }
  return false;
}

// --- surface feature tiles (trees, mushrooms, flowers, etc.) ---
export function featureTile(x, y, seed) {
  for (let dx = -5; dx <= 5; dx++) {
    const col = x + dx;
    if (col < 0 || col >= WORLD_W) continue;
    const { surf, feature } = columnInfo(col, seed);
    if (!feature) continue;

    if (feature.kind === 'tree') {
      const top = surf - feature.h;
      const leanOffset = Math.round(feature.lean * (y - top));
      // trunk
      if (dx === 0 && y < surf && y >= top) return TILE.ENCHANTED_WOOD;
      // canopy
      const cy = y - top, ax = Math.abs(dx - leanOffset);
      const cr = feature.canopyR;
      const ch = feature.canopyH;
      if (cy >= -ch - 1 && cy <= 0 && ax <= cr) {
        // variant shapes
        if (feature.variant === 0) {
          // round canopy
          if (ax <= cr - (cy < -ch + 1 ? 1 : 0)) return TILE.LEAVES;
        } else if (feature.variant === 1) {
          // pointed (diamond)
          if (ax + Math.abs(cy + 1) <= cr) return TILE.LEAVES;
        } else {
          // wide flat canopy
          if (ax <= cr + 1 && cy >= -1) return TILE.LEAVES;
          if (ax <= cr) return TILE.LEAVES;
        }
      }
    } else if (feature.kind === 'mushroom') {
      const top = surf - feature.h;
      const cr = feature.capR;
      const ch = feature.capH;
      // stem
      if (dx === 0 && y < surf && y >= top) return TILE.MUSHROOM_STEM;
      // cap
      if (y >= top - ch - 1 && y <= top - 1) {
        const capY = (y - (top - ch));
        const capWidth = cr - Math.floor(capY * 0.3 * (1 + feature.curve));
        if (Math.abs(dx) <= Math.max(capWidth, 1)) return TILE.GLOW_CAP_BLOCK;
      }
    } else if (feature.kind === 'flower') {
      if (dx === 0 && y === surf - 1) return TILE.GLOW_FLOWER;
      // deterministic second flower using seeded noise
      if (dx === 0 && y === surf - 2 && noise2(x * 0.7, y * 0.7, seed + 33) > 0.85) return TILE.GLOW_FLOWER;
    } else if (feature.kind === 'magic_bush') {
      if (Math.abs(dx) <= 1 && y <= surf - 1 && y >= surf - feature.h - 1) {
        if (dx === 0 && y === surf - 1) return TILE.GLOW_FLOWER;
        return TILE.LEAVES;
      }
    } else if (feature.kind === 'crystal_cluster') {
      if (Math.abs(dx) <= 1 && y === surf - 1) return TILE.CRYSTAL;
      if (dx === 0 && y === surf - 2 && feature.count > 2) return TILE.CRYSTAL;
    }
  }
  return null;
}

// --- final authoritative tile ---
export function resolveTile(x, y, seed) {
  const f = featureTile(x, y, seed);
  if (f !== null) return f;
  return generateTile(x, y, seed);
}
