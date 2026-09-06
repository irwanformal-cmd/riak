// ============================================================================
// World renderer — performance-first architecture:
//   1. Static layer canvas (offscreen) — rebuilt only on world edits
//   2. Sky + stars + moon (lightweight per-frame, cached gradients)
//   3. Player (procedural character with animation)
//   4. Deco layer (flowers, leaves, stems — in front of player)
//   5. Glow pass (additive, limited to visible emissive tiles)
//   6. Particles (pooled, bounded)
//   7. Hover highlight + break progress
// ============================================================================

import { TILE, tileDef, isSolid, renderLayer } from '../data/tiles.js';
import { TILE_PX } from '../player/player.js';
import { ANIM } from '../player/player.js';
import { tileSprite } from './sprites.js';

// --- particle pool ---
const MAX_PARTICLES = 80;
const particles = [];
for (let i = 0; i < MAX_PARTICLES; i++) {
  particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, r: 1, color: '#fff', active: false });
}
let particleCount = 0;

function spawnParticle(x, y, vx, vy, life, r, color) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (!p.active) {
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.maxLife = life; p.r = r; p.color = color;
      p.active = true;
      return;
    }
  }
}

function spawnDebris(tx, ty, tileId, count = 6) {
  const def = tileDef(tileId);
  const col = def?.colors || {};
  const c1 = col.face || col.dot || '#888';
  const c2 = col.top || col.speck || col.ring || c1;
  const cx = (tx + 0.5) * TILE_PX, cy = (ty + 0.5) * TILE_PX;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const spd = 40 + Math.random() * 80;
    spawnParticle(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd - 30,
      0.3 + Math.random() * 0.4, 2 + Math.random() * 2,
      Math.random() < 0.5 ? c1 : c2);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.time = 0;

    // static world layer (rebuilt on edits only)
    this._staticCanvas = null;
    this._staticDirty = true;

    // cached sky gradients
    this._skyGradient = null;
    this._moonGradient = null;
    this._lastCanvasW = 0;
    this._lastCanvasH = 0;

    // stars (pooled, no alloc per frame)
    this.stars = new Array(120);
    for (let i = 0; i < 120; i++) {
      this.stars[i] = { x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.2 + 0.3, tw: Math.random() * 6.28 };
    }

    // spore particles (screen-space)
    this.spores = new Array(35);
    for (let i = 0; i < 35; i++) {
      this.spores[i] = { x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.003, vy: -Math.random() * 0.005 - 0.002, r: Math.random() * 1.8 + 0.6, hue: Math.random() < 0.5 ? 168 : 270, ph: Math.random() * 6.28 };
    }

    // cloud layer (lightweight)
    this.clouds = new Array(8);
    for (let i = 0; i < 8; i++) {
      this.clouds[i] = { x: Math.random() * 2 - 0.5, y: Math.random() * 0.2 + 0.05, w: 0.08 + Math.random() * 0.12, h: 0.015 + Math.random() * 0.01, spd: 0.002 + Math.random() * 0.003 };
    }

    this.addBreakEvent = this.addBreakEvent.bind(this);
  }

  addBreakEvent(type, tx, ty, tileId) {
    if (type === 'break') spawnDebris(tx, ty, tileId, 8);
  }

  invalidateStatic() { this._staticDirty = true; }

  resize() {
    const dpr = devicePixelRatio;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this._lastCanvasW = this.canvas.width;
    this._lastCanvasH = this.canvas.height;
    this._skyGradient = null;  // invalidate cached gradients
    this._moonGradient = null;
    this._staticDirty = true;
  }

  // --- build the static world layer (only when edits happen) ---
  _buildStatic(world, cam) {
    const dpr = devicePixelRatio;
    const vw = Math.ceil(cam.viewW) + 3;
    const vh = Math.ceil(cam.viewH) + 3;
    const pw = vw * TILE_PX;
    const ph = vh * TILE_PX;

    if (!this._staticCanvas || this._staticCanvas.width < pw * dpr || this._staticCanvas.height < ph * dpr) {
      this._staticCanvas = document.createElement('canvas');
    }
    const sc = this._staticCanvas;
    sc.width = pw * dpr;
    sc.height = ph * dpr;
    const sg = sc.getContext('2d');
    sg.scale(dpr, dpr);

    const ox = Math.floor(cam.x) - 1;
    const oy = Math.floor(cam.y) - 1;

    // Pass 1: background walls
    for (let y = oy; y <= oy + vh; y++) {
      for (let x = ox; x <= ox + vw; x++) {
        if (!world.inBounds(x, y)) continue;
        const id = world.get(x, y);
        if (renderLayer(id) !== 'bg') continue;
        sg.globalAlpha = 0.5;
        sg.drawImage(tileSprite(id, x, y), (x - ox) * TILE_PX, (y - oy) * TILE_PX, TILE_PX, TILE_PX);
      }
    }
    sg.globalAlpha = 1;

    // Pass 2: foreground solids
    for (let y = oy; y <= oy + vh; y++) {
      for (let x = ox; x <= ox + vw; x++) {
        if (!world.inBounds(x, y)) continue;
        const id = world.get(x, y);
        if (id === TILE.AIR || renderLayer(id) === 'bg' || renderLayer(id) === 'deco' || renderLayer(id) === 'liquid') continue;
        const sx = (x - ox) * TILE_PX, sy = (y - oy) * TILE_PX;
        sg.drawImage(tileSprite(id, x, y), sx, sy, TILE_PX, TILE_PX);
        // AO: darken if solid above + both sides
        if (isSolid(id) && world.solid(x, y - 1) && world.solid(x - 1, y) && world.solid(x + 1, y)) {
          sg.fillStyle = 'rgba(8,4,24,0.3)';
          sg.fillRect(sx, sy, TILE_PX, TILE_PX);
        }
      }
    }

    // Pass 3: deco layer
    for (let y = oy; y <= oy + vh; y++) {
      for (let x = ox; x <= ox + vw; x++) {
        if (!world.inBounds(x, y)) continue;
        const id = world.get(x, y);
        if (renderLayer(id) !== 'deco') continue;
        sg.drawImage(tileSprite(id, x, y), (x - ox) * TILE_PX, (y - oy) * TILE_PX, TILE_PX, TILE_PX);
      }
    }

    this._staticDirty = false;
  }

  render(dt, world, player, cam, hover) {
    const ctx = this.ctx;
    this.time += dt;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = devicePixelRatio;

    // --- sky (cached gradient) ---
    if (!this._skyGradient || W !== this._lastCanvasW || H !== this._lastCanvasH) {
      this._skyGradient = ctx.createLinearGradient(0, 0, 0, H);
      this._skyGradient.addColorStop(0, '#070318');
      this._skyGradient.addColorStop(0.3, '#0e0828');
      this._skyGradient.addColorStop(0.6, '#1a0f3a');
      this._skyGradient.addColorStop(1, '#1f1240');
    }
    ctx.fillStyle = this._skyGradient;
    ctx.fillRect(0, 0, W, H);

    // distant haze band
    const hazeY = H * 0.35;
    const haze = ctx.createLinearGradient(0, hazeY - 30 * dpr, 0, hazeY + 60 * dpr);
    haze.addColorStop(0, 'rgba(40,30,80,0)');
    haze.addColorStop(0.5, 'rgba(40,30,80,0.12)');
    haze.addColorStop(1, 'rgba(40,30,80,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, hazeY - 30 * dpr, W, 90 * dpr);

    // clouds
    for (const cl of this.clouds) {
      cl.x += cl.spd * dt * 0.3;
      if (cl.x > 1.3) cl.x = -0.2;
      const cx = cl.x * W, cy = cl.y * H;
      const cw = cl.w * W, ch = cl.h * H;
      ctx.fillStyle = 'rgba(35,25,65,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // stars (parallax 0.15, cached rgba baked into alpha)
    for (let i = 0; i < 120; i++) {
      const s = this.stars[i];
      const sx = (s.x * W - cam.x * TILE_PX * dpr * 0.15) % W;
      const x = sx < 0 ? sx + W : sx;
      const tw = 0.5 + 0.5 * Math.sin(this.time * 1.5 + s.tw);
      ctx.fillStyle = `rgba(200,210,240,${(0.25 + 0.2 * tw).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, s.y * H, s.r * dpr, 0, 6.283);
      ctx.fill();
    }

    // moon
    if (!this._moonGradient || W !== this._lastCanvasW) {
      const mx = W * 0.8, my = H * 0.14;
      const moonR = 55 * dpr;
      this._moonGradient = ctx.createRadialGradient(mx, my, 0, mx, my, moonR);
      this._moonGradient.addColorStop(0, 'rgba(200,215,255,0.85)');
      this._moonGradient.addColorStop(0.25, 'rgba(170,190,255,0.3)');
      this._moonGradient.addColorStop(0.7, 'rgba(140,160,220,0.06)');
      this._moonGradient.addColorStop(1, 'rgba(140,160,220,0)');
    }
    ctx.fillStyle = this._moonGradient;
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.14, 55 * dpr, 0, 6.283);
    ctx.fill();

    // --- distant forest silhouette (parallax 0.3) ---
    this._drawSilhouette(ctx, cam, W, H, dpr, 0.3, 0.62, 'rgba(20,14,42,0.5)');
    this._drawSilhouette(ctx, cam, W, H, dpr, 0.55, 0.75, 'rgba(14,10,32,0.7)');

    // --- world-space rendering ---
    ctx.save();
    ctx.scale(dpr, dpr);

    const camX = cam.x * TILE_PX, camY = cam.y * TILE_PX;

    // build or rebuild static layer (on edit, or when camera leaves the
    // previously cached region).
    const needResize = !this._staticCanvas ||
      this._staticCanvas.width < (Math.ceil(cam.viewW) + 4) * TILE_PX * dpr ||
      this._staticCanvas.height < (Math.ceil(cam.viewH) + 4) * TILE_PX * dpr;
    const camMoved = this._staticOx !== undefined &&
      (this._staticOx !== Math.floor(cam.x) || this._staticOy !== Math.floor(cam.y));
    if (this._staticDirty || needResize || camMoved) {
      this._buildStatic(world, cam);
      this._staticOx = Math.floor(cam.x);
      this._staticOy = Math.floor(cam.y);
    }

    // draw static layer (bg + fg + deco)
    if (this._staticCanvas) {
      ctx.drawImage(this._staticCanvas, 0, 0,
        this._staticCanvas.width, this._staticCanvas.height,
        Math.floor(cam.x - 1) * TILE_PX, Math.floor(cam.y - 1) * TILE_PX,
        this._staticCanvas.width / dpr, this._staticCanvas.height / dpr);
    }

    // glow pass (only visible emissive tiles, additive)
    const x0 = Math.max(0, Math.floor(cam.x) - 1);
    const y0 = Math.max(0, Math.floor(cam.y) - 1);
    const x1 = Math.min(world.w - 1, Math.ceil(cam.x + cam.viewW) + 1);
    const y1 = Math.min(world.h - 1, Math.ceil(cam.y + cam.viewH) + 1);

    ctx.globalCompositeOperation = 'lighter';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = world.get(x, y);
        if (id === TILE.AIR) continue;
        const def = tileDef(id);
        if (!def.glow) continue;
        const pulse = 0.75 + 0.25 * Math.sin(this.time * 1.8 + x * 0.7 + y * 1.3);
        const a = def.glow * 0.35 * pulse;
        const cx = (x + 0.5) * TILE_PX, cy = (y + 0.5) * TILE_PX;
        const r = TILE_PX * (0.8 + def.glow * 0.8);
        const col = glowRGBA(id, a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- player ---
    this._drawPlayer(ctx, player);

    // --- hover highlight + break progress ---
    if (hover && hover.valid) {
      const hx = hover.tx * TILE_PX, hy = hover.ty * TILE_PX;
      if (hover.mode === 'break') {
        ctx.strokeStyle = 'rgba(255,220,140,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx + 1, hy + 1, TILE_PX - 2, TILE_PX - 2);
        if (hover.progress > 0) {
          // crack overlay — progressive darkening
          const cracks = Math.floor(hover.progress * 4);
          ctx.fillStyle = `rgba(40,20,10,${(hover.progress * 0.35).toFixed(2)})`;
          ctx.fillRect(hx, hy, TILE_PX, TILE_PX);
          ctx.strokeStyle = 'rgba(255,200,120,0.6)';
          ctx.lineWidth = 1;
          for (let i = 0; i < cracks; i++) {
            const cx2 = hx + TILE_PX * (0.2 + 0.6 * ((i * 0.31) % 1));
            const cy2 = hy + TILE_PX * (0.15 + 0.7 * ((i * 0.47) % 1));
            ctx.beginPath();
            ctx.moveTo(cx2, cy2);
            ctx.lineTo(cx2 + (i % 2 ? 6 : -6), cy2 + 8);
            ctx.lineTo(cx2 + (i % 2 ? -3 : 5), cy2 + 14);
            ctx.stroke();
          }
        }
      } else {
        // place preview
        ctx.strokeStyle = 'rgba(140,255,220,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx + 1, hy + 1, TILE_PX - 2, TILE_PX - 2);
      }
    }

    // --- world-space particles (debris) ---
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      if (!p.active) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 120 * dt; // gravity on debris
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const alpha = Math.min(1, p.life / p.maxLife * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1;

    ctx.restore(); // back to screen-space

    // --- floating spores (screen space, lightweight) ---
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 35; i++) {
      const s = this.spores[i];
      s.x += s.vx * dt * 60;
      s.y += s.vy * dt * 60;
      if (s.y < -0.05 || s.x < -0.05 || s.x > 1.05) {
        s.y = 1.05; s.x = Math.random();
      }
      const a = 0.18 + 0.15 * Math.sin(this.time * 2.5 + s.ph);
      ctx.fillStyle = `hsla(${s.hue},85%,72%,${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r * dpr, 0, 6.283);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- subtle vignette for atmosphere (cached gradient) ---
    if (!this._vigGradient || W !== this._lastCanvasW || H !== this._lastCanvasH) {
      this._vigGradient = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.75);
      this._vigGradient.addColorStop(0, 'rgba(0,0,0,0)');
      this._vigGradient.addColorStop(1, 'rgba(5,2,16,0.45)');
    }
    ctx.fillStyle = this._vigGradient;
    ctx.fillRect(0, 0, W, H);
  }

  // Distant forest silhouette — a row of rounded tree shapes scrolling slower
  // than the camera (parallax depth). Fully procedural, cached per call.
  _drawSilhouette(ctx, cam, W, H, dpr, parallax, baseY, fill) {
    const step = 48 * dpr;
    const scroll = (-cam.x * TILE_PX * parallax);
    // number of trees to cover the screen
    const count = Math.ceil(W / step) + 1;
    ctx.fillStyle = fill;
    const yBase = H * baseY;
    for (let i = -1; i < count; i++) {
      const x = i * step + (scroll % step);
      // deterministic height variation by index
      const h = H * (0.10 + 0.12 * ((i * 7) % 5) / 5);
      // trunk
      ctx.fillRect(x + step * 0.42, yBase - h * 0.4, step * 0.16, h * 0.4);
      // canopy (overlapping circles)
      ctx.beginPath();
      ctx.arc(x + step * 0.3, yBase - h * 0.45, h * 0.5, 0, 6.283);
      ctx.arc(x + step * 0.55, yBase - h * 0.6, h * 0.62, 0, 6.283);
      ctx.arc(x + step * 0.75, yBase - h * 0.45, h * 0.5, 0, 6.283);
      ctx.fill();
    }
  }

  _drawPlayer(ctx, p) {
    const P = TILE_PX;
    const cx = p.x * P, cy = p.y * P;
    const w = p.w * P, h = p.h * P;
    const bx = cx - w / 2;

    // --- animation values ---
    let legL = 0, legR = 0, armL = 0, armR = 0, bodyY = 0, bodyTilt = 0;
    const t = p.animTime;

    switch (p.anim) {
      case ANIM.WALK: {
        const spd = Math.min(Math.abs(p.vx) / 5, 1);
        const cycle = p.walkPhase * 5;
        legL = Math.sin(cycle) * 4 * spd;
        legR = Math.sin(cycle + Math.PI) * 4 * spd;
        armL = Math.sin(cycle + Math.PI) * 3 * spd;
        armR = Math.sin(cycle) * 3 * spd;
        bodyY = Math.abs(Math.sin(cycle * 2)) * 1.5;
        break;
      }
      case ANIM.JUMP: {
        bodyY = -2;
        armL = -3; armR = -3;
        legL = 2; legR = -1;
        break;
      }
      case ANIM.FALL: {
        bodyY = 1;
        armL = 4; armR = 4;
        legL = 1; legR = 2;
        break;
      }
      case ANIM.BREAK: {
        const bp = p.breakPhase;
        armR = Math.sin(bp) * 6;
        bodyTilt = Math.sin(bp) * 0.05;
        break;
      }
      case ANIM.IDLE:
      default: {
        bodyY = Math.sin(t * 1.5) * 0.8; // breathing
        break;
      }
    }

    ctx.save();
    ctx.translate(cx, cy + bodyY);
    ctx.rotate(bodyTilt);

    // --- soft glow aura ---
    const aura = ctx.createRadialGradient(0, -h / 2, 0, 0, -h / 2, h * 0.8);
    aura.addColorStop(0, 'rgba(130,210,240,0.14)');
    aura.addColorStop(1, 'rgba(130,210,240,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -h / 2, h * 0.8, 0, 6.283);
    ctx.fill();

    // shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- legs ---
    ctx.fillStyle = '#2a1e50';
    const legW = w * 0.22, legH = h * 0.35;
    const legY = -legH;
    ctx.fillRect(-w * 0.2 - legW / 2, legY + legL, legW, legH);
    ctx.fillRect(w * 0.2 - legW / 2, legY + legR, legW, legH);
    // boot trim
    ctx.fillStyle = '#5fd4c8';
    ctx.fillRect(-w * 0.2 - legW / 2, legY + legL + legH - 2, legW, 2);
    ctx.fillRect(w * 0.2 - legW / 2, legY + legR + legH - 2, legW, 2);

    // --- body (tunic/cloak) ---
    const bodyTop = -h * 0.65;
    const bodyH = h * 0.38;
    ctx.fillStyle = '#3a2a6e';
    roundRect(ctx, -w / 2, bodyTop, w, bodyH, 3);
    // tunic trim line
    ctx.fillStyle = '#5fd4c8';
    ctx.fillRect(-w / 2 + 1, bodyTop + bodyH - 3, w - 2, 2);
    // belt
    ctx.fillStyle = '#8a7ab0';
    ctx.fillRect(-w / 2 + 1, bodyTop + bodyH * 0.55, w - 2, 2);

    // --- arms ---
    ctx.fillStyle = '#3a2a6e';
    const armW = 3, armH = h * 0.28;
    ctx.fillRect(-w / 2 - armW + 1, bodyTop + 4 + armL, armW, armH);
    ctx.fillRect(w / 2 - 1, bodyTop + 4 + armR, armW, armH);
    // hands
    ctx.fillStyle = '#d8c8b8';
    ctx.fillRect(-w / 2 - armW + 1, bodyTop + 4 + armL + armH - 2, armW, 3);
    ctx.fillRect(w / 2 - 1, bodyTop + 4 + armR + armH - 2, armW, 3);

    // --- head ---
    const headR = w * 0.42;
    const headY = bodyTop - headR * 0.5;
    // face
    ctx.fillStyle = '#e8d8c8';
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, 6.283);
    ctx.fill();

    // hair (dark strands on top)
    ctx.fillStyle = '#2a1a4a';
    ctx.beginPath();
    ctx.arc(0, headY - 1, headR * 1.05, Math.PI * 1.1, Math.PI * 1.9);
    ctx.fill();
    // side hair tufts
    ctx.fillRect(-headR - 1, headY - 2, 3, headR * 0.7);
    ctx.fillRect(headR - 2, headY - 2, 3, headR * 0.7);

    // --- hood/cloak collar ---
    ctx.fillStyle = '#4a3a8e';
    ctx.beginPath();
    ctx.arc(0, headY - 1, headR * 1.08, Math.PI * 0.85, Math.PI * 2.15);
    ctx.lineTo(headR * 1.05, bodyTop + 3);
    ctx.lineTo(-headR * 1.05, bodyTop + 3);
    ctx.closePath();
    ctx.fill();

    // --- face ---
    const eyeY = headY + 1;
    const eyeSpacing = headR * 0.38;
    const eyeOff = p.facing * 1.5;

    // eyes (expression-driven)
    switch (p.expr) {
      case 'happy': {
        // curved happy eyes (arcs)
        ctx.strokeStyle = '#8af4ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(-eyeSpacing + eyeOff, eyeY, 2, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(eyeSpacing + eyeOff, eyeY, 2, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        // small smile
        ctx.strokeStyle = '#c8a898';
        ctx.beginPath();
        ctx.arc(eyeOff, headY + headR * 0.4, 2.5, 0.1, Math.PI - 0.1);
        ctx.stroke();
        break;
      }
      case 'hurt': {
        // squeezed eyes
        ctx.strokeStyle = '#8af4ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-eyeSpacing + eyeOff - 2, eyeY - 1);
        ctx.lineTo(-eyeSpacing + eyeOff + 2, eyeY + 1);
        ctx.moveTo(-eyeSpacing + eyeOff + 2, eyeY - 1);
        ctx.lineTo(-eyeSpacing + eyeOff - 2, eyeY + 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(eyeSpacing + eyeOff - 2, eyeY - 1);
        ctx.lineTo(eyeSpacing + eyeOff + 2, eyeY + 1);
        ctx.moveTo(eyeSpacing + eyeOff + 2, eyeY - 1);
        ctx.lineTo(eyeSpacing + eyeOff - 2, eyeY + 1);
        ctx.stroke();
        break;
      }
      case 'surprised': {
        // big round eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + eyeOff, eyeY, 2.8, 0, 6.283);
        ctx.arc(eyeSpacing + eyeOff, eyeY, 2.8, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = '#8af4ff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + eyeOff, eyeY, 1.8, 0, 6.283);
        ctx.arc(eyeSpacing + eyeOff, eyeY, 1.8, 0, 6.283);
        ctx.fill();
        break;
      }
      case 'sleepy': {
        // half-closed eyes
        ctx.fillStyle = '#8af4ff';
        ctx.fillRect(-eyeSpacing + eyeOff - 2, eyeY - 0.5, 4, 1.2);
        ctx.fillRect(eyeSpacing + eyeOff - 2, eyeY - 0.5, 4, 1.2);
        break;
      }
      default: { // neutral
        ctx.fillStyle = '#8af4ff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + eyeOff, eyeY, 1.6, 0, 6.283);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(eyeSpacing + eyeOff, eyeY, 1.6, 0, 6.283);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }
}

function glowRGBA(id, a) {
  const c = glowRGB(id);
  return `rgba(${c},${a.toFixed(2)})`;
}
function glowRGB(id) {
  switch (id) {
    case TILE.CRYSTAL: return '90,230,240';
    case TILE.GLOW_CAP_BLOCK: return '160,110,255';
    case TILE.GLOW_FLOWER: return '255,170,255';
    case TILE.MAGICAL_SOIL: case TILE.MAGICAL_GRASS: return '150,110,230';
    case TILE.LUMEN_BRICK: return '120,220,255';
    case TILE.ANCIENT_WOOD: return '110,220,210';
    case TILE.LEAVES: return '90,220,190';
    default: return '160,180,255';
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
