/* Interactive causal-web graph · organic, living, force-directed.
 *
 * Each node is an EVENT / CONSEQUENCE (a proposition), each edge is a causal
 * link ("A causes B"). The web is laid out by a spring/repulsion physics that
 * settles into natural, organic clusters · branches fan out, hubs sit prominent,
 * and curved edges make it feel alive like a living map of consequences (never
 * a rigid flowchart or tree).
 *
 * Features: organic force-directed layout that *settles* (no perpetual drift),
 * animation while the web grows, curved edges, prominence for important nodes,
 * pan (drag background), zoom (wheel), drag & pin nodes, click-to-select,
 * double-click to chat with a node, a connect mode for linking two nodes, and
 * a selected-node info card.
 */

const NET_PAL = window.PALETTE || {};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const _LBL = () => window.NETWORK_LABELS || {};
function _typeLabel(n) {
  const L = _LBL();
  if (n.type === "root") return L.start || "start";
  if (n.type === "intervention") return L.intervention || "intervention";
  return L.consequence || "consequence";
}
function _polLabel(pol) {
  const L = _LBL();
  return pol === "pos" ? (L.pos || "positive") : pol === "neg" ? (L.neg || "negative") : (L.neutral || "neutral");
}

// Force-directed physics. Tuned for "structured chaos": local clusters settle
// without flying apart or collapsing into a hairball. Repulsion is computed
// through a spatial hash (O(N·k)) so very large webs stay interactive, and
// spacing is generous so nodes keep clear of each other.
const PHYSICS = {
  repulsion: 6500,   // coulomb push between nodes
  spring: 0.015,     // edge pull toward rest length
  rest: 170,         // natural edge length
  gravity: 0,        // removed · symmetric springs + cutoff repulsion keep it centred
  damping: 0.86,     // velocity decay each step
  vmax: 44,          // velocity cap (stability)
  cell: 120,         // spatial-hash cell size ≈ repulsion cutoff
};
const SIM_FRAMES = 90;      // settle animation length on a full (re)build
const SIM_FRAMES_GROW = 55; // settle animation length when nodes are added
const STEPS_PER_FRAME = 2;

/* Cinematic pass — the "living graph" polish (glow, depth, ambient motion).
 * All knobs live here so the feel can be tuned in one place. Everything is
 * render-only: physics, hit-testing and interaction are untouched. */
const CINE = {
  breathe: 0.06,      // node radius oscillation (±4.5% — a heartbeat, not a bounce)
  glowDark: 0.30,      // halo alpha behind key nodes (dark mode)
  glowLight: 0.055,    // halo alpha (light mode — paper barely glows)
  depthSize: 0.14,     // how much pseudo-depth scales node size (±14%)
  depthAlpha: 0.22,    // how much far nodes fade
  driftX: 13, driftY: 9,// idle camera sway amplitude (px)
  idleAfterMs: 3500,   // sway starts after this much stillness
  dust: 42,            // ambient particles (dark mode only)
  pulses: 12,          // max light pulses travelling along edges
  pulseSpeed: 0.22,    // edge pulses per second
};

// deterministic per-node hash → [0,1) — stable phase/depth across frames
function _hash01(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) | 0; }
  return ((h >>> 0) % 100000) / 100000;
}
function _palIsDark() {
  const hex = (NET_PAL.bg || "#FFFFFF").replace("#", "");
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

class NetworkRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.byId = {};
    this.adj = {};          // id -> Set(neighbour ids)
    this.camera = { scale: 1, tx: 0, ty: 0 };
    this.selected = null;
    this._path = null;      // {nodes:Set, edges:Set("s|t")} · selected node's root path
    this.hovered = null;
    this.drag = null;       // {type:'node'|'pan', node?, startX, startY, moved}
    this.onSelect = null;
    this.onOpen = null;
    this.onHover = null;
    this.onConnect = null;  // (sourceId, targetId) when connect mode links two nodes
    this.connectMode = false;
    this.connectSource = null;
    this._relax = 0;        // frames of physics left to run

    // cinematic state
    this._t = 0;            // ambient clock (seconds)
    this._driftX = 0; this._driftY = 0;   // idle camera sway (eased)
    this._lastInteract = performance.now();
    this._dust = [];        // ambient particles (deterministic, dark mode)
    let s0 = 42;            // tiny LCG — stable starfield, no Math.random flicker
    for (let i = 0; i < CINE.dust; i++) {
      s0 = (s0 * 1664525 + 1013904223) >>> 0;
      this._dust.push({ x: (s0 % 1000) / 1000, y: ((s0 >>> 10) % 1000) / 1000,
                        r: 1.0 + ((s0 >>> 20) % 100) / 60, ph: ((s0 >>> 8) % 628) / 100 });
    }
    // any gesture pauses the sway immediately
    const touch = () => { this._lastInteract = performance.now(); };
    canvas.addEventListener("pointerdown", touch, { passive: true });
    canvas.addEventListener("wheel", touch, { passive: true });
    canvas.addEventListener("pointermove", touch, { passive: true });

    this._bind();
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  /* ---------------------------------------------------------------- setup */
  setWeb(web) {
    // Preserve existing node positions so growth is incremental, not a teleport.
    const prevPos = {};
    this.nodes.forEach((n) => { prevPos[n.id] = { x: n.x, y: n.y, pinned: n.pinned }; });
    const hadNodes = this.nodes.length > 0;

    this.nodes = (web.nodes || []).map((n) => {
      // stable cinematic attributes: pseudo-depth + breath phase from the id
      const hh = _hash01(n.id);
      const z = hh * 2 - 1, phase = hh * Math.PI * 2;
      const p = prevPos[n.id];
      if (p) return {
        id: n.id, text: n.text || "", type: n.type || "consequence", level: n.level || 0,
        polarity: n.polarity || 0, probability: n.probability || 0,
        x: p.x, y: p.y, vx: 0, vy: 0, pinned: p.pinned, fresh: false, z, _phase: phase,
      };
      return {
        id: n.id, text: n.text || "", type: n.type || "consequence", level: n.level || 0,
        polarity: n.polarity || 0, probability: n.probability || 0,
        x: 0, y: 0, vx: 0, vy: 0, pinned: false, fresh: true, grow: 0, z, _phase: phase,
      };
    });

    this.byId = {};
    this.adj = {};
    const causes = {}, effects = {};
    this.nodes.forEach((n) => { this.byId[n.id] = n; this.adj[n.id] = new Set(); });
    this.edges = (web.edges || []).map((e) => ({
      source: e.source, target: e.target,
      relation: e.relation || "causes", weight: e.weight || 0.6,
    }));
    this.edges.forEach((e) => {
      if (this.adj[e.source]) this.adj[e.source].add(e.target);
      if (this.adj[e.target]) this.adj[e.target].add(e.source);
      (causes[e.target] = causes[e.target] || []).push(e.source);
      (effects[e.source] = effects[e.source] || []).push(e.target);
    });
    this.nodes.forEach((n) => {
      n.connections = (this.adj[n.id] || new Set()).size;
      n.causes = (causes[n.id] || []).map((id) => this.byId[id] && this.byId[id].text).filter(Boolean);
      n.effects = (effects[n.id] || []).map((id) => this.byId[id] && this.byId[id].text).filter(Boolean);
    });
    this._parentIds = causes;
    this._childIds = effects;

    if (this.selected && !this.byId[this.selected]) this.selected = null;
    if (this.connectSource && !this.byId[this.connectSource]) this.connectSource = null;
    // recompute the root path for the (possibly re-id'd) selection
    this._path = this.selected ? this._computePath(this.selected) : null;

    if (!hadNodes) {
      this._seedLayout();       // initial organic bloom
      this._fit();
      this._relax = SIM_FRAMES;
    } else {
      // place fresh nodes beside a parent, then animate them settling in
      this.nodes.forEach((n) => {
        if (!n.fresh) return;
        const ps = causes[n.id] || [];
        if (ps.length) {
          const p = this.byId[ps[0]];
          const ang = Math.random() * Math.PI * 2;
          n.x = p.x + Math.cos(ang) * 70;
          n.y = p.y + Math.sin(ang) * 70;
          n.vx = Math.cos(ang) * 9;
          n.vy = Math.sin(ang) * 9;
        } else {
          const ang = Math.random() * Math.PI * 2;
          n.x = Math.cos(ang) * 60;
          n.y = Math.sin(ang) * 60;
        }
      });
      this._relax = SIM_FRAMES_GROW;
    }
  }

  // Initial organic bloom: roots cluster near the centre, each cascade level
  // drifts outward from its parents with angular jitter · then physics does the
  // real shaping into natural branches and clusters.
  _seedLayout() {
    const byLevel = {};
    this.nodes.forEach((n) => { (byLevel[n.level] = byLevel[n.level] || []).push(n); });
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    const R = 170;
    const angle = {};
    const roots = byLevel[0] || [];
    roots.forEach((n, i) => {
      const a = (i / Math.max(roots.length, 1)) * Math.PI * 2 - Math.PI / 2;
      angle[n.id] = a;
      n.x = Math.cos(a) * 54 + (Math.random() - 0.5) * 40;
      n.y = Math.sin(a) * 54 + (Math.random() - 0.5) * 40;
    });
    levels.slice(1).forEach((level) => {
      (byLevel[level] || []).forEach((n) => {
        const ps = (this._parentIds[n.id] || []).filter((pid) => angle[pid] != null);
        let a;
        if (ps.length) {
          let sx = 0, sy = 0;
          ps.forEach((pid) => { sx += Math.cos(angle[pid]); sy += Math.sin(angle[pid]); });
          a = Math.atan2(sy, sx);
        } else {
          a = Math.random() * Math.PI * 2;
        }
        a += (Math.random() - 0.5) * 1.0;
        angle[n.id] = a;
        n.x = Math.cos(a) * level * R + (Math.random() - 0.5) * 56;
        n.y = Math.sin(a) * level * R + (Math.random() - 0.5) * 56;
      });
    });
  }

  _fit() {
    if (!this.nodes.length) return;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    this.nodes.forEach((n) => {
      if (n.x < mnX) mnX = n.x; if (n.x > mxX) mxX = n.x;
      if (n.y < mnY) mnY = n.y; if (n.y > mxY) mxY = n.y;
    });
    const w = this.canvas.clientWidth || this.canvas.width || 800;
    const h = this.canvas.clientHeight || this.canvas.height || 560;
    const span = Math.max(mxX - mnX, mxY - mnY, 1);
    this.camera.scale = Math.min((w - 90) / span, (h - 90) / span);
    this.camera.scale = Math.max(0.02, Math.min(3, this.camera.scale));
    this.camera.tx = 0;
    this.camera.ty = 0;
  }

  fitView() { this._fit(); }
  // Full re-layout for a brand-new/different web (fresh scenario, not an edit).
  resetWeb(web) {
    this.nodes = [];
    this.byId = {};
    this.adj = {};
    this.selected = null;
    this.connectSource = null;
    this.connectMode = false;
    this.setWeb(web);   // no prior nodes → full organic seed + settle
  }
  relayout() {
    this.nodes.forEach((n) => { n.pinned = false; n.vx = 0; n.vy = 0; n.fresh = false; n.grow = 1; });
    this._seedLayout();
    this._fit();
    this._relax = SIM_FRAMES;
  }

  setConnectMode(on) {
    this.connectMode = !!on;
    this.connectSource = null;
  }
  isConnectMode() { return this.connectMode; }

  /* ------------------------------------------------------------ transforms */
  _cx() { return (this.canvas.clientWidth || this.canvas.width) / 2; }
  _cy() { return (this.canvas.clientHeight || this.canvas.height) / 2; }
  // drift lives INSIDE the projection so hit-testing (_wx/_wy) stays consistent
  _sx(x) { return x * this.camera.scale + this._cx() + this.camera.tx + this._driftX; }
  _sy(y) { return y * this.camera.scale + this._cy() + this.camera.ty + this._driftY; }
  _wx(sx) { return (sx - this._cx() - this.camera.tx - this._driftX) / this.camera.scale; }
  _wy(sy) { return (sy - this._cy() - this.camera.ty - this._driftY) / this.camera.scale; }

  /* -------------------------------------------------------------- physics */
  _step() {
    const N = this.nodes;
    const P = PHYSICS;

    // repulsion through a uniform spatial hash · each node only interacts with
    // its near neighbours, so cost is O(N·k) instead of O(N²).
    const cell = P.cell;
    const grid = new Map();
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      const key = Math.floor(n.x / cell) + "," + Math.floor(n.y / cell);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      if (a.pinned) continue;
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(gx + "," + gy);
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (j <= i) continue;         // each unordered pair exactly once
            const b = N[j];
            if (b.pinned) continue;
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = ((i * 31 + j * 17) % 7) - 3; dy = ((i * 11 + j * 13) % 7) - 3; }
            const f = P.repulsion / Math.max(d2, 30);
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
          }
        }
      }
    }

    // springs along causal edges
    this.edges.forEach((e) => {
      const a = this.byId[e.source], b = this.byId[e.target];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = P.spring * (d - P.rest);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    });

    // damping + integrate
    N.forEach((n) => {
      if (n.pinned) { n.vx = 0; n.vy = 0; return; }
      n.vx *= P.damping;
      n.vy *= P.damping;
      const v = Math.hypot(n.vx, n.vy);
      if (v > P.vmax) { n.vx *= P.vmax / v; n.vy *= P.vmax / v; }
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  /* ---------------------------------------------------------------- drawing */
  _loop() {
    this._raf = requestAnimationFrame(this._loop.bind(this));
    this._t += 1 / 60;
    // idle sway: only when the user has been still for a while; eases in/out
    if (performance.now() - this._lastInteract > CINE.idleAfterMs && this.nodes.length) {
      const tx = Math.sin(this._t * 0.42) * CINE.driftX;
      const ty = Math.cos(this._t * 0.34) * CINE.driftY;
      this._driftX += (tx - this._driftX) * 0.02;
      this._driftY += (ty - this._driftY) * 0.02;
    } else {
      this._driftX *= 0.92;
      this._driftY *= 0.92;
    }
    if (this._relax > 0) {
      for (let k = 0; k < STEPS_PER_FRAME; k++) this._step();
      this._relax--;
    }
    // ease freshly-added nodes from a tiny dot to full size
    this.nodes.forEach((n) => {
      if (n.grow != null && n.grow < 1) n.grow = Math.min(1, n.grow + 0.07);
    });
    if (this.canvas.clientWidth > 0) this._draw();
  }

  _radius(n, scale) {
    const base = (n.type === "root" || n.type === "intervention") ? 6 : 3.6;
    const hub = Math.min(10, (n.connections || 0)) * 0.32;   // prominence by degree
    const prob = (n.probability || 0) * 12;                  // prominence by likelihood
    const grow = n.grow != null ? n.grow : 1;
    return Math.max(2.5, (base + prob + hub) * scale * grow);
  }

  _color(n) {
    if (n.type === "intervention") return NET_PAL.intervention || NET_PAL.accent2 || "#8A5BA0";
    if (n.type === "root") return NET_PAL.root || NET_PAL.accent || "#3B6EA5";
    if (n.polarity >= 0.25) return NET_PAL.pos || "#2E8B6E";
    if (n.polarity <= -0.25) return NET_PAL.neg || "#B4554D";
    return NET_PAL.neutral || "#8A9086";
  }

  _rgbOf(col) {
    const hex = (col || "#888888").replace("#", "");
    if (hex.length < 6) return [136, 136, 136];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  // trace a node's path with a shape that encodes its role
  _traceNode(ctx, x, y, r, n, topProb) {
    ctx.beginPath();
    if (n.type === "root") {
      // diamond · the starting seed
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (n.type === "intervention") {
      // triangle · a deliberate human push
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.75); ctx.lineTo(x - r * 0.9, y + r * 0.75); ctx.closePath();
    } else if (topProb.has(n.id)) {
      // hexagon · most-likely outcomes
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k - Math.PI / 6;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  // Walk a node's strongest incoming causal links back to a root, so the whole
  // "how did we get here" chain can be highlighted through a large web.
  _computePath(id) {
    const nodes = new Set(), edges = new Set();
    let cur = id;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      nodes.add(cur);
      const parents = this._parentIds[cur] || [];
      if (!parents.length) break;
      let best = null, bestW = -1;
      parents.forEach((pid) => {
        const e = this.edges.find((x) => x.source === pid && x.target === cur);
        const w = e ? e.weight : 0;
        if (w > bestW) { bestW = w; best = pid; }
      });
      if (!best) break;
      edges.add(best + "|" + cur);
      cur = best;
    }
    return { nodes, edges };
  }

  // deterministic perpendicular curve per edge (organic, never straight)
  _edgeCurve(s, t) {
    const str = s + "|" + t;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) | 0; }
    return (((h & 0xffff) / 0xffff) - 0.5) * 56;
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!this.nodes.length) return;

    const dark = _palIsDark();
    // ambient dust (dark sonar waters only) — slow drift, zero interactivity
    if (dark) {
      const acc = NET_PAL.accentRGB || [103, 232, 249];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";   // additive — particles EMIT light
      this._dust.forEach((d) => {
        const dy = (d.y * h + this._t * 3 + d.ph * 10) % h;   // slow rise + wrap
        const tw = 0.5 + 0.5 * Math.sin(this._t * 0.7 + d.ph); // gentle twinkle
        ctx.globalAlpha = 0.07 + 0.11 * tw;
        ctx.fillStyle = rgba(acc, 1);
        ctx.beginPath();
        ctx.arc(d.x * w, dy, d.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    const selectedSet = this.selected
      ? new Set([this.selected, ...(this.adj[this.selected] || []), ...(this._path ? this._path.nodes : [])])
      : null;
    const topProb = this._topProbable();

    // visible world rect (with a margin) · cull off-screen work so very large
    // webs stay smooth when panned/zoomed.
    const M = 60; // px margin
    const vx0 = this._wx(-M), vy0 = this._wy(-M);
    const vx1 = this._wx(w + M), vy1 = this._wy(h + M);
    const inView = (x, y) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;

    // edges (curved)
    this.edges.forEach((e) => {
      const a = this.byId[e.source], b = this.byId[e.target];
      if (!a || !b) return;
      if (!inView(a.x, a.y) && !inView(b.x, b.y) && !inView((a.x + b.x) / 2, (a.y + b.y) / 2)) return;
      const onPath = this._path && this._path.edges.has(e.source + "|" + e.target);
      const highlighted = !selectedSet || onPath || (selectedSet.has(a.id) || selectedSet.has(b.id));
      const inhibiting = e.relation === "prevents" || e.relation === "weakens";
      const rgb = onPath ? (NET_PAL.accentRGB || [62, 107, 79])
        : inhibiting ? (NET_PAL.negRGB || [180, 85, 77]) : (NET_PAL.edgeRGB || [134, 140, 130]);
      let alpha = onPath ? 0.9 : inhibiting ? 0.16 + e.weight * 0.30 : 0.14 + e.weight * 0.34;
      if (selectedSet && !highlighted) alpha *= 0.06;
      if (dark) alpha = Math.min(1, alpha * 1.9);   // dark mode: edges carry light
      const sx = this._sx(a.x), sy = this._sy(a.y);
      const ex = this._sx(b.x), ey = this._sy(b.y);
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      const dx = ex - sx, dy = ey - sy;
      const len = Math.hypot(dx, dy) || 1;
      const off = this._edgeCurve(e.source, e.target) * this.camera.scale;
      ctx.strokeStyle = rgba(rgb, alpha);
      ctx.lineWidth = onPath ? 2.4 : 1 + e.weight * 1.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx + (-dy / len) * off, my + (dx / len) * off, ex, ey);
      ctx.stroke();
    });

    // light pulses travelling along the strongest causal links — the web "breathes"
    // causality. Capped at CINE.pulses for perf; prefers the selected path.
    {
      const pool = this._path && this._path.edges.size
        ? this.edges.filter((e) => this._path.edges.has(e.source + "|" + e.target))
        : [...this.edges].sort((a, b) => b.weight - a.weight).slice(0, CINE.pulses);
      const acc = NET_PAL.accentRGB || [31, 59, 179];
      ctx.save();
      if (dark) ctx.globalCompositeOperation = "lighter";   // pulses emit light
      pool.slice(0, CINE.pulses).forEach((e) => {
        const a = this.byId[e.source], b = this.byId[e.target];
        if (!a || !b) return;
        if (!inView(a.x, a.y) && !inView(b.x, b.y)) return;
        const u = (this._t * CINE.pulseSpeed + _hash01(e.source + ">" + e.target)) % 1;
        const sx = this._sx(a.x), sy = this._sy(a.y);
        const ex = this._sx(b.x), ey = this._sy(b.y);
        const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1;
        const off = this._edgeCurve(e.source, e.target) * this.camera.scale;
        const cx2 = (sx + ex) / 2 + (-dy / len) * off, cy2 = (sy + ey) / 2 + (dx / len) * off;
        // quadratic bezier point at u
        const px = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx2 + u * u * ex;
        const py = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy2 + u * u * ey;
        const fade = Math.sin(u * Math.PI);   // fade in/out along the trip
        ctx.globalAlpha = 0.8 * fade;
        ctx.fillStyle = rgba(acc, 1);
        ctx.beginPath();
        ctx.arc(px, py, dark ? 3.0 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    // nodes
    const glowA = dark ? CINE.glowDark : CINE.glowLight;
    this.nodes.forEach((n) => {
      if (!inView(n.x, n.y)) return;
      const dim = selectedSet && !selectedSet.has(n.id);
      const x = this._sx(n.x), y = this._sy(n.y);
      // pseudo-depth: far nodes slightly smaller & dimmer; near nodes fuller
      const depthS = 1 + (n.z || 0) * CINE.depthSize;
      const depthF = 1 - CINE.depthAlpha * (1 - (n.z || 0)) / 2;
      // breath: a slow heartbeat so the web feels alive even when settled
      const breathe = 1 + CINE.breathe * Math.sin(this._t * 1.05 + (n._phase || 0));
      const r = this._radius(n, this.camera.scale) * depthS * breathe;
      const col = this._color(n);
      // halo: in dark mode EVERY node emits light (additive), key nodes brighter;
      // in light mode only key nodes get a faint halo
      const key = n.type === "root" || n.type === "intervention" || topProb.has(n.id) ||
                  this.selected === n.id || this.hovered === n.id;
      if ((dark || key) && !dim) {
        const strength = key ? glowA * 1.6 : glowA * 0.55;
        ctx.save();
        if (dark) ctx.globalCompositeOperation = "lighter";   // inverse: nodes are light sources
        const grad = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.9);
        grad.addColorStop(0, rgba(this._rgbOf(col), strength));
        grad.addColorStop(1, rgba(this._rgbOf(col), 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 3.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = (dim ? 0.12 : (this.selected === n.id ? 1 : 0.92)) * depthF;
      this._traceNode(ctx, x, y, r, n, topProb);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      // selection ring
      if (this.selected === n.id) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = NET_PAL.text || "#1F2320";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (topProb.has(n.id)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(NET_PAL.amberRGB || [154, 107, 58], .55);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // connect-source ring
      if (this.connectMode && this.connectSource === n.id) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = NET_PAL.pos || "#2E8B6E";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      // labels
      const showLabel = topProb.has(n.id) || n.type === "root" || n.type === "intervention" ||
        this.hovered === n.id || this.selected === n.id || this.camera.scale > 1.5 ||
        (this._path && this._path.nodes.has(n.id));
      if (showLabel && !dim) {
        ctx.fillStyle = NET_PAL.label || "#1F2320";
        ctx.font = "10px 'Space Grotesk', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(this._truncate(n.text, 22), x, y - r - 4);
      }
    });

    this._drawTooltip(w, h);
    if (this.selected) this._drawInfoCard(w, h);
    if (this.connectMode) this._drawConnectHud(w, h);
  }

  _drawConnectHud(w, h) {
    const ctx = this.ctx;
    const L = _LBL();
    const msg = this.connectSource
      ? (L.connectPick || "now click a second node")
      : (L.connectModeHint || "connect mode · click two nodes to link them");
    ctx.font = "12px Inter, system-ui, sans-serif";
    const bw = ctx.measureText(msg).width + 18;
    const bh = 28;
    ctx.fillStyle = NET_PAL.cardBg || "rgba(255,255,255,.97)";
    ctx.strokeStyle = NET_PAL.pos || "#2E8B6E";
    ctx.beginPath(); ctx.roundRect(12, 12, bw, bh, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NET_PAL.text || "#1F2320";
    ctx.textAlign = "left";
    ctx.fillText(msg, 21, 30);
  }

  _topProbable() {
    const sorted = [...this.nodes].sort((a, b) => (b.probability || 0) - (a.probability || 0)).slice(0, 6);
    return new Set(sorted.filter((n) => (n.probability || 0) > 0).map((n) => n.id));
  }

  _wrap(text, maxWidth) {
    const ctx = this.ctx;
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  _drawTooltip(w, h) {
    if (!this.hovered || this.drag) return;
    const n = this.hovered;
    const x = this._sx(n.x), y = this._sy(n.y);
    const L = _LBL();
    const lines = [
      this._truncate(n.text, 60),
      `${_typeLabel(n)} · ${L.level || "level"} ${n.level} · ${L.likelihood || "likelihood"} ${Math.round((n.probability || 0) * 100)}%`,
    ];
    const ctx = this.ctx;
    ctx.font = "11px Inter, system-ui, sans-serif";
    const bw = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, 320);
    const bh = lines.length * 14 + 10;
    let tx = x + 14, ty = y - bh / 2;
    if (tx + bw > w) tx = x - bw - 14;
    ty = Math.max(4, Math.min(h - bh - 4, ty));
    ctx.fillStyle = NET_PAL.cardBg || "rgba(255,255,255,.97)";
    ctx.strokeStyle = NET_PAL.cardBorder || "#DDD9D0";
    ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NET_PAL.text || "#1F2320";
    ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, tx + 8, ty + 15 + i * 14));
  }

  _truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  _drawInfoCard(w, h) {
    const n = this.byId[this.selected];
    if (!n) return;
    const ctx = this.ctx;
    ctx.font = "11px Inter, system-ui, sans-serif";
    const maxW = 320;
    const titleLines = this._wrap(n.text, maxW - 18);
    const L = _LBL();
    const meta = [
      `${_typeLabel(n)} · ${L.level || "level"} ${n.level} · ${n.connections} ${L.links || "links"}`,
      `${L.likelihood || "likelihood"} ${Math.round((n.probability || 0) * 100)}% · ${_polLabel(n.polarity >= 0.25 ? "pos" : n.polarity <= -0.25 ? "neg" : "neutral")}`,
    ];
    let lines = [...titleLines, ...meta];
    if (n.causes.length) lines.push((L.causedBy || "caused by") + ": " + this._truncate(n.causes.slice(0, 3).join(", "), 46));
    if (n.effects.length) lines.push((L.leadsTo || "leads to") + ": " + this._truncate(n.effects.slice(0, 4).join(", "), 46));
    lines.push(L.dblClick || "double-click to chat");
    const bw = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, maxW);
    const bh = lines.length * 15 + 14;
    const tx = w - bw - 12, ty = 12;
    ctx.fillStyle = NET_PAL.cardBg || "rgba(255,255,255,.97)";
    ctx.strokeStyle = NET_PAL.cardBorder || "#DDD9D0";
    ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = this._color(n);
    ctx.font = "bold 12px Inter, system-ui, sans-serif";
    titleLines.forEach((l, i) => ctx.fillText(l, tx + 9, ty + 16 + i * 15));
    let dy = ty + 16 + titleLines.length * 15 + 2;
    ctx.fillStyle = NET_PAL.text || "#1F2320";
    ctx.font = "11px Inter, system-ui, sans-serif";
    meta.forEach((l) => { ctx.fillText(l, tx + 9, dy); dy += 15; });
    ctx.fillStyle = NET_PAL.muted || "#6E746B";
    const rest = lines.slice(titleLines.length + meta.length);
    rest.forEach((l) => { ctx.fillText(l, tx + 9, dy); dy += 15; });
  }

  /* ------------------------------------------------------------ interaction */
  _bind() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => this._onDown(e));
    window.addEventListener("mousemove", (e) => this._onMove(e));
    window.addEventListener("mouseup", () => this._onUp());
    c.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    c.addEventListener("dblclick", (e) => this._onDbl(e));
    c.addEventListener("mouseleave", () => { this.hovered = null; this._emitHover(null); });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _hit(sx, sy) {
    let best = null, bestD = Infinity;
    this.nodes.forEach((n) => {
      const x = this._sx(n.x), y = this._sy(n.y);
      const r = Math.max(9, this._radius(n, this.camera.scale) + 2);
      const d = Math.hypot(sx - x, sy - y);
      if (d <= r && d < bestD) { best = n; bestD = d; }
    });
    return best;
  }

  _onDown(e) {
    const p = this._pos(e);
    const node = this._hit(p.x, p.y);
    if (node) {
      this.drag = { type: "node", node, startX: p.x, startY: p.y, moved: false, offX: node.x - this._wx(p.x), offY: node.y - this._wy(p.y) };
      node.pinned = true;
    } else {
      this.drag = { type: "pan", startX: p.x, startY: p.y, camX: this.camera.tx, camY: this.camera.ty, moved: false };
    }
  }

  _onMove(e) {
    const p = this._pos(e);
    if (this.drag) {
      const dx = p.x - this.drag.startX, dy = p.y - this.drag.startY;
      if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
      if (this.drag.type === "node") {
        this.drag.node.x = this._wx(p.x) + this.drag.offX;
        this.drag.node.y = this._wy(p.y) + this.drag.offY;
        this.drag.node.vx = 0; this.drag.node.vy = 0;
      } else if (this.drag.type === "pan") {
        this.camera.tx = this.drag.camX + dx;
        this.camera.ty = this.drag.camY + dy;
      }
      return;
    }
    const node = this._hit(p.x, p.y);
    if (node !== this.hovered) {
      this.hovered = node;
      this._emitHover(node ? node.id : null);
    }
  }

  _onUp() {
    if (this.drag && this.drag.type === "node" && !this.drag.moved) {
      this.drag.node.pinned = false;  // a click, not a drag · don't pin
      if (this.connectMode) {
        const id = this.drag.node.id;
        if (!this.connectSource) {
          this.connectSource = id;
        } else if (this.connectSource !== id && this.onConnect) {
          this.onConnect(this.connectSource, id);
          this.connectSource = null;
        }
      } else {
        this.selected = this.drag.node.id;
        this._path = this._computePath(this.selected);
        if (this.onSelect) this.onSelect(this.drag.node.id);
      }
    } else if (this.drag && this.drag.type === "pan" && !this.drag.moved) {
      if (!this.connectMode) {
        this.selected = null;
        this._path = null;
        if (this.onSelect) this.onSelect(null);
      }
    }
    this.drag = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const p = this._pos(e);
    const before = { wx: this._wx(p.x), wy: this._wy(p.y) };
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    this.camera.scale = Math.max(0.02, Math.min(6, this.camera.scale * factor));
    this.camera.tx = p.x - this._cx() - before.wx * this.camera.scale;
    this.camera.ty = p.y - this._cy() - before.wy * this.camera.scale;
  }

  _onDbl(e) {
    const p = this._pos(e);
    const node = this._hit(p.x, p.y);
    if (node && this.onOpen) this.onOpen(node.id);
  }

  _emitHover(id) {
    if (this.onHover) this.onHover(id);
  }

  getSelected() { return this.selected; }
  select(id) {
    this.selected = id || null;
    this._path = this.selected ? this._computePath(this.selected) : null;
    this.render();
  }
  render() { this._draw(); }
  zoom(factor) { this.camera.scale = Math.max(0.12, Math.min(6, this.camera.scale * factor)); }

  downloadPNG() {
    this._draw();
    const a = document.createElement("a");
    a.href = this.canvas.toDataURL("image/png");
    a.download = "riak-causal-web.png";
    a.click();
  }
}

window.NetworkRenderer = NetworkRenderer;
Object.defineProperty(window, "POLARITY_COLORS", {
  get() { return { pos: NET_PAL.pos || "#2E8B6E", neg: NET_PAL.neg || "#B4554D", neutral: NET_PAL.neutral || "#8A9086" }; },
});
