// ============================================================================
// Procedural tile sprites — each material gets visual identity via its palette.
// Sprites are painted once per tile id and cached. No image assets.
// Per-tile-position variants come from a deterministic hash so repeated tiles
// don't look stamped, while staying fully cached per (id, variant).
// ============================================================================

import { TILE, TILE_DEFS } from '../data/tiles.js';
import { TILE_PX } from '../player/player.js';

const SPRITE_CACHE = 8; // variants per tile id
const cache = new Map(); // "id:v" -> canvas

// deterministic hash -> [0,1)
function dhash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974711) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// variant index for a world position (0..7)
function variantFor(tx, ty) {
  return Math.floor(dhash(tx, ty, 7) * SPRITE_CACHE);
}

export function tileSprite(id, tx, ty) {
  const v = (tx !== undefined && ty !== undefined) ? variantFor(tx, ty) : 0;
  const key = id + ':' + v;
  let img = cache.get(key);
  if (!img) { img = paint(id, v); cache.set(key, img); }
  return img;
}

function paint(id, variant) {
  const def = TILE_DEFS[id];
  const c = document.createElement('canvas');
  c.width = TILE_PX; c.height = TILE_PX;
  const g = c.getContext('2d');
  const P = TILE_PX;
  const col = def?.colors || {};
  const rnd = dhash(variant, id, variant * 13); // per-variant deterministic jitter

  switch (id) {
    case TILE.DIRT:
      fill(g, col.face, P);
      speckle(g, col.faceDark, 8, P);
      speckle(g, col.speck, 5, P);
      // small pebbles
      g.fillStyle = col.speck;
      for (let i = 0; i < 2; i++) g.fillRect(Math.floor(rnd * 20 + 4), Math.floor(rnd * 22 + 4), 3, 2);
      break;

    case TILE.SAND:
      fill(g, col.face, P);
      speckle(g, col.faceDark, 10, P);
      speckle(g, col.speck, 5, P);
      break;

    case TILE.GRASS:
    case TILE.MAGICAL_GRASS: {
      fill(g, col.face, P);
      speckle(g, col.faceDark, 7, P);
      // dirt base
      g.fillStyle = col.top;
      g.fillRect(0, 0, P, P * 0.3);
      // blades varied
      g.fillStyle = col.blade;
      const blades = variant % 2 === 0 ? 6 : 5;
      for (let i = 0; i < blades; i++) {
        const bx = 3 + i * (P / blades) + (i % 2) * 1.5;
        const bh = 3 + ((i * 3 + variant) % 3);
        g.fillRect(bx, P * 0.3 - bh, 2, bh);
      }
      // top highlight edge
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, 0, P, 2);
      break;
    }

    case TILE.STONE:
      fill(g, col.face, P);
      // mottled patches
      g.fillStyle = col.faceDark;
      for (let i = 0; i < 5; i++) {
        const px = rnd * P, py = (i * 0.17 + rnd * 0.1) * P;
        g.beginPath();
        g.arc(px, py, 3 + rnd * 3, 0, 7);
        g.fill();
      }
      // crack
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(P * 0.2 + rnd * 4, 0);
      g.lineTo(P * 0.4 + rnd * 4, P * 0.5);
      g.lineTo(P * 0.3 + rnd * 4, P);
      g.stroke();
      // top light
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, P, 3);
      break;

    case TILE.MAGICAL_SOIL:
      fill(g, col.face, P);
      speckle(g, col.faceDark, 8, P);
      // bioluminescent flecks
      for (let i = 0; i < 8; i++) {
        const fx = rnd * P, fy = (i * 0.125 + rnd * 0.1) * P;
        glowDot(g, fx, fy, 1.4, i % 2 ? col.speck : '#b0f4ff');
      }
      break;

    case TILE.ENCHANTED_WOOD:
    case TILE.ANCIENT_WOOD: {
      fill(g, col.face, P);
      // grain lines
      g.fillStyle = col.faceDark;
      for (let i = 0; i < 3; i++) {
        const gy = 6 + i * 11 + (variant % 2);
        g.fillRect(0, gy, P, 2 + (variant % 2));
      }
      // knot / magic ring
      g.strokeStyle = col.ring;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(P / 2, P / 2, P * 0.3, P * 0.3, 0, 0, 7);
      g.stroke();
      // bark edge shading
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, 0, 2, P);
      break;
    }

    case TILE.GLOW_CAP_BLOCK: {
      fill(g, col.face, P);
      // under-cap stem dark
      g.fillStyle = col.faceDark;
      g.fillRect(0, P * 0.78, P, P * 0.22);
      // gills
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let i = 3; i < P; i += 5) g.fillRect(i, P * 0.62, 2, P * 0.18);
      // glow spots
      for (let i = 0; i < 5; i++) {
        const sx = rnd * P, sy = rnd * P * 0.55;
        glowDot(g, sx, sy, 1.8 + rnd, i % 2 ? col.dot : col.dot2);
      }
      break;
    }

    case TILE.CRYSTAL: {
      // dark back, then faceted shards
      fill(g, col.faceDark, P);
      const cluster = 3 + (variant % 2);
      for (let i = 0; i < cluster; i++) {
        const ox2 = P * (0.2 + rnd * 0.6);
        const oy2 = P * (0.2 + ((i * 0.3 + rnd * 0.2) % 0.6));
        const h2 = P * (0.3 + rnd * 0.3);
        shard(g, ox2, oy2, h2, i % 2 ? col.face : col.faceDark, col.facet);
      }
      break;
    }

    case TILE.GLOW_FLOWER: {
      g.clearRect(0, 0, P, P);
      g.strokeStyle = col.stem; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(P / 2, P);
      g.quadraticCurveTo(P * (0.4 + rnd * 0.2), P * 0.5, P / 2, P * 0.32);
      g.stroke();
      // petals
      const cx = P / 2, cy = P * 0.3;
      const petals = variant % 2 ? 4 : 5;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * 6.283 + rnd;
        g.fillStyle = i % 2 ? col.petal : col.petal2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, 4, 4, 0, 0, 6.283);
        g.fill();
      }
      glowDot(g, cx, cy, 3, col.core);
      break;
    }

    case TILE.WOOD_WALL:
    case TILE.STONE_WALL: {
      fill(g, col.face, P);
      // brick pattern with offset courses
      const brick = id === TILE.WOOD_WALL ? 10 : 8;
      g.fillStyle = col.faceDark;
      for (let row = 0; row < 3; row++) {
        const gy = row * brick;
        const off = (row % 2) * (P / 2);
        g.fillRect(off, gy, P / 2, brick - 2);
        g.fillRect(off > 0 ? 0 : P / 2, gy, 3, brick - 2);
      }
      // mortar
      g.strokeStyle = col.seam;
      g.lineWidth = 1;
      for (let row = 0; row <= 3; row++) {
        g.beginPath();
        g.moveTo(0, row * brick);
        g.lineTo(P, row * brick);
        g.stroke();
      }
      break;
    }

    case TILE.LUMEN_BRICK: {
      fill(g, col.face, P);
      // courses
      g.strokeStyle = col.faceDark; g.lineWidth = 1.5;
      g.strokeRect(1, 1, P - 2, P / 2 - 2);
      g.strokeRect(1, P / 2, P - 2, P / 2 - 1);
      // glowing rune
      g.strokeStyle = col.seam; g.lineWidth = 1.5;
      g.strokeRect(P * 0.3, P * 0.32, P * 0.4, P * 0.4);
      glowDot(g, P / 2, P / 2, 1.6, col.rune);
      break;
    }

    case TILE.GLASS: {
      g.clearRect(0, 0, P, P);
      g.fillStyle = col.face;
      g.fillRect(0, 0, P, P);
      g.strokeStyle = col.edge; g.lineWidth = 2;
      g.strokeRect(1, 1, P - 2, P - 2);
      // diagonal reflection
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(6, P - 6);
      g.lineTo(P - 6, 6);
      g.stroke();
      break;
    }

    case TILE.LEAVES: {
      g.clearRect(0, 0, P, P);
      // cluster of leaves
      for (let i = 0; i < 4; i++) {
        const lx = P * (0.2 + rnd * 0.6);
        const ly = P * (0.2 + ((i * 0.3 + rnd * 0.2) % 0.6));
        g.fillStyle = i % 2 ? col.face : col.faceDark;
        g.beginPath();
        g.ellipse(lx, ly, 7, 5, rnd * 3.14, 0, 6.283);
        g.fill();
      }
      // glow dots
      for (let i = 0; i < 2; i++) {
        glowDot(g, P * (0.3 + rnd * 0.4), P * (0.3 + rnd * 0.4), 1.2, col.glowDot);
      }
      break;
    }

    case TILE.MUSHROOM_STEM: {
      g.clearRect(0, 0, P, P);
      g.fillStyle = col.face;
      // stem with taper
      g.beginPath();
      g.moveTo(P * 0.3, 0);
      g.lineTo(P * 0.4, 0);
      g.lineTo(P * 0.42, P);
      g.lineTo(P * 0.28, P);
      g.closePath();
      g.fill();
      // stripe
      g.fillStyle = col.stripe;
      g.fillRect(P * 0.38, 0, 2, P);
      break;
    }

    case TILE.WATER: {
      g.clearRect(0, 0, P, P);
      g.fillStyle = col.face;
      g.fillRect(0, 0, P, P);
      g.fillStyle = col.top;
      g.fillRect(0, 0, P, 4);
      // wave glint
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(0, variant % 2 ? 2 : 5, P, 1);
      break;
    }

    default:
      fill(g, '#ff00ff', P);
  }
  return c;
}

// --- paint helpers ---
function fill(g, color, P) { g.fillStyle = color; g.fillRect(0, 0, P, P); }

function speckle(g, color, n, P) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.fillRect(Math.random() * P, Math.random() * P, 2, 2);
  }
}

function glowDot(g, x, y, r, color) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r * 3);
  grd.addColorStop(0, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(x, y, r * 3, 0, 6.283); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
}

function shard(g, cx, cy, h, base, light) {
  const w = h * 0.4;
  g.fillStyle = base;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + w, cy + h * 0.5);
  g.lineTo(cx + w * 0.5, cy + h * 2);
  g.lineTo(cx - w * 0.5, cy + h * 2);
  g.lineTo(cx - w, cy + h * 0.5);
  g.closePath();
  g.fill();
  g.fillStyle = light;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + w * 0.4, cy + h * 0.5);
  g.lineTo(cx, cy + h * 1.6);
  g.lineTo(cx - w * 0.4, cy + h * 0.5);
  g.closePath();
  g.fill();
}
