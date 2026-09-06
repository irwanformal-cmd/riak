// ============================================================================
// World store: a tile grid resolved from (a) seeded generation + (b) a journal
// of player modifications. Only the journal is persisted — the base terrain is
// always reproducible from the seed. This split is what later lets a server
// stay authoritative over world state with minimal sync traffic.
// ============================================================================

import { TILE, tileDef, isSolid } from '../data/tiles.js';
import { resolveTile, surfaceHeight, WORLD_W, WORLD_H } from './gen.js';

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.w = WORLD_W;
    this.h = WORLD_H;
    this.mods = new Map(); // "x,y" -> tileId (player edits only)
  }

  key(x, y) { return x + ',' + y; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  get(x, y) {
    if (!this.inBounds(x, y)) return TILE.STONE; // world edge acts solid
    const k = this.key(x, y);
    if (this.mods.has(k)) return this.mods.get(k);
    return resolveTile(x, y, this.seed);
  }

  set(x, y, id) {
    if (!this.inBounds(x, y)) return false;
    const k = this.key(x, y);
    // If a tile is set back to generated terrain, drop the journal entry.
    if (resolveTile(x, y, this.seed) === id) this.mods.delete(k);
    else this.mods.set(k, id);
    return true;
  }

  def(x, y) { return tileDef(this.get(x, y)); }
  solid(x, y) { return isSolid(this.get(x, y)); }

  surfaceAt(x) { return surfaceHeight(x, this.seed); }

  // Find a good spawn: scan outward from centre for a column with clear
  // headroom AND relatively flat ground either side so the player can
  // immediately walk around (not be boxed in by a cliff).
  findSpawn() {
    const cx = Math.floor(this.w / 2);
    let fallback = null;
    for (let off = 0; off < this.w / 2; off++) {
      for (const x of [cx + off, cx - off]) {
        if (x < 4 || x > this.w - 5) continue;
        const surf = this.surfaceAt(x);
        // 4 clear tiles above for headroom
        let clear = true;
        for (let dy = 1; dy <= 4; dy++) {
          if (this.get(x, surf - dy) !== 0) { clear = false; break; }
        }
        if (!clear || !this.solid(x, surf)) continue;

        const spot = { x: x + 0.5, y: surf };
        if (!fallback) fallback = spot;

        // prefer flat neighbours (within 1 tile) on both sides
        let flat = true;
        for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(this.surfaceAt(x + dx) - surf) > 1) { flat = false; break; }
        }
        if (flat) return spot;
      }
    }
    return fallback || { x: cx + 0.5, y: this.surfaceAt(cx) };
  }

  serializeMods() {
    const out = [];
    for (const [k, v] of this.mods) out.push(k + ':' + v);
    return out;
  }
  loadMods(arr) {
    this.mods.clear();
    for (const e of arr || []) {
      const idx = e.lastIndexOf(':');
      this.mods.set(e.slice(0, idx), parseInt(e.slice(idx + 1), 10));
    }
  }
}
