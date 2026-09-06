/* ============================================================
   Riak landing — interaction engine
   cursor-driven water ripples · scrollytelling · causal graphs
   ============================================================ */
(() => {
"use strict";

/* ---------------- utilities ---------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const d = DPR();
  const w = Math.max(1, Math.round(r.width * d));
  const h = Math.max(1, Math.round(r.height * d));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, d, rw: r.width, rh: r.height };
}

/* visibility registry — canvases only render when on screen */
const visible = new WeakMap();
function watchVisible(el) {
  visible.set(el, false);
  new IntersectionObserver(es => es.forEach(e => visible.set(el, e.isIntersecting)),
    { rootMargin: "80px" }).observe(el);
}

/* ============================================================
   1 · NAV + SCROLL PROGRESS
   ============================================================ */
const nav = document.getElementById("nav");
const progressBar = document.getElementById("scroll-progress-bar");

function onScrollChrome() {
  nav.classList.toggle("is-scrolled", window.scrollY > 24);
  const max = document.documentElement.scrollHeight - innerHeight;
  progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
}
addEventListener("scroll", onScrollChrome, { passive: true });
onScrollChrome();

/* ============================================================
   2 · REVEAL ON SCROLL
   ============================================================ */
const revealIO = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("is-visible"); revealIO.unobserve(e.target); }
  });
}, { threshold: 0.18 });
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.setProperty("--reveal-delay", (i % 4) * 0.08 + "s");
  revealIO.observe(el);
});

/* ============================================================
   3 · MAGNETIC BUTTONS + HERO PARALLAX
   ============================================================ */
const pointer = { x: innerWidth / 2, y: innerHeight / 2, px: innerWidth / 2, py: innerHeight / 2 };
addEventListener("pointermove", e => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

const magnetics = [...document.querySelectorAll(".magnetic")];
const parallaxEls = [...document.querySelectorAll("[data-parallax]")];
let parX = 0, parY = 0;

function tickMagnetics() {
  for (const el of magnetics) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = pointer.x - cx, dy = pointer.y - cy;
    const dist = Math.hypot(dx, dy);
    const R = 130;
    if (dist < R && !REDUCED) {
      const f = (1 - dist / R) * 0.28;
      el.style.transform = `translate(${dx * f}px, ${dy * f}px)`;
    } else if (el.style.transform) {
      el.style.transform = "";
    }
  }
  if (!REDUCED) {
    const tx = (pointer.x / innerWidth - 0.5) * 2;
    const ty = (pointer.y / innerHeight - 0.5) * 2;
    parX = lerp(parX, tx, 0.06); parY = lerp(parY, ty, 0.06);
    for (const el of parallaxEls) {
      const depth = parseFloat(el.dataset.parallax || "0.02");
      el.style.transform = `translate3d(${parX * depth * 420}px, ${parY * depth * 260}px, 0)`;
    }
  }
}

/* ============================================================
   4 · GLOBAL CURSOR RIPPLE LAYER
   ============================================================ */
const ringCanvas = document.getElementById("cursor-ripples");
const ringCtx = ringCanvas.getContext("2d");
const rings = [];
let ringAcc = 0, lastRX = null, lastRY = null;

function spawnRing(x, y, maxR, width, hue) {
  if (REDUCED || rings.length > 90) return;
  rings.push({ x, y, r: 4, maxR, a: 0.5, width, hue });
}
addEventListener("pointermove", e => {
  if (lastRX !== null) ringAcc += Math.hypot(e.clientX - lastRX, e.clientY - lastRY);
  lastRX = e.clientX; lastRY = e.clientY;
  if (ringAcc > 30) {
    ringAcc = 0;
    spawnRing(e.clientX, e.clientY, 34 + Math.random() * 18, 1.2, "127,212,232");
  }
}, { passive: true });
addEventListener("pointerdown", e => {
  spawnRing(e.clientX, e.clientY, 120, 1.8, "127,212,232");
  spawnRing(e.clientX, e.clientY, 70, 1.4, "46,168,201");
}, { passive: true });

function tickRings() {
  const { w, h, d } = fitCanvas(ringCanvas);
  ringCtx.clearRect(0, 0, w, h);
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.r += (g.maxR - g.r) * 0.085 + 0.4;
    g.a *= 0.94;
    if (g.a < 0.012 || g.r >= g.maxR - 0.5) { rings.splice(i, 1); continue; }
    ringCtx.beginPath();
    ringCtx.arc(g.x * d, g.y * d, g.r * d, 0, Math.PI * 2);
    ringCtx.strokeStyle = `rgba(${g.hue},${g.a})`;
    ringCtx.lineWidth = g.width * d;
    ringCtx.stroke();
  }
}

/* ============================================================
   5 · WATER SURFACE (height-field ripple simulation)
   ============================================================ */
class WaterSurface {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scale = opts.scale || 4;
    this.damping = opts.damping || 0.984;
    this.rainEvery = opts.rainEvery || 900;
    this.rainStrength = opts.rainStrength || 260;
    this.touchStrength = opts.touchStrength || 320;
    this.lastRain = 0;
    this.off = document.createElement("canvas");
    this.offCtx = this.off.getContext("2d");
    this.pointerDist = 0;
    this.lastPX = null;
    this.resize();
  }
  resize() {
    const { rw, rh, d } = fitCanvas(this.canvas);
    this.cssW = rw; this.cssH = rh; this.d = d;
    this.W = Math.max(4, Math.round(rw / this.scale));
    this.H = Math.max(4, Math.round(rh / this.scale));
    this.buf1 = new Float32Array(this.W * this.H);
    this.buf2 = new Float32Array(this.W * this.H);
    this.off.width = this.W; this.off.height = this.H;
    this.img = this.offCtx.createImageData(this.W, this.H);
  }
  disturbCSS(x, y, r, s) {
    this.disturb(x / this.scale, y / this.scale, r, s);
  }
  disturb(cx, cy, r, s) {
    const { W, H, buf1 } = this;
    const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(W - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(H - 2, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) buf1[y * W + x] += s * (1 - d / r);
      }
    }
  }
  pointerMove(x, y) {
    if (x < 0 || y < 0 || x > this.cssW || y > this.cssH) { this.lastPX = null; return; }
    if (this.lastPX) this.pointerDist += Math.hypot(x - this.lastPX.x, y - this.lastPX.y);
    this.lastPX = { x, y };
    if (this.pointerDist > 7) {
      this.pointerDist = 0;
      this.disturbCSS(x, y, 2.4, this.touchStrength);
    }
  }
  pointerDown(x, y) { this.disturbCSS(x, y, 7, this.touchStrength * 3.4); }
  step() {
    const { W, H, buf1, buf2, damping } = this;
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x;
        buf2[i] = ((buf1[i - 1] + buf1[i + 1] + buf1[i - W] + buf1[i + W]) * 0.5 - buf2[i]) * damping;
      }
    }
    this.buf1 = buf2; this.buf2 = buf1;
  }
  render() {
    const { W, H, buf1, img } = this;
    const data = img.data;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const depthT = y / H;
      // deep ocean vertical gradient
      const bR = lerp(9, 3, depthT), bG = lerp(30, 13, depthT), bB = lerp(48, 22, depthT);
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const gx = (x > 0 && x < W - 1) ? buf1[i + 1] - buf1[i - 1] : 0;
        const gy = (y > 0 && y < H - 1) ? buf1[i + W] - buf1[i - W] : 0;
        let light = (gx + gy) * 0.9;
        light = clamp(light, -60, 90);
        const spec = Math.max(0, gx * 0.5 - 14);
        const p = i * 4;
        data[p] = bR + light * 0.45 + spec * 1.6;
        data[p + 1] = bG + light * 0.8 + spec * 2.0;
        data[p + 2] = bB + light * 1.05 + spec * 2.2;
        data[p + 3] = 255;
      }
    }
    this.offCtx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }
  tick(now) {
    if (!visible.get(this.canvas)) return;
    if (!REDUCED && now - this.lastRain > this.rainEvery) {
      this.lastRain = now + Math.random() * 400;
      this.disturb(Math.random() * this.W, Math.random() * this.H, 2.5, this.rainStrength);
    }
    this.step();
    this.render();
  }
}

const heroWater = new WaterSurface(document.getElementById("hero-water"),
  { scale: 4, rainEvery: 1100, rainStrength: 220, touchStrength: 300 });
const finalWater = new WaterSurface(document.getElementById("final-water"),
  { scale: 3, damping: 0.986, rainEvery: 650, rainStrength: 380, touchStrength: 520 });
watchVisible(heroWater.canvas);
watchVisible(finalWater.canvas);

function waterPointer(e) {
  for (const w of [heroWater, finalWater]) {
    const r = w.canvas.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) w.pointerMove(e.clientX - r.left, e.clientY - r.top);
    else w.lastPX = null;
  }
}
function waterDown(e) {
  for (const w of [heroWater, finalWater]) {
    const r = w.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) w.pointerDown(x, y);
  }
}
addEventListener("pointermove", waterPointer, { passive: true });
addEventListener("pointerdown", waterDown, { passive: true });

/* ============================================================
   6 · SVG GRAPH BUILDER (scrolly sections)
   ============================================================ */
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function edgePath(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(34, len * 0.14);
  const cx = mx - dy / len * bend, cy = my + dx / len * bend;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function buildGraph(edgesG, nodesG, nodes, edges) {
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });
  const edgeEls = edges.map(e => {
    const p = svgEl("path", { class: "g-edge" + (e.sign ? " " + e.sign : ""), d: edgePath(nodeMap[e.a], nodeMap[e.b]) });
    edgesG.appendChild(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    return { path: p, len, sign: e.sign };
  });
  const nodeEls = nodes.map(n => {
    const g = svgEl("g", { class: "g-node" + (n.root ? " is-root" : "") });
    const r = n.root ? 30 : 24;
    const halo = svgEl("circle", { class: "halo", r: r, opacity: 0 });
    const core = svgEl("circle", { class: "core", r: r });
    g.appendChild(halo); g.appendChild(core);
    const lines = n.label.split("\n");
    const text = svgEl("text", { y: n.labelY !== undefined ? n.labelY : r + 22 });
    lines.forEach((ln, i) => {
      const ts = svgEl("tspan", { x: 0, dy: i === 0 ? 0 : 17 });
      ts.textContent = ln;
      text.appendChild(ts);
    });
    g.appendChild(text);
    if (n.chip) {
      const chip = svgEl("text", { class: "chip " + (n.chip === "+" ? "pos" : "neg"), x: r + 10, y: -r + 6 });
      chip.textContent = n.chip;
      g.appendChild(chip);
    }
    g.setAttribute("transform", `translate(${n.x},${n.y}) scale(0.6)`);
    g.style.opacity = 0;
    nodesG.appendChild(g);
    return { g, halo, x: n.x, y: n.y, r };
  });
  return { edgeEls, nodeEls };
}

function setGraphState(graph, nodeT, edgeT) {
  graph.nodeEls.forEach((ne, i) => {
    const t = easeOut(clamp(nodeT[i], 0, 1));
    ne.g.style.opacity = t;
    ne.g.setAttribute("transform", `translate(${ne.x},${ne.y}) scale(${0.55 + 0.45 * t})`);
    const haloT = clamp((nodeT[i] - 0.55) / 0.45, 0, 1);
    ne.halo.setAttribute("r", ne.r + haloT * 30);
    ne.halo.setAttribute("opacity", (1 - haloT) * 0.55 * (haloT > 0 ? 1 : 0));
  });
  graph.edgeEls.forEach((ee, i) => {
    const t = easeInOut(clamp(edgeT[i], 0, 1));
    ee.path.style.strokeDashoffset = ee.len * (1 - t);
    ee.path.style.opacity = 0.25 + 0.75 * t;
  });
}

/* generic scrolly driver */
function scrollyProgress(section) {
  const r = section.getBoundingClientRect();
  const total = r.height - innerHeight;
  return clamp(-r.top / Math.max(1, total), 0, 1);
}

/* ---------------- section 2 · interactive introduction ---------------- */
const introSection = document.getElementById("concept");
const scenarioCard = document.getElementById("scenario-card");
const scenarioText = document.getElementById("scenario-text");
const introCaption = document.getElementById("intro-caption");

const scenarioWords = scenarioText.textContent.trim().split(/\s+/);
scenarioText.innerHTML = scenarioWords.map(w => `<span class="w">${w}</span>`).join(" ");
const wordEls = [...scenarioText.querySelectorAll(".w")];

const introNodes = [
  { id: "root", label: "Free public\ntransport", x: 105, y: 280, root: true },
  { id: "demand", label: "Transit\nridership", chip: "+", x: 295, y: 280 },
  { id: "traffic", label: "Traffic\ncongestion", chip: "−", x: 480, y: 140 },
  { id: "costs", label: "Transport\ncosts", chip: "−", x: 480, y: 420 },
  { id: "jobs", label: "Employment\naccess", chip: "+", x: 665, y: 70 },
  { id: "income", label: "Disposable\nincome", chip: "+", x: 665, y: 345 },
  { id: "spending", label: "Household\nspending", chip: "+", x: 830, y: 440 },
  { id: "housing", label: "Housing &\nurban dev.", x: 832, y: 180, labelY: -40 },
];
const introEdges = [
  { a: "root", b: "demand", sign: "pos" },
  { a: "demand", b: "traffic", sign: "neg" },
  { a: "demand", b: "costs", sign: "neg" },
  { a: "traffic", b: "jobs", sign: "pos" },
  { a: "costs", b: "income", sign: "pos" },
  { a: "income", b: "spending", sign: "pos" },
  { a: "spending", b: "housing", sign: "pos" },
  { a: "jobs", b: "housing", sign: "pos" },
];
const introGraph = buildGraph(
  document.getElementById("intro-edges"),
  document.getElementById("intro-nodes"),
  introNodes, introEdges
);
// node appearance order & thresholds  [nodeIdx → start, edgeIdx → start]
const introNodeAt = { 0: 0.16, 1: 0.28, 2: 0.40, 3: 0.40, 4: 0.52, 5: 0.52, 6: 0.64, 7: 0.64 };
const introEdgeAt = { 0: 0.22, 1: 0.34, 2: 0.34, 3: 0.46, 4: 0.46, 5: 0.58, 6: 0.70, 7: 0.70 };
const introCaptions = [
  [0.00, "An event drops into the system…"],
  [0.16, "The event becomes a node in the web."],
  [0.28, "First-order consequence: ridership climbs."],
  [0.40, "The ripple branches — roads empty, wallets breathe."],
  [0.52, "Second-order effects surface: jobs within reach, income freed up."],
  [0.64, "The branches reconverge on the city itself."],
  [0.78, "One sentence → eight connected futures. That is Riak."],
];
let introCaptionIdx = -1;

function tickIntro() {
  const p = scrollyProgress(introSection);
  // scenario words type in
  const wt = clamp((p - 0.02) / 0.12, 0, 1);
  const litCount = Math.floor(wt * wordEls.length + 0.0001);
  wordEls.forEach((el, i) => el.classList.toggle("is-on", i < litCount));
  scenarioCard.classList.toggle("is-lit", p > 0.02 && p < 0.9);
  // graph
  const nodeT = introNodes.map((_, i) => clamp((p - (introNodeAt[i] ?? 1)) / 0.09, 0, 1));
  const edgeT = introEdges.map((_, i) => clamp((p - (introEdgeAt[i] ?? 1)) / 0.08, 0, 1));
  setGraphState(introGraph, nodeT, edgeT);
  // caption
  let idx = 0;
  for (let i = 0; i < introCaptions.length; i++) if (p >= introCaptions[i][0]) idx = i;
  if (idx !== introCaptionIdx) {
    introCaptionIdx = idx;
    introCaption.style.opacity = 0;
    setTimeout(() => { introCaption.textContent = introCaptions[idx][1]; introCaption.style.opacity = 1; }, 160);
  }
}

/* ---------------- section 4 · branching & reconvergence ---------------- */
const branchSection = document.getElementById("branching");
const branchCaption = document.getElementById("branch-caption");
const branchNotes = [...document.querySelectorAll(".branch-note")];

const branchNodes = [
  { id: "root", label: "Policy shock", x: 95, y: 270, root: true },
  { id: "a", label: "Market\nreaction", x: 330, y: 100 },
  { id: "b", label: "Public\nresponse", x: 330, y: 270 },
  { id: "c", label: "Regulatory\nfollow-up", x: 330, y: 440 },
  { id: "b1", label: "Protests", x: 565, y: 195 },
  { id: "b2", label: "Adaptation", x: 565, y: 345 },
  { id: "d", label: "Institutional\nchange", x: 800, y: 270, root: true },
];
const branchEdges = [
  { a: "root", b: "a" }, { a: "root", b: "b" }, { a: "root", b: "c" },
  { a: "b", b: "b1" }, { a: "b", b: "b2" },
  { a: "a", b: "d" }, { a: "b1", b: "d" }, { a: "c", b: "d" },
];
const branchGraph = buildGraph(
  document.getElementById("branch-edges"),
  document.getElementById("branch-nodes"),
  branchNodes, branchEdges
);
const branchNodeAt = { 0: 0.10, 1: 0.26, 2: 0.26, 3: 0.26, 4: 0.46, 5: 0.46, 6: 0.66 };
const branchEdgeAt = { 0: 0.18, 1: 0.18, 2: 0.18, 3: 0.38, 4: 0.38, 5: 0.60, 6: 0.60, 7: 0.60 };
let branchNoteIdx = -1;

function tickBranch() {
  const p = scrollyProgress(branchSection);
  const nodeT = branchNodes.map((_, i) => clamp((p - (branchNodeAt[i] ?? 1)) / 0.10, 0, 1));
  const edgeT = branchEdges.map((_, i) => clamp((p - (branchEdgeAt[i] ?? 1)) / 0.09, 0, 1));
  setGraphState(branchGraph, nodeT, edgeT);
  let idx = 0;
  if (p >= 0.66) idx = 3; else if (p >= 0.42) idx = 2; else if (p >= 0.20) idx = 1;
  if (idx !== branchNoteIdx) {
    branchNoteIdx = idx;
    branchNotes.forEach((n, i) => n.classList.toggle("is-on", i === idx));
  }
  branchCaption.textContent = p > 0.9 ? "Branches that meet again compound — Riak scores them together." :
    "Scroll to grow the branches.";
}

/* ============================================================
   7 · 3D CAUSAL RIPPLE — the app's real visualization,
   miniaturized: spherical depth shells, orbital camera, ripple
   wavefronts, causal-flow pulses, Gather/Spread controls.
   ============================================================ */
const netCanvas = document.getElementById("network-canvas");
const netCtx = netCanvas.getContext("2d");
watchVisible(netCanvas);

const net = {
  nodes: [], edges: [],
  cam: { yaw: -0.65, pitch: 0.5, dist: 1650 },
  spread: 1, spreadTarget: 1,
  waveT: 2, maxR: 800,
  cursor: { x: -9999, y: -9999 },
  drag: null, lastInteract: 0,
};

(function buildNet3D() {
  const rng = mulberry32(20240317);
  const counts = [1, 5, 12, 18];
  const labels1 = ["ridership", "traffic", "costs", "sentiment", "commerce"];
  let id = 0;
  const byLevel = [];
  counts.forEach((count, lv) => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const n = {
        id: id++, lv,
        sign: lv === 0 ? 0 : (rng() > 0.34 ? 1 : -1),
        glow: 0, ox: 0, oy: 0,
        label: lv === 0 ? "event" : lv === 1 ? labels1[i] : null,
        bx: 0, by: 0, bz: 0, x: 0, y: 0, z: 0,
      };
      arr.push(n); net.nodes.push(n);
    }
    byLevel.push(arr);
  });
  // edges: each node links to its 1–2 nearest parents; two reconverging links
  for (let lv = 1; lv < counts.length; lv++) {
    for (const n of byLevel[lv]) {
      const k = lv >= 2 && rng() > 0.62 ? 2 : 1;
      const parents = [...byLevel[lv - 1]].sort(() => rng() - 0.5).slice(0, k);
      parents.forEach(p => net.edges.push({ a: p, b: n, w: 0.5 + rng() * 0.5 }));
    }
  }
  net.edges.push({ a: byLevel[1][1], b: byLevel[3][3], w: 0.55 });
  net.edges.push({ a: byLevel[1][3], b: byLevel[3][3], w: 0.55 });

  // layout: fib-sphere directions blended toward parents, shells by depth
  const R = 230;
  const fib = (i, k) => {
    const y = k <= 1 ? 0 : 1 - (i / (k - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = i * 2.399963;
    return { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
  };
  const norm = p => { const l = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / l, y: p.y / l, z: p.z / l }; };
  byLevel.forEach((group, lv) => {
    const shell = lv * R;
    group.forEach((n, i) => {
      if (lv === 0) { n.bx = n.by = n.bz = 0; return; }
      const parents = net.edges.filter(e => e.b === n).map(e => e.a);
      let dir = fib(i, group.length);
      if (parents.length) {
        const s = parents.reduce((m, p) => ({
          x: m.x + p.bx / shell, y: m.y + p.by / shell, z: m.z + p.bz / shell,
        }), { x: 0, y: 0, z: 0 });
        dir = norm({ x: dir.x * 0.75 + s.x, y: dir.y * 0.75 + s.y, z: dir.z * 0.75 + s.z });
      }
      n.bx = dir.x * shell; n.by = dir.y * shell; n.bz = dir.z * shell;
    });
    // spherical repulsion within the shell — siblings never stack
    const minD = shell * Math.min(0.9, 2.0 / Math.sqrt(group.length)) * 0.9;
    for (let it = 0; it < 18 && shell > 0; it++) {
      let moved = false;
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const dx = a.bx - b.bx, dy = a.by - b.by, dz = a.bz - b.bz;
        const d = Math.hypot(dx, dy, dz);
        if (d >= minD || d === 0) continue;
        const push = (minD - d) * 0.3;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        a.bx += ux * push; a.by += uy * push; a.bz += uz * push;
        b.bx -= ux * push; b.by -= uy * push; b.bz -= uz * push;
        const la = Math.hypot(a.bx, a.by, a.bz), lb = Math.hypot(b.bx, b.by, b.bz);
        a.bx *= shell / la; a.by *= shell / la; a.bz *= shell / la;
        b.bx *= shell / lb; b.by *= shell / lb; b.bz *= shell / lb;
        moved = true;
      }
      if (!moved) break;
    }
  });
  net.nodes.forEach(n => { n.x = n.bx; n.y = n.by; n.z = n.bz; });
  net.maxR = counts.length * R;
  net.cam.dist = net.maxR * 2.15;
})();

// orbital camera → perspective projection
function netProject(x, y, z, w, h) {
  const c = net.cam;
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const depth = Math.max(90, z2 + c.dist);
  const focal = Math.min(w, h) * 1.05;
  const s = focal / depth;
  return { x: w / 2 + x1 * s, y: h / 2 - y2 * s, depth, s };
}

netCanvas.addEventListener("pointerdown", e => {
  net.drag = { x: e.clientX, y: e.clientY, yaw: net.cam.yaw, pitch: net.cam.pitch };
  net.lastInteract = performance.now();
});
addEventListener("pointermove", e => {
  const r = netCanvas.getBoundingClientRect();
  net.cursor.x = (e.clientX - r.left) / Math.max(1, r.width);
  net.cursor.y = (e.clientY - r.top) / Math.max(1, r.height);
  if (net.drag) {
    net.cam.yaw = net.drag.yaw + (e.clientX - net.drag.x) * 0.006;
    net.cam.pitch = clamp(net.drag.pitch + (e.clientY - net.drag.y) * 0.006, -1.45, 1.45);
    net.lastInteract = performance.now();
  }
}, { passive: true });
addEventListener("pointerup", () => { net.drag = null; });
netCanvas.addEventListener("pointerleave", () => { net.cursor.x = -9999; net.cursor.y = -9999; });
netCanvas.addEventListener("wheel", e => {
  e.preventDefault();
  net.cam.dist = clamp(net.cam.dist * (e.deltaY < 0 ? 0.92 : 1.09), net.maxR * 0.9, net.maxR * 5);
  net.lastInteract = performance.now();
}, { passive: false });

document.getElementById("demo-gather").addEventListener("click", () => {
  net.spreadTarget = clamp(net.spreadTarget / 1.22, 0.6, 2.3);
});
document.getElementById("demo-spread").addEventListener("click", () => {
  net.spreadTarget = clamp(net.spreadTarget * 1.22, 0.6, 2.3);
});

function tickNetwork(now) {
  if (!visible.get(netCanvas)) return;
  const { w, h, d, rw, rh } = fitCanvas(netCanvas);
  const ctx = netCtx;
  ctx.clearRect(0, 0, w, h);

  // ease spread + gentle idle auto-orbit
  net.spread = lerp(net.spread, net.spreadTarget, 0.08);
  if (now - net.lastInteract > 4500 && !net.drag && !REDUCED) net.cam.yaw += 0.0007;
  const sf = net.spread;
  const P = (x, y, z) => netProject(x * sf, y * sf, z * sf, rw, rh);
  const fog = depth => clamp(1.25 - depth / (net.cam.dist * 2.1), 0.18, 1);

  // ripple wavefront from the centre — re-fired on a slow cycle
  net.waveT += 1 / 60;
  const waveCycle = 4.2;
  const waveU = (net.waveT % waveCycle) / waveCycle;
  const waveR = waveU * net.maxR * 1.15 * sf;

  // depth-shell guide rings (equatorial plane)
  for (let L = 1; L <= 3; L++) {
    const shell = L * 230;
    const ringVis = clamp((waveR - shell * sf) / 120 + 1, 0.35, 1);
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const p = P(Math.cos(a) * shell, 0, Math.sin(a) * shell);
      k === 0 ? ctx.moveTo(p.x * d, p.y * d) : ctx.lineTo(p.x * d, p.y * d);
    }
    ctx.strokeStyle = `rgba(127,212,232,${0.05 * ringVis})`;
    ctx.lineWidth = 1 * d;
    ctx.stroke();
  }

  // wavefront ring
  if (!REDUCED && waveU < 0.92) {
    ctx.beginPath();
    for (let k = 0; k <= 56; k++) {
      const a = (k / 56) * Math.PI * 2;
      const p = P(Math.cos(a) * waveR / sf, 0, Math.sin(a) * waveR / sf);
      k === 0 ? ctx.moveTo(p.x * d, p.y * d) : ctx.lineTo(p.x * d, p.y * d);
    }
    ctx.strokeStyle = `rgba(127,212,232,${0.30 * (1 - waveU)})`;
    ctx.lineWidth = 1.5 * d;
    ctx.stroke();
  }

  // node glow when the wave crosses its shell
  for (const n of net.nodes) {
    const r = Math.hypot(n.bx, n.by, n.bz) * sf;
    const band = Math.abs(r - waveR);
    if (band < 90) n.glow = Math.max(n.glow, 1 - band / 90);
    // cursor displacement — nodes drift aside like water
    const p = P(n.bx, n.by, n.bz);
    const dx = p.x / rw - net.cursor.x;
    const dy = p.y / rh - net.cursor.y;
    const dist = Math.hypot(dx * (rw / rh), dy);
    let tx = 0, ty = 0;
    if (dist < 0.14 && dist > 0.001) {
      const f = (1 - dist / 0.14) * 0.03;
      tx = dx / dist * f * (rw / rh); ty = dy / dist * f;
      n.glow = Math.max(n.glow, (1 - dist / 0.14) * 0.7);
    }
    n.ox = lerp(n.ox, tx, 0.09); n.oy = lerp(n.oy, ty, 0.09);
  }

  const PN = n => {
    const p = P(n.bx, n.by, n.bz);
    return { x: p.x + n.ox * rw, y: p.y + n.oy * rh, depth: p.depth, s: p.s };
  };
  const ctrl = (a, b) => {
    const mx = (a.bx + b.bx) / 2, my = (a.by + b.by) / 2, mz = (a.bz + b.bz) / 2;
    return { x: mx * 1.18, y: my * 1.18, z: mz * 1.18 };
  };

  // edges — curved 3D arcs, far → near
  const drawn = net.edges.map(e => {
    const c = ctrl(e.a, e.b);
    const pts = [];
    let depth = 0;
    for (let k = 0; k <= 12; k++) {
      const u = k / 12, v = 1 - u;
      const wx = v * v * e.a.bx + 2 * v * u * c.x + u * u * e.b.bx;
      const wy = v * v * e.a.by + 2 * v * u * c.y + u * u * e.b.by;
      const wz = v * v * e.a.bz + 2 * v * u * c.z + u * u * e.b.bz;
      const p = P(wx, wy, wz);
      pts.push(p);
      depth += p.depth;
    }
    return { e, pts, depth: depth / 13 };
  }).sort((a, b) => b.depth - a.depth);

  for (const { e, pts, depth } of drawn) {
    ctx.beginPath();
    pts.forEach((p, k) => k === 0 ? ctx.moveTo(p.x * d, p.y * d) : ctx.lineTo(p.x * d, p.y * d));
    ctx.strokeStyle = `rgba(110,160,185,${(0.10 + e.w * 0.22) * fog(depth)})`;
    ctx.lineWidth = (0.7 + e.w) * d;
    ctx.stroke();
  }

  // causal-flow pulses along the strongest links
  if (!REDUCED) {
    const pool = [...net.edges].sort((a, b) => b.w - a.w).slice(0, 12);
    for (const e of pool) {
      const c = ctrl(e.a, e.b);
      const u = (now / 1000 * 0.16 + ((e.a.id * 7 + e.b.id * 13) % 10) / 10) % 1;
      const v = 1 - u;
      const wx = v * v * e.a.bx + 2 * v * u * c.x + u * u * e.b.bx;
      const wy = v * v * e.a.by + 2 * v * u * c.y + u * u * e.b.by;
      const wz = v * v * e.a.bz + 2 * v * u * c.z + u * u * e.b.bz;
      const p = P(wx, wy, wz);
      const fade = Math.sin(u * Math.PI);
      ctx.globalAlpha = 0.7 * fade * fog(p.depth);
      ctx.fillStyle = "#7fd4e8";
      ctx.beginPath();
      ctx.arc(p.x * d, p.y * d, Math.max(1, 4.5 * p.s) * d, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // nodes — 3D spheres with glow, far → near
  const items = net.nodes
    .map(n => ({ n, p: PN(n) }))
    .sort((a, b) => b.p.depth - a.p.depth);
  for (const { n, p } of items) {
    n.glow *= 0.94;
    const breathe = REDUCED ? 1 : 1 + 0.05 * Math.sin(now / 950 + n.id * 1.7);
    const r = Math.max(1.4, (n.lv === 0 ? 13 : 8.5 - n.lv) * 2.2 * p.s * breathe) * d;
    const x = p.x * d, y = p.y * d;
    const f = fog(p.depth);
    const base = n.lv === 0 ? [127, 212, 232] : n.sign > 0 ? [79, 214, 165] : [232, 121, 111];

    if (n.glow > 0.03 || n.lv === 0) {
      const strength = Math.max(n.glow, n.lv === 0 ? 0.5 : 0) * f;
      const grd = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 4.4);
      grd.addColorStop(0, `rgba(${base},${0.30 * strength})`);
      grd.addColorStop(1, `rgba(${base},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r * 4.4, 0, Math.PI * 2); ctx.fill();
    }
    const hi = base.map(c => Math.min(255, c + 90));
    const lo = base.map(c => Math.max(0, c * 0.45 | 0));
    const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, `rgba(${hi},${0.95 * f})`);
    body.addColorStop(0.55, `rgba(${base},${0.9 * f})`);
    body.addColorStop(1, `rgba(${lo},${0.9 * f})`);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${hi},${0.5 * f})`;
    ctx.lineWidth = 0.8 * d;
    ctx.stroke();

    if (n.lv === 0 && !REDUCED) {
      const u = (now / 1400) % 1;
      ctx.beginPath(); ctx.arc(x, y, r + 4 * d + u * 20 * d, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(127,212,232,${0.4 * (1 - u)})`;
      ctx.lineWidth = 1.2 * d;
      ctx.stroke();
    }
    if (n.label) {
      ctx.fillStyle = `rgba(233,244,248,${(n.lv === 0 ? 0.95 : 0.62) * f})`;
      ctx.font = `${n.lv === 0 ? 700 : 600} ${(n.lv === 0 ? 12.5 : 10.5) * d}px Manrope, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(n.label, x, y - r - 7 * d);
    }
  }
}

/* ============================================================
   8 · INTERVENTION LAB
   ============================================================ */
const labCanvas = document.getElementById("intervention-canvas");
const labCtx = labCanvas.getContext("2d");
watchVisible(labCanvas);

const labBtn = document.getElementById("apply-intervention");
const labChip = document.getElementById("intervention-chip");
const labTag = document.getElementById("lab-state-tag");
const labReadout = document.getElementById("lab-readout");
const readoutFill = document.getElementById("readout-bar-fill");
const readoutValue = document.getElementById("readout-value");
const readoutNote = document.getElementById("readout-note");

/* graph: shared node ids, two states (before / after) */
const labNodes = [
  { id: "event", label: "free transit", x: 0.14, y: 0.50, root: true },
  { id: "demand", label: "ridership", sign: 1, x: 0.34, y: 0.50 },
  { id: "congestion", label: "congestion", sign: -1, x: 0.56, y: 0.30 },
  { id: "income", label: "disp. income", sign: 1, x: 0.56, y: 0.72 },
  { id: "commute", label: "commute time", sign: -1, x: 0.76, y: 0.22 },
  { id: "outcome", label: "P(congestion↑)", sign: -1, x: 0.90, y: 0.48, outcome: true },
  // intervention-only node
  { id: "pricing", label: "congestion\npricing", sign: 1, x: 0.56, y: 0.06, inter: true },
];
const labEdges = [
  { a: "event", b: "demand", sign: 1, w: [1, 1] },
  { a: "demand", b: "congestion", sign: -1, w: [0.85, 0.85] },
  { a: "demand", b: "income", sign: 1, w: [0.8, 0.8] },
  { a: "congestion", b: "commute", sign: 1, w: [0.9, 0.55] },   // weakened after
  { a: "commute", b: "outcome", sign: 1, w: [0.9, 0.45] },      // weakened after
  { a: "income", b: "outcome", sign: -1, w: [0.4, 0.4] },
  { a: "pricing", b: "congestion", sign: -1, w: [0, 1], inter: true }, // appears after
  { a: "pricing", b: "outcome", sign: -1, w: [0, 0.7], inter: true },
];
const lab = { t: 0, target: 0, pulse: -1, pulseNode: null };

labBtn.addEventListener("click", () => {
  lab.target = lab.target === 0 ? 1 : 0;
  const after = lab.target === 1;
  labBtn.classList.toggle("is-active", after);
  labChip.classList.toggle("is-active", after);
  labTag.classList.toggle("is-after", after);
  labTag.textContent = after ? "with intervention" : "original scenario";
  labReadout.classList.toggle("is-after", after);
  readoutNote.textContent = after
    ? "intervention applied · trajectory re-computed"
    : "baseline trajectory · no intervention";
  lab.pulse = 0;
  lab.pulseNode = after ? "pricing" : "event";
});

function tickLab() {
  if (!visible.get(labCanvas)) return;
  const { w, h, d, rw, rh } = fitCanvas(labCanvas);
  const ctx = labCtx;
  ctx.clearRect(0, 0, w, h);

  lab.t = lerp(lab.t, lab.target, 0.045);
  if (Math.abs(lab.t - lab.target) < 0.001) lab.t = lab.target;
  const t = easeInOut(clamp(lab.t, 0, 1));
  const after = lab.target === 1;

  // readout animation follows t
  const pval = lerp(0.62, 0.31, t);
  readoutFill.style.width = (pval * 100).toFixed(0) + "%";
  readoutValue.textContent = pval.toFixed(2);

  const nodeById = {};
  for (const n of labNodes) nodeById[n.id] = n;

  // intervention pulse
  if (lab.pulse >= 0 && !REDUCED) {
    lab.pulse += 0.012;
    if (lab.pulse > 1.4) { lab.pulse = -1; }
    else {
      const src = nodeById[lab.pulseNode || "event"];
      const pr = lab.pulse * Math.max(rw, rh) * 0.9;
      ctx.beginPath();
      ctx.arc(src.x * rw * d, src.y * rh * d, pr * d, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${after ? "79,214,165" : "127,212,232"},${0.4 * (1 - lab.pulse / 1.4)})`;
      ctx.lineWidth = 1.6 * d;
      ctx.stroke();
    }
  }

  const nodeVis = n => n.inter ? t : 1;

  // edges
  for (const e of labEdges) {
    const a = nodeById[e.a], b = nodeById[e.b];
    const wgt = lerp(e.w[0], e.w[1], t);
    if (wgt < 0.02) continue;
    const alpha = wgt * 0.75;
    const col = e.sign > 0 ? "79,214,165" : "232,121,111";
    ctx.beginPath();
    ctx.moveTo(a.x * rw * d, a.y * rh * d);
    const mx = (a.x + b.x) / 2 * rw * d, my = (a.y + b.y) / 2 * rh * d;
    ctx.quadraticCurveTo(mx, my - 14 * d, b.x * rw * d, b.y * rh * d);
    ctx.strokeStyle = `rgba(${col},${alpha})`;
    ctx.lineWidth = (0.8 + wgt * 2.2) * d;
    ctx.stroke();
  }
  // nodes
  for (const n of labNodes) {
    const vis = nodeVis(n);
    if (vis < 0.02) continue;
    const x = n.x * rw * d, y = n.y * rh * d;
    const r = (n.root ? 9 : n.outcome ? 8 : 6.5) * d * (0.6 + 0.4 * vis);
    if (n.inter) {
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      grd.addColorStop(0, `rgba(79,214,165,${0.3 * vis})`);
      grd.addColorStop(1, "rgba(79,214,165,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r * 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (n.root) ctx.fillStyle = "#7fd4e8";
    else if (n.inter) ctx.fillStyle = "#4fd6a5";
    else if (n.outcome) ctx.fillStyle = after ? "#4fd6a5" : "#e8796f";
    else ctx.fillStyle = n.sign > 0 ? "rgba(79,214,165,0.9)" : "rgba(232,121,111,0.9)";
    ctx.globalAlpha = vis;
    ctx.fill();
    ctx.globalAlpha = 1;
    // labels (support \n)
    ctx.fillStyle = `rgba(233,244,248,${0.85 * vis})`;
    ctx.font = `600 ${11.5 * d}px Manrope, sans-serif`;
    ctx.textAlign = "center";
    n.label.split("\n").forEach((ln, i) => {
      ctx.fillText(ln, x, y + r + (14 + i * 13) * d);
    });
  }
}

/* ============================================================
   9 · MATHEMATICAL REASONING
   ============================================================ */
const derivSteps = [...document.querySelectorAll(".deriv-step")];
const replayBtn = document.getElementById("replay-derivation");
let derivTimer = null;

function playDerivation() {
  clearTimeout(derivTimer);
  derivSteps.forEach(s => s.classList.remove("is-on"));
  derivSteps.forEach((s, i) => {
    setTimeout(() => s.classList.add("is-on"), REDUCED ? 0 : 260 + i * 420);
  });
}
new IntersectionObserver((es, io) => {
  es.forEach(e => {
    if (e.isIntersecting) { playDerivation(); io.disconnect(); }
  });
}, { threshold: 0.3 }).observe(document.getElementById("derivation"));
replayBtn.addEventListener("click", playDerivation);

/* ============================================================
   10 · COPY BUTTON
   ============================================================ */
document.querySelectorAll(".copy-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const text = btn.dataset.copy || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      ta.remove();
    }
    btn.classList.add("is-copied");
    const lbl = btn.querySelector(".copy-label");
    const prev = lbl.textContent;
    lbl.textContent = "copied";
    setTimeout(() => { btn.classList.remove("is-copied"); lbl.textContent = prev; }, 1600);
  });
});

/* ============================================================
   MASTER LOOP + RESIZE
   ============================================================ */
function tick(now) {
  requestAnimationFrame(tick);
  tickMagnetics();
  tickRings();
  heroWater.tick(now);
  finalWater.tick(now);
  tickNetwork(now);
  tickLab();
}
requestAnimationFrame(tick);

function onScroll() { tickIntro(); tickBranch(); }
addEventListener("scroll", onScroll, { passive: true });
onScroll();

let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    heroWater.resize();
    finalWater.resize();
    onScroll();
  }, 180);
}, { passive: true });

})();