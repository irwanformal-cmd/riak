/* Interactive causal-web graph · 3D causal ripple visualization.
 *
 * The ORIGINAL EVENT sits at the centre; consequences spread outward on
 * spherical shells by their EXISTING causal depth (node.level from the
 * engine — never recomputed here). When simulation results arrive, a ripple
 * wavefront expands from the centre and each depth-layer surfaces as the
 * wave crosses its shell: the web literally ripples outward.
 *
 * True 3D: nodes live in (x, y, z), viewed through an orbital perspective
 * camera (orbit / rotate / zoom / pan), software-projected onto the same
 * 2D canvas — zero dependencies, works offline, PNG export intact.
 *
 * Drop-in replacement for the previous 2D renderer: identical public API
 * (setWeb, resetWeb, relayout, fitView, zoom, select, render, downloadPNG,
 * setConnectMode, isConnectMode, onSelect, onOpen, onHover, onConnect).
 * Rendering and interaction only — graph data is never modified.
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

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* 3D ripple tuning — all knobs in one place */
const R3 = {
  shellGapBase: 260,    // base Z-separation between depth layers (grows with layer size)
  levelSpread: 150,     // shell radius guarantee per sqrt(node-count) — wide layers spread wider
  minAngleK: 2.1,       // same-layer angular separation ≈ minAngleK / sqrt(count)
  focal: 1.05,          // focal length = min(w,h) * focal
  nearClip: 80,
  breathe: 0.05,        // node radius heartbeat
  glowDark: 0.32,
  glowLight: 0.07,
  fogNear: 0.55,        // fog start (× camera dist)
  fogFar: 2.6,          // fog end (× camera dist)
  rippleSpeed: 300,     // intro wavefront units / s
  rippleTrail: [0, -95, -190],  // trailing rings behind the wavefront
  pulseSpeed: 0.16,     // causal-flow pulses per second
  pulses: 14,
  autoRotateDelay: 4500,// ms of stillness before gentle idle rotation
  autoRotate: 0.00045,  // yaw per frame while idle
  dust: 46,             // ambient depth particles (dark mode)
};

// deterministic per-id hash → [0,1) — stable layout across reloads
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
const _v = {
  len: (p) => Math.hypot(p.x, p.y, p.z) || 1,
  norm: (p) => { const l = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / l, y: p.y / l, z: p.z / l }; },
};

class NetworkRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.byId = {};
    this.adj = {};
    this.selected = null;
    this._path = null;
    this.hovered = null;
    this.drag = null;
    this.onSelect = null;
    this.onOpen = null;
    this.onHover = null;
    this.onConnect = null;
    this.connectMode = false;
    this.connectSource = null;

    // orbital camera: yaw/pitch around a target, perspective distance
    this.camera = { yaw: -0.65, pitch: 0.52, dist: 1400, tx: 0, ty: 0, tz: 0 };
    this._maxR = 500;          // bounding radius of the current web
    this._spread = 1;          // user spacing multiplier (Gather − / Spread ＋)
    this._mode = "3d";         // "3d" | "2d" — two views of the SAME network
    this._modeT = 1;           // morph parameter: 1 = full 3D ripple, 0 = flat map
    this._camAnim = null;      // camera morph { from, to, k }

    // ripple + ambient state
    this._t = 0;
    this._wave = null;         // intro wavefront { t } (seconds since start)
    this._ripples = [];        // local ripples { x,y,z, age, max }
    this._lastInteract = performance.now();
    this._dust = [];
    let s0 = 42;
    for (let i = 0; i < R3.dust; i++) {
      s0 = (s0 * 1664525 + 1013904223) >>> 0;
      this._dust.push({ x: (s0 % 1000) / 1000, y: ((s0 >>> 10) % 1000) / 1000,
                        z: ((s0 >>> 20) % 1000) / 1000, r: 0.8 + ((s0 >>> 8) % 100) / 90,
                        ph: ((s0 >>> 6) % 628) / 100 });
    }
    this._pointers = new Map();   // multi-touch
    this._pinch = null;

    const touch = () => { this._lastInteract = performance.now(); };
    canvas.addEventListener("pointerdown", touch, { passive: true });
    canvas.addEventListener("wheel", touch, { passive: true });
    canvas.addEventListener("pointermove", touch, { passive: true });

    this._bind();
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  /* ---------------------------------------------------------------- setup */
  setWeb(web) {
    // Preserve existing 3D positions so growth is incremental, not a teleport.
    const prevPos = {};
    this.nodes.forEach((n) => {
      prevPos[n.id] = { x: n.x, y: n.y, z: n.z, bx: n.bx, by: n.by, bz: n.bz, b2x: n.b2x, b2z: n.b2z };
    });
    const hadNodes = this.nodes.length > 0;

    this.nodes = (web.nodes || []).map((n) => {
      const hh = _hash01(n.id);
      const p = prevPos[n.id];
      const base = {
        id: n.id, text: n.text || "", type: n.type || "consequence", level: n.level || 0,
        polarity: n.polarity || 0, probability: n.probability || 0,
        _phase: hh * Math.PI * 2,
      };
      if (p) return Object.assign(base, {
        x: p.x, y: p.y, z: p.z,
        bx: p.bx != null ? p.bx : p.x, by: p.by != null ? p.by : p.y, bz: p.bz != null ? p.bz : p.z,
        b2x: p.b2x, b2z: p.b2z,
        fresh: false, grow: 1,
      });
      return Object.assign(base, { x: 0, y: 0, z: 0, fresh: true, grow: 0 });
    });

    this.byId = {};
    this.adj = {};
    const causes = {}, effects = {};
    this.nodes.forEach((n) => { this.byId[n.id] = n; this.adj[n.id] = new Set(); });
    this.edges = (web.edges || []).map((e) => ({
      source: e.source, target: e.target,
      relation: e.relation || "causes", weight: e.weight || 0.6,
      proposed: !!e.proposed,
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
    this._path = this.selected ? this._computePath(this.selected) : null;

    if (!hadNodes) {
      this._seedLayout();        // ripple bloom from the original event
      this._fit();
      this._wave = REDUCED_MOTION ? null : { t: 0 };
      if (!this.nodes.length) this._wave = null;
      this._spawnRootRipples();
    } else {
      // fresh nodes: place on their (adaptive) depth shell beside a parent,
      // then spread against same-shell siblings so newcomers don't stack
      this._layoutRadii();
      this.nodes.forEach((n) => {
        if (!n.fresh) return;
        const ps = (causes[n.id] || []).filter((pid) => this.byId[pid]);
        const shell = this._radii[n.level] || (Math.max(1, n.level) * R3.shellGapBase);
        if (ps.length) {
          const p = this.byId[ps[0]];
          const dir = _v.norm(p);
          const j = this._hashDir(n.id);
          const d2 = _v.norm({
            x: dir.x + j.x * 0.55, y: dir.y + j.y * 0.55, z: dir.z + j.z * 0.55,
          });
          n.x = d2.x * shell; n.y = d2.y * shell; n.z = d2.z * shell;
          if (!REDUCED_MOTION) this._ripples.push({ x: p.x, y: p.y, z: p.z, age: 0, max: 150 });
        } else {
          const d = this._hashDir(n.id);
          n.x = d.x * shell; n.y = d.y * shell; n.z = d.z * shell;
        }
      });
      // de-overlap each affected shell (fresh + existing siblings) — work in
      // base space so the user's spread multiplier is never disturbed
      const freshLevels = new Set(this.nodes.filter((n) => n.fresh).map((n) => n.level));
      freshLevels.forEach((lv) => {
        if (lv === 0) return;
        const group = this.nodes.filter((n) => n.level === lv);
        group.forEach((n) => { if (!n.fresh && n.bx != null) { n.x = n.bx; n.y = n.by; n.z = n.bz; } });
        this._spreadShell(group, this._radii[lv] || 0);
        group.forEach((n) => {
          n.bx = n.x; n.by = n.y; n.bz = n.z;
          if (!n.fresh) { n.x = n.bx * this._spread; n.y = n.by * this._spread; n.z = n.bz * this._spread; }
        });
      });
      this._derive2D();
      this._updateMaxR();
    }
  }

  /* Start-node (root) placement: the origin layer stays central, but N roots
   * never pile onto one point — each gets its own breathing room in 3D.
   *   1–2 roots → close to the centre
   *   3–5 roots → radial ring distribution
   *   6+ roots  → distributed 3D arrangement, radius growing gradually
   * Everything derives from stable hashes/indices — deterministic per web. */
  _rootRadius(k) {
    const firstShell = this._radii
      ? Math.min(...Object.values(this._radii).filter((r) => r > 0), Infinity)
      : 400;
    const cap = (isFinite(firstShell) ? firstShell : 400) * 0.42;
    if (k <= 2) return 55;
    if (k <= 5) return Math.min(cap, 85 + k * 14);
    return Math.min(cap, 160 + Math.sqrt(k) * 36);
  }

  // near-uniform direction on the sphere (golden-angle / Fibonacci spiral)
  _fibDir(i, k) {
    if (k <= 1) return { x: 0, y: 0, z: 0 };
    const y = 1 - (i / (k - 1)) * 2;            // +1 → −1 pole to pole
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * 2.399963229728653;        // golden angle
    return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
  }

  // deterministic 3D direction from an id (uniform-ish on the sphere)
  _hashDir(id) {
    const u = _hash01(id + "~u"), v = _hash01(id + "~v");
    const az = u * Math.PI * 2;
    const el = (v - 0.5) * Math.PI * 0.85;   // bias toward the equator
    return { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
  }

  /* Adaptive shell radii — spacing responds to the web's shape, never a
   * uniform scale-up:
   *  · Z/depth separation grows when layers are crowded (crowded shells
   *    need more room from their neighbours).
   *  · A wide layer's shell radius is guaranteed large enough that its
   *    nodes fit on the surface without stacking (radius ∝ √count).
   * Depth hierarchy is preserved: deeper causal level → strictly larger shell. */
  _layoutRadii() {
    const counts = {};
    this.nodes.forEach((n) => { counts[n.level] = (counts[n.level] || 0) + 1; });
    const levels = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const radii = {};
    let prevR = 0, prevL = levels[0] || 0;
    for (const L of levels) {
      if (L === levels[0]) { radii[L] = 0; continue; }
      const count = counts[L];
      const step = L - prevL;
      // deeper gap when this layer OR the previous one is busy
      const crowd = Math.max(count, counts[prevL] || 1);
      const gap = R3.shellGapBase * step * (1 + 0.30 * Math.log2(Math.max(2, crowd)));
      const byCount = Math.sqrt(count) * R3.levelSpread;
      const r = Math.max(prevR + gap, byCount);
      radii[L] = r;
      prevR = r; prevL = L;
    }
    this._radii = radii;
    this._levelCounts = counts;
  }

  /* Push same-shell nodes apart on the sphere (deterministic, layout-only).
   * Preserves each node's parent-direction neighbourhood while guaranteeing
   * a minimum angular separation, so siblings stop overlapping. */
  _spreadShell(levelNodes, shell) {
    const k = levelNodes.length;
    if (k < 2 || shell <= 0) return;
    const minAngle = Math.min(0.9, R3.minAngleK / Math.sqrt(k));
    const iters = k > 400 ? 4 : k > 150 ? 8 : 22;
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
          const a = levelNodes[i], b = levelNodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const minD = 2 * shell * Math.sin(minAngle / 2);
          if (d2 >= minD * minD) continue;
          const d = Math.sqrt(d2) || 0.001;
          if (d < 0.01) { dx = 0.01; dy = 0.013; dz = 0.017; }
          const push = (minD - d) * 0.28;
          const ux = dx / d, uy = dy / d, uz = dz / d;
          a.x += ux * push; a.y += uy * push; a.z += uz * push;
          b.x -= ux * push; b.y -= uy * push; b.z -= uz * push;
          // re-project onto the shell — depth hierarchy stays exact
          const la = _v.len(a), lb = _v.len(b);
          a.x *= shell / la; a.y *= shell / la; a.z *= shell / la;
          b.x *= shell / lb; b.y *= shell / lb; b.z *= shell / lb;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /* Ripple bloom: original event at the centre; every consequence sits on
   * the spherical shell of its existing depth (node.level), clustered in the
   * direction of its parents so branches fan outward organically, then
   * spread within the shell so siblings keep breathing room. */
  _seedLayout() {
    this._layoutRadii();
    const byLevel = {};
    this.nodes.forEach((n) => { (byLevel[n.level] = byLevel[n.level] || []).push(n); });
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    const roots = byLevel[levels[0]] || [];
    const rk = roots.length;
    if (rk === 1) {
      roots[0].x = 0; roots[0].y = 0; roots[0].z = 0;
    } else if (rk > 1) {
      const R0 = this._rootRadius(rk);
      roots.forEach((n, i) => {
        // radial distribution: stable Fibonacci direction + per-node jitter
        const dir = this._fibDir(i, rk);
        const j = this._hashDir(n.id);
        const d = _v.norm({
          x: dir.x + j.x * 0.22, y: dir.y + j.y * 0.22, z: dir.z + j.z * 0.22,
        });
        // 6+ roots: radius grows gradually through the arrangement
        const step = rk >= 6 ? (i / rk) * R0 * 0.55 : 0;
        const rr = Math.min(R0 + step, R0 * (0.82 + 0.34 * _hash01(n.id + "~rr")) + step);
        n.x = d.x * rr; n.y = d.y * rr; n.z = d.z * rr;
      });
    }
    levels.slice(1).forEach((level) => {
      const shell = this._radii[level];
      const group = byLevel[level] || [];
      const spread = Math.min(0.85, 0.34 + 0.06 * Math.log2(Math.max(2, group.length)));
      group.forEach((n) => {
        const ps = (this._parentIds[n.id] || []).filter((pid) => this.byId[pid]);
        let dir;
        if (ps.length) {
          let sx = 0, sy = 0, sz = 0;
          ps.forEach((pid) => {
            const p = this.byId[pid], l = _v.len(p);
            sx += p.x / l; sy += p.y / l; sz += p.z / l;
          });
          dir = _v.norm({ x: sx, y: sy, z: sz });
          // angular jitter around the parent direction — widens with layer size
          const j = this._hashDir(n.id);
          dir = _v.norm({
            x: dir.x + j.x * spread, y: dir.y + j.y * spread, z: dir.z + j.z * spread,
          });
        } else {
          dir = this._hashDir(n.id);
        }
        n.x = dir.x * shell; n.y = dir.y * shell; n.z = dir.z * shell;
      });
      this._spreadShell(group, shell);
    });
    this._commitBase();
    this._derive2D();
    this._updateMaxR();
  }

  // remember each node's causal-layout position; the rendered position is
  // base × this._spread, eased smoothly so spacing controls never teleport
  _commitBase() {
    this.nodes.forEach((n) => { n.bx = n.x; n.by = n.y; n.bz = n.z; });
  }

  /* spacing controls — each click steps the multiplier; the render loop
   * eases every node toward base × spread (X, Y and Z alike), so the web
   * breathes apart or together without ever teleporting. Roots ride the
   * same radial multiplier: spread separates them radially, gather draws
   * them back toward the origin — the floor (0.55) prevents any collapse. */
  spread() {
    this._spread = Math.min(2.4, this._spread * 1.18);
    this._lastInteract = performance.now();
  }
  gather() {
    this._spread = Math.max(0.55, this._spread / 1.18);
    this._lastInteract = performance.now();
  }

  _updateMaxR() {
    this._maxR = this.nodes.reduce((m, n) => Math.max(m, _v.len(n)), 0) + 140;
    // node size tracks the graph's scale, so wider-spaced webs keep
    // readable nodes instead of shrinking into pinpoints
    this._sizeK = Math.max(1, Math.min(6, this._maxR * 0.0024));
  }

  _fitDist() {
    const w = this.canvas.clientWidth || this.canvas.width || 800;
    const h = this.canvas.clientHeight || this.canvas.height || 560;
    const focal = Math.min(w, h) * R3.focal;
    return Math.max(320, (this._maxR * focal) / (Math.min(w, h) * 0.42));
  }

  // canonical camera pose per view mode (fit view / morph target)
  _modePose() {
    const dist = this._fitDist();
    return this._mode === "2d"
      ? { yaw: 0, pitch: 1.42, dist, tx: 0, ty: 0, tz: 0 }      // top-down causal map
      : { yaw: -0.65, pitch: 0.52, dist, tx: 0, ty: 0, tz: 0 }; // 3D ripple orbit
  }

  _fit() {
    this._updateMaxR();
    this._camAnim = null;
    Object.assign(this.camera, this._modePose());
  }

  fitView() { this._fit(); }
  resetWeb(web) {
    this.nodes = [];
    this.byId = {};
    this.adj = {};
    this.selected = null;
    this.connectSource = null;
    this.connectMode = false;
    this._ripples = [];
    this._wave = null;
    this.setWeb(web);
  }
  relayout() {
    this.nodes.forEach((n) => { n.fresh = false; n.grow = 1; });
    this._seedLayout();
    this._fit();
    this._wave = REDUCED_MOTION ? null : { t: 0 };
    this._spawnRootRipples();
  }

  // every start node is its own ripple source — a small staggered ring
  // expands from each root when the web (re)blooms
  _spawnRootRipples() {
    if (REDUCED_MOTION || !this.nodes.length) return;
    const minL = Math.min(...this.nodes.map((n) => n.level || 0));
    this.nodes
      .filter((n) => (n.level || 0) === minL)
      .forEach((n, i) => {
        this._ripples.push({ x: n.x, y: n.y, z: n.z, age: -(0.1 + i * 0.14), max: 195 });
      });
  }

  setConnectMode(on) {
    this.connectMode = !!on;
    this.connectSource = null;
  }
  isConnectMode() { return this.connectMode; }

  /* Reverse ripple for goal backtracking: pass ids ordered TARGET-first —
   * rings bloom at the desired outcome, then walk back along the proposed
   * path toward the existing network (reasoning direction made visible). */
  pulsePath(ids) {
    if (REDUCED_MOTION || !ids || !ids.length) return;
    ids.forEach((id, i) => {
      const n = this.byId[id];
      if (n) this._ripples.push({ x: n.x, y: n.y, z: n.z, age: -(0.05 + i * 0.22), max: 210 });
    });
  }

  /* ---------------------------------------------------- 2D ↔ 3D morph
   * ONE causal network, two views. Nothing is rebuilt: every node keeps a
   * 3D ripple base (bx,by,bz) AND a 2D map base (b2x,b2z); the render loop
   * eases each node between them through _modeT while the camera glides to
   * the mode's pose — the web visibly flattens into a map / unfolds into
   * space. Node identity, edges and causal depth data never change. */
  setMode(mode) {
    mode = mode === "2d" ? "2d" : "3d";
    if (mode === this._mode) return;
    this._mode = mode;
    this._camAnim = { from: Object.assign({}, this.camera), to: this._modePose(), k: 0 };
    this._lastInteract = performance.now();
  }
  getMode() { return this._mode; }

  /* Derive the 2D causal map from the existing 3D layout: each node keeps
   * its ripple azimuth and its depth-shell radius, elevation collapses to
   * the plane (z≡0 in world-Y terms: the map lies on X/Z). Same shells as
   * 3D, so the morph is a true flattening, not a re-layout. */
  _derive2D() {
    const byLevel = {};
    this.nodes.forEach((n) => { (byLevel[n.level] = byLevel[n.level] || []).push(n); });
    Object.keys(byLevel).map(Number).forEach((lv) => {
      const group = byLevel[lv];
      const shell = lv === 0 ? 0 : (this._radii[lv] || lv * R3.shellGapBase);
      group.forEach((n, i) => {
        let hr = Math.hypot(n.bx, n.bz);
        let az;
        if (lv === 0) {
          // roots keep their radial distance from the origin, flattened
          const r3 = Math.hypot(n.bx, n.by, n.bz);
          if (r3 < 1) { n.b2x = 0; n.b2z = 0; return; }
          az = hr > r3 * 0.2 ? Math.atan2(n.bz, n.bx) : Math.atan2(this._hashDir(n.id).z, this._hashDir(n.id).x);
          n.b2x = Math.cos(az) * r3; n.b2z = Math.sin(az) * r3;
          return;
        }
        if (hr < shell * 0.2) {
          const d = this._hashDir(n.id);
          az = Math.atan2(d.z, d.x);
        } else {
          az = Math.atan2(n.bz, n.bx);
        }
        n.b2x = Math.cos(az) * shell; n.b2z = Math.sin(az) * shell;
      });
      if (lv > 0 && shell > 0) {
        // de-overlap within the flat ring, same rule as the 3D shells
        const temp = group.map((n) => ({ n, x: n.b2x, y: 0, z: n.b2z }));
        this._spreadShell(temp, shell);
        temp.forEach((t) => { t.n.b2x = t.x; t.n.b2z = t.z; });
      } else if (lv === 0 && group.length > 1) {
        const r0 = Math.hypot(group[0].b2x, group[0].b2z) || 60;
        const temp = group.map((n) => ({ n, x: n.b2x, y: 0, z: n.b2z }));
        this._spreadShell(temp, r0);
        temp.forEach((t) => { t.n.b2x = t.x; t.n.b2z = t.z; });
      }
    });
  }

  /* ------------------------------------------------------ 3D → 2D camera */
  _cx() { return (this.canvas.clientWidth || this.canvas.width) / 2; }
  _cy() { return (this.canvas.clientHeight || this.canvas.height) / 2; }
  _focal() { return Math.min(this.canvas.clientWidth || 800, this.canvas.clientHeight || 560) * R3.focal; }

  // world → view (rotate around target) → perspective screen point
  _project(x, y, z) {
    const c = this.camera;
    const dx = x - c.tx, dy = y - c.ty, dz = z - c.tz;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const x1 = dx * cy + dz * sy;
    const z1 = -dx * sy + dz * cy;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const y2 = dy * cp - z1 * sp;
    const z2 = dy * sp + z1 * cp;
    const depth = Math.max(R3.nearClip, z2 + c.dist);
    const s = this._focal() / depth;
    return { x: this._cx() + x1 * s, y: this._cy() - y2 * s, depth, s };
  }

  // screen point at a given view depth → world (for node dragging)
  _unproject(sx, sy, depth) {
    const c = this.camera;
    const x1 = (sx - this._cx()) * depth / this._focal();
    const y2 = -(sy - this._cy()) * depth / this._focal();
    const z2 = depth - c.dist;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const dy = y2 * cp + z2 * sp;
    const z1 = -y2 * sp + z2 * cp;
    const cy = Math.cos(c.yaw), syw = Math.sin(c.yaw);
    const dx = x1 * cy - z1 * syw;
    const dz = x1 * syw + z1 * cy;
    return { x: dx + c.tx, y: dy + c.ty, z: dz + c.tz };
  }

  // pan: shift the camera target in the view plane
  _panBy(dxPx, dyPx) {
    const c = this.camera;
    const depth = c.dist;
    const x1 = -dxPx * depth / this._focal();
    const y2 = dyPx * depth / this._focal();
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const dy = y2 * cp;
    const z1 = -y2 * sp;
    const cy = Math.cos(c.yaw), syw = Math.sin(c.yaw);
    c.tx += x1 * cy - z1 * syw;
    c.ty += dy;
    c.tz += x1 * syw + z1 * cy;
  }

  /* -------------------------------------------------------------- physics */
  _radiusW(n) {   // world-space radius (before perspective)
    const base = (n.type === "root" || n.type === "intervention") ? 13 : 8;
    const hub = Math.min(10, n.connections || 0) * 0.9;
    const prob = (n.probability || 0) * 22;
    const grow = n.grow != null ? n.grow : 1;
    return Math.max(6, (base + prob + hub) * (this._sizeK || 1) * grow);
  }

  _color(n) {
    if (n.type === "target") return NET_PAL.amber || "#E0B36A";          // 🎯 desired outcome
    if (n.type === "requirement") return NET_PAL.accent2 || "#2EA8C9";   // generated prerequisite
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

  // Walk a node's strongest incoming causal links back to a root.
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

  // 3D quadratic-bezier control point: push the midpoint outward + jitter,
  // so edges arc through space instead of crossing the centre.
  _edgeCtrl(a, b, e) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    const h = _hash01(e.source + ">" + e.target) - 0.5;
    const l = _v.len({ x: mx, y: my, z: mz }) || 1;
    const push = 1.16 + h * 0.10;
    return {
      x: mx * push + h * 60 * (my / l + 0.3),
      y: my * push - h * 60 * (mx / l + 0.3),
      z: mz * push + h * 60 * (mz / l),
    };
  }
  _bez(p0, c, p1, u) {
    const v = 1 - u;
    return {
      x: v * v * p0.x + 2 * v * u * c.x + u * u * p1.x,
      y: v * v * p0.y + 2 * v * u * c.y + u * u * p1.y,
      z: v * v * p0.z + 2 * v * u * c.z + u * u * p1.z,
    };
  }

  _topProbable() {
    const sorted = [...this.nodes].sort((a, b) => (b.probability || 0) - (a.probability || 0)).slice(0, 6);
    return new Set(sorted.filter((n) => (n.probability || 0) > 0).map((n) => n.id));
  }

  /* -------------------------------------------------------------- loop */
  _loop() {
    this._raf = requestAnimationFrame(this._loop.bind(this));
    this._t += 1 / 60;
    if (this._wave) {
      this._wave.t += 1 / 60;
      if (this._wave.t * R3.rippleSpeed > this._maxR + 260) this._wave = null;
    }
    for (let i = this._ripples.length - 1; i >= 0; i--) {
      this._ripples[i].age += 1 / 60;
      if (this._ripples[i].age > 1.1) this._ripples.splice(i, 1);
    }
    this.nodes.forEach((n) => {
      if (n.grow != null && n.grow < 1) n.grow = Math.min(1, n.grow + 0.06);
    });
    // morph easing: one smooth glide for BOTH view mode (2D↔3D) and spacing
    const modeTarget = this._mode === "3d" ? 1 : 0;
    this._modeT += (modeTarget - this._modeT) * 0.12;
    if (Math.abs(modeTarget - this._modeT) < 0.002) this._modeT = modeTarget;
    const mt = this._modeT, im = 1 - mt;
    const sf = this._spread;
    const dragNode = this.drag && this.drag.type === "node" ? this.drag.node : null;
    {
      let moving = false;
      this.nodes.forEach((n) => {
        if (n.bx == null || n === dragNode) return;
        const b2x = n.b2x != null ? n.b2x : n.bx;
        const b2z = n.b2z != null ? n.b2z : n.bz;
        const tx = (n.bx * mt + b2x * im) * sf;
        const ty = (n.by * mt) * sf;
        const tz = (n.bz * mt + b2z * im) * sf;
        const dx = tx - n.x, dy = ty - n.y, dz = tz - n.z;
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.05) moving = true;
        n.x += dx * 0.14; n.y += dy * 0.14; n.z += dz * 0.14;
      });
      this._spreadMoving = moving;
    }
    // camera morph between view poses
    if (this._camAnim) {
      const a = this._camAnim;
      a.k += (1 - a.k) * 0.12;
      const e = a.k < 0.5 ? 4 * a.k * a.k * a.k : 1 - Math.pow(-2 * a.k + 2, 3) / 2;
      const c = this.camera;
      c.yaw = a.from.yaw + (a.to.yaw - a.from.yaw) * e;
      c.pitch = a.from.pitch + (a.to.pitch - a.from.pitch) * e;
      c.dist = a.from.dist + (a.to.dist - a.from.dist) * e;
      c.tx = a.from.tx + (a.to.tx - a.from.tx) * e;
      c.ty = a.from.ty + (a.to.ty - a.from.ty) * e;
      c.tz = a.from.tz + (a.to.tz - a.from.tz) * e;
      if (a.k > 0.995) { Object.assign(c, a.to); this._camAnim = null; }
    }
    // gentle idle rotation — the web slowly turns when the user steps back
    if (!REDUCED_MOTION && performance.now() - this._lastInteract > R3.autoRotateDelay &&
        this.nodes.length && !this.drag && !this._camAnim && this._modeT > 0.6) {
      this.camera.yaw += R3.autoRotate;
    }
    if (this.canvas.clientWidth > 0) this._draw();
  }

  // intro wavefront radius (null once the intro has passed)
  _waveR() {
    if (!this._wave) return Infinity;
    return this._wave.t * R3.rippleSpeed;
  }
  // node visibility through the intro ripple: 0 hidden → 1 surfaced
  _surfaced(n) {
    const wr = this._waveR();
    if (wr === Infinity) return 1;
    const r = _v.len(n);
    return Math.min(1, Math.max(0, (wr - r) / 90));
  }

  /* -------------------------------------------------------------- drawing */
  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.nodes.length) return;

    const dark = _palIsDark();
    const acc = NET_PAL.accentRGB || [127, 212, 232];
    const cam = this.camera;
    const fogK = (depth) => {
      const t = (depth - cam.dist * R3.fogNear) / (cam.dist * (R3.fogFar - R3.fogNear));
      return Math.max(0.12, Math.min(1, 1 - t * 0.85));
    };

    // ambient dust drifting through the volume (dark mode, additive)
    if (dark && !REDUCED_MOTION) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this._dust.forEach((d) => {
        const span = this._maxR * 1.6;
        const px = (d.x - 0.5) * span;
        const py = ((d.y * span + this._t * 14 + d.ph * 20) % span) - span / 2;
        const pz = (d.z - 0.5) * span;
        const p = this._project(px, py, pz);
        const tw = 0.5 + 0.5 * Math.sin(this._t * 0.7 + d.ph);
        ctx.globalAlpha = (0.05 + 0.09 * tw) * fogK(p.depth);
        ctx.fillStyle = rgba(acc, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, d.r * p.s), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    const selectedSet = this.selected
      ? new Set([this.selected, ...(this.adj[this.selected] || []), ...(this._path ? this._path.nodes : [])])
      : null;
    const topProb = this._topProbable();

    /* ---- depth-layer guide shells: faint rings on the equatorial plane ---- */
    {
      const maxLevel = this.nodes.reduce((m, n) => Math.max(m, n.level || 0), 0);
      ctx.save();
      for (let L = 1; L <= maxLevel; L++) {
        const shell = (this._radii && this._radii[L]) || L * R3.shellGapBase;
        const vis = this._wave ? Math.min(1, Math.max(0, (this._waveR() - shell) / 120)) : 1;
        if (vis <= 0) continue;
        ctx.beginPath();
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          const p = this._project(Math.cos(a) * shell, 0, Math.sin(a) * shell);
          k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = rgba(acc, 0.045 * vis);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- ripple rings: intro wavefront + local growth ripples ---- */
    const drawRing = (ox, oy, oz, r, alpha, width) => {
      if (r <= 0 || alpha <= 0) return;
      ctx.beginPath();
      for (let k = 0; k <= 56; k++) {
        const a = (k / 56) * Math.PI * 2;
        const p = this._project(ox + Math.cos(a) * r, oy, oz + Math.sin(a) * r);
        k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rgba(acc, alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    };
    if (this._wave && !REDUCED_MOTION) {
      const wr = this._waveR();
      R3.rippleTrail.forEach((off, i) => {
        const r = wr + off;
        const fade = Math.max(0, 1 - wr / (this._maxR + 260));
        drawRing(0, 0, 0, r, (0.30 - i * 0.09) * fade, 1.6 - i * 0.4);
      });
    }
    this._ripples.forEach((rp) => {
      if (rp.age < 0) return;   // staggered start — not yet born
      const u = rp.age / 1.1;
      drawRing(rp.x, rp.y, rp.z, rp.max * (0.2 + u * 0.8), 0.35 * (1 - u), 1.4);
    });

    /* ---- edges: curved 3D arcs, depth-sorted far → near ---- */
    const edgeItems = [];
    this.edges.forEach((e) => {
      const a = this.byId[e.source], b = this.byId[e.target];
      if (!a || !b) return;
      const visA = this._surfaced(a), visB = this._surfaced(b);
      const vis = Math.min(visA, visB);
      if (vis <= 0) return;
      const ctrl = this._edgeCtrl(a, b, e);
      const SEG = 14;
      const pts = [];
      let depthSum = 0;
      for (let k = 0; k <= SEG; k++) {
        const wpt = this._bez(a, ctrl, b, k / SEG);
        const p = this._project(wpt.x, wpt.y, wpt.z);
        pts.push(p);
        depthSum += p.depth;
      }
      edgeItems.push({ e, a, b, ctrl, pts, depth: depthSum / (SEG + 1), vis });
    });
    edgeItems.sort((p, q) => q.depth - p.depth);
    edgeItems.forEach(({ e, a, b, pts, depth, vis }) => {
      const onPath = this._path && this._path.edges.has(e.source + "|" + e.target);
      const highlighted = !selectedSet || onPath || (selectedSet.has(a.id) || selectedSet.has(b.id));
      const inhibiting = e.relation === "prevents" || e.relation === "weakens";
      const rgb = onPath ? (NET_PAL.accentRGB || [127, 212, 232])
        : inhibiting ? (NET_PAL.negRGB || [232, 121, 111]) : (NET_PAL.edgeRGB || [110, 160, 185]);
      let alpha = onPath ? 0.85 : inhibiting ? 0.16 + e.weight * 0.30 : 0.13 + e.weight * 0.30;
      if (selectedSet && !highlighted) alpha *= 0.05;
      alpha *= fogK(depth) * vis * (dark ? 1.6 : 1);
      if (alpha <= 0.004) return;
      ctx.strokeStyle = rgba(rgb, Math.min(1, alpha));
      ctx.lineWidth = (onPath ? 2.2 : 0.8 + e.weight * 1.3) * (pts[0].s * 900 / this._focal() + 0.4);
      ctx.beginPath();
      pts.forEach((p, k) => { k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
      if (e.proposed) {           // hypothesis link — dashed, never solid
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
    });

    /* ---- causal flow: light pulses travelling the strongest links ---- */
    if (!REDUCED_MOTION) {
      const pool = this._path && this._path.edges.size
        ? this.edges.filter((e) => this._path.edges.has(e.source + "|" + e.target))
        : [...this.edges].sort((a, b) => b.weight - a.weight).slice(0, R3.pulses);
      ctx.save();
      if (dark) ctx.globalCompositeOperation = "lighter";
      pool.slice(0, R3.pulses).forEach((e) => {
        const a = this.byId[e.source], b = this.byId[e.target];
        if (!a || !b) return;
        if (Math.min(this._surfaced(a), this._surfaced(b)) < 1) return;
        const ctrl = this._edgeCtrl(a, b, e);
        const u = (this._t * R3.pulseSpeed + _hash01(e.source + ">" + e.target)) % 1;
        const wpt = this._bez(a, ctrl, b, u);
        const p = this._project(wpt.x, wpt.y, wpt.z);
        const fade = Math.sin(u * Math.PI);
        ctx.globalAlpha = 0.75 * fade * fogK(p.depth);
        ctx.fillStyle = rgba(acc, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, 4.5 * p.s * (this._sizeK || 1)), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    /* ---- nodes: 3D spheres with glow, depth-sorted far → near ---- */
    const glowA = dark ? R3.glowDark : R3.glowLight;
    const nodeItems = this.nodes
      .map((n) => ({ n, p: this._project(n.x, n.y, n.z), vis: this._surfaced(n) }))
      .filter((it) => it.vis > 0)
      .sort((a, b) => b.p.depth - a.p.depth);

    nodeItems.forEach(({ n, p, vis }) => {
      const dim = selectedSet && !selectedSet.has(n.id);
      const breathe = REDUCED_MOTION ? 1 : 1 + R3.breathe * Math.sin(this._t * 1.05 + (n._phase || 0));
      const grow = n.grow != null ? n.grow : 1;
      const r = Math.max(1.2, this._radiusW(n) * p.s * breathe * (0.3 + 0.7 * vis) * grow);
      const col = this._color(n);
      const crgb = this._rgbOf(col);
      const fog = fogK(p.depth);
      const isHover = this.hovered === n.id;
      const isSel = this.selected === n.id;
      const key = n.type === "root" || n.type === "intervention" || topProb.has(n.id) || isSel || isHover;

      // halo: nodes are light sources in deep water
      if ((dark || key) && !dim) {
        const strength = (key ? glowA * 1.7 : glowA * 0.5) * fog * vis * (isHover ? 1.5 : 1);
        ctx.save();
        if (dark) ctx.globalCompositeOperation = "lighter";
        const grad = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 4.2);
        grad.addColorStop(0, rgba(crgb, strength));
        grad.addColorStop(1, rgba(crgb, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // sphere body: offset radial highlight sells the 3D volume
      const bodyA = (dim ? 0.12 : isSel ? 1 : 0.94) * fog * vis;
      const grad = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
      const hi = crgb.map((c) => Math.min(255, c + 90));
      const lo = crgb.map((c) => Math.max(0, c * 0.45 | 0));
      grad.addColorStop(0, rgba(hi, bodyA));
      grad.addColorStop(0.55, rgba(crgb, bodyA));
      grad.addColorStop(1, rgba(lo, bodyA));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // rim light
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(hi, bodyA * 0.5);
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // selection ring / top-probability ring / connect-source ring
      if (isSel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = NET_PAL.text || "#E9F4F8";
        ctx.lineWidth = 2;
        ctx.stroke();
        // expanding selection ripple
        if (!REDUCED_MOTION) {
          const u = (this._t * 0.9) % 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5 + u * 22, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(acc, 0.35 * (1 - u));
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      } else if (topProb.has(n.id)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(NET_PAL.amberRGB || [224, 179, 106], 0.55);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // hypothesis layer markers: requirements get a dashed orbit ring, the
      // target gets a crosshair — visually unmistakable vs. confirmed nodes
      if (n.type === "requirement" && !dim) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(crgb, 0.75 * fog * vis);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      } else if (n.type === "target" && !dim) {
        const trgb = this._rgbOf(NET_PAL.amber || "#E0B36A");
        const ringR = r + 5;
        ctx.save();
        ctx.strokeStyle = rgba(trgb, 0.9 * fog * vis);
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 4; k++) {           // crosshair arcs
          const a0 = k * Math.PI / 2 + 0.22 + (REDUCED_MOTION ? 0 : this._t * 0.35);
          ctx.beginPath();
          ctx.arc(p.x, p.y, ringR, a0, a0 + Math.PI / 2 - 0.44);
          ctx.stroke();
        }
        ctx.beginPath();                         // centre dot ring
        ctx.arc(p.x, p.y, Math.max(1.4, r * 0.28), 0, Math.PI * 2);
        ctx.fillStyle = rgba(trgb, 0.95 * fog * vis);
        ctx.fill();
        ctx.restore();
      }
      if (this.connectMode && this.connectSource === n.id) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = NET_PAL.pos || "#4FD6A5";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // labels
      const showLabel = topProb.has(n.id) || n.type === "root" || n.type === "intervention" ||
        n.type === "target" || n.type === "requirement" ||
        isHover || isSel || (this._path && this._path.nodes.has(n.id));
      if (showLabel && !dim) {
        ctx.fillStyle = rgba(this._rgbOf(NET_PAL.label || "#E9F4F8"), 0.92 * fog);
        ctx.font = "600 10.5px Manrope, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(this._truncate(n.text, 24), p.x, p.y - r - 6);
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
    ctx.font = "600 12px Manrope, system-ui, sans-serif";
    const bw = ctx.measureText(msg).width + 20;
    const bh = 30;
    ctx.fillStyle = NET_PAL.cardBg || "rgba(8,32,50,.97)";
    ctx.strokeStyle = NET_PAL.pos || "#4FD6A5";
    ctx.beginPath(); ctx.roundRect(12, 12, bw, bh, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NET_PAL.text || "#E9F4F8";
    ctx.textAlign = "left";
    ctx.fillText(msg, 22, 31);
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
    const p = this._project(n.x, n.y, n.z);
    const L = _LBL();
    const lines = [
      this._truncate(n.text, 60),
      `${_typeLabel(n)} · ${L.level || "level"} ${n.level} · ${L.likelihood || "likelihood"} ${Math.round((n.probability || 0) * 100)}%`,
    ];
    const ctx = this.ctx;
    ctx.font = "600 11px Manrope, system-ui, sans-serif";
    const bw = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, 320);
    const bh = lines.length * 15 + 12;
    let tx = p.x + 16, ty = p.y - bh / 2;
    if (tx + bw > w) tx = p.x - bw - 16;
    ty = Math.max(4, Math.min(h - bh - 4, ty));
    ctx.fillStyle = NET_PAL.cardBg || "rgba(8,32,50,.97)";
    ctx.strokeStyle = NET_PAL.cardBorder || "#14334A";
    ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NET_PAL.text || "#E9F4F8";
    ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, tx + 9, ty + 16 + i * 15));
  }

  _truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  _drawInfoCard(w, h) {
    const n = this.byId[this.selected];
    if (!n) return;
    const ctx = this.ctx;
    ctx.font = "11px Manrope, system-ui, sans-serif";
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
    const bw = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20, maxW);
    const bh = lines.length * 15 + 16;
    const tx = w - bw - 12, ty = 12;
    ctx.fillStyle = NET_PAL.cardBg || "rgba(8,32,50,.97)";
    ctx.strokeStyle = NET_PAL.cardBorder || "#14334A";
    ctx.beginPath(); ctx.roundRect(tx, ty, bw, bh, 10); ctx.fill(); ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = this._color(n);
    ctx.font = "700 12px Manrope, system-ui, sans-serif";
    titleLines.forEach((l, i) => ctx.fillText(l, tx + 10, ty + 18 + i * 15));
    let dy = ty + 18 + titleLines.length * 15 + 2;
    ctx.fillStyle = NET_PAL.text || "#E9F4F8";
    ctx.font = "11px Manrope, system-ui, sans-serif";
    meta.forEach((l) => { ctx.fillText(l, tx + 10, dy); dy += 15; });
    ctx.fillStyle = NET_PAL.muted || "#9DB8C6";
    const rest = lines.slice(titleLines.length + meta.length);
    rest.forEach((l) => { ctx.fillText(l, tx + 10, dy); dy += 15; });
  }

  /* ------------------------------------------------------------ interaction */
  _bind() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => this._onDown(e));
    window.addEventListener("pointermove", (e) => this._onMove(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    window.addEventListener("pointercancel", (e) => this._onUp(e));
    c.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    c.addEventListener("dblclick", (e) => this._onDbl(e));
    c.addEventListener("pointerleave", () => { this.hovered = null; this._emitHover(null); });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _hit(sx, sy) {
    let best = null, bestD = Infinity;
    this.nodes.forEach((n) => {
      if (this._surfaced(n) < 0.5) return;
      const p = this._project(n.x, n.y, n.z);
      const r = Math.max(10, this._radiusW(n) * p.s + 3);
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d <= r && d < bestD) { best = n; bestD = d; }
    });
    return best;
  }

  _onDown(e) {
    this.canvas.setPointerCapture && e.pointerId != null &&
      (() => { try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {} })();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._lastInteract = performance.now();
    this._camAnim = null;   // user input takes over the camera

    // two pointers → pinch zoom + two-finger pan
    if (this._pointers.size === 2) {
      const pts = [...this._pointers.values()];
      this._pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), dist: this.camera.dist };
      this.drag = null;
      return;
    }
    const p = this._pos(e);
    const node = this._hit(p.x, p.y);
    if (node && e.button !== 2 && !e.shiftKey) {
      const proj = this._project(node.x, node.y, node.z);
      this.drag = { type: "node", node, startX: p.x, startY: p.y, moved: false, depth: proj.depth };
    } else if (e.button === 2 || e.shiftKey) {
      this.drag = { type: "pan", startX: p.x, startY: p.y, moved: false };
    } else {
      this.drag = { type: "orbit", startX: p.x, startY: p.y, yaw: this.camera.yaw, pitch: this.camera.pitch, moved: false };
    }
  }

  _onMove(e) {
    this._lastInteract = performance.now();
    if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // pinch zoom
    if (this._pinch && this._pointers.size === 2) {
      const pts = [...this._pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (d > 0 && this._pinch.d > 0) {
        this.camera.dist = Math.max(220, Math.min(this._maxR * 8, this._pinch.dist * (this._pinch.d / d)));
      }
      return;
    }
    const p = this._pos(e);
    if (this.drag) {
      const dx = p.x - this.drag.startX, dy = p.y - this.drag.startY;
      if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
      if (this.drag.type === "node") {
        // drag on the screen-parallel plane through the node's depth
        const wpt = this._unproject(p.x, p.y, this.drag.depth);
        this.drag.node.x = wpt.x; this.drag.node.y = wpt.y; this.drag.node.z = wpt.z;
      } else if (this.drag.type === "orbit") {
        this.camera.yaw = this.drag.yaw + dx * 0.006;
        this.camera.pitch = Math.max(-1.45, Math.min(1.45, this.drag.pitch + dy * 0.006));
      } else if (this.drag.type === "pan") {
        this._panBy(dx - (this.drag.lastDX || 0), dy - (this.drag.lastDY || 0));
        this.drag.lastDX = dx; this.drag.lastDY = dy;
      }
      return;
    }
    const node = this._hit(p.x, p.y);
    if (node !== this.hovered) {
      this.hovered = node;
      this.canvas.style.cursor = node ? "pointer" : "grab";
      this._emitHover(node ? node.id : null);
    }
  }

  _onUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._pinch = null;
    if (this.drag && this.drag.type === "node" && this.drag.moved) {
      // manual placement becomes the node's new base in the ACTIVE view
      const n = this.drag.node;
      if (this._modeT >= 0.5) {
        n.bx = n.x / this._spread; n.by = n.y / this._spread; n.bz = n.z / this._spread;
      } else {
        n.b2x = n.x / this._spread; n.b2z = n.z / this._spread;
      }
    }
    if (this.drag && this.drag.type === "node" && !this.drag.moved) {
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
    } else if (this.drag && this.drag.type === "orbit" && !this.drag.moved) {
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
    this._lastInteract = performance.now();
    this._camAnim = null;
    const factor = e.deltaY < 0 ? 0.90 : 1.11;
    this.camera.dist = Math.max(220, Math.min(this._maxR * 8, this.camera.dist * factor));
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
  zoom(factor) {
    this.camera.dist = Math.max(220, Math.min(this._maxR * 8, this.camera.dist / factor));
  }

  downloadPNG() {
    const ctx = this.ctx;
    this._draw();
    // composite onto the app background so the export isn't transparent
    const w = this.canvas.width, h = this.canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = NET_PAL.bg || "#051523";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    const a = document.createElement("a");
    a.href = this.canvas.toDataURL("image/png");
    a.download = "riak-causal-web.png";
    a.click();
    ctx.putImageData(img, 0, 0);
    this._draw();
  }
}

window.NetworkRenderer = NetworkRenderer;
Object.defineProperty(window, "POLARITY_COLORS", {
  get() { return { pos: NET_PAL.pos || "#2E8B6E", neg: NET_PAL.neg || "#B4554D", neutral: NET_PAL.neutral || "#8A9086" }; },
});
