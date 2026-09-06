/* ============================================================
   Riak app — subtle cursor ripple layer + micro-interactions
   Purely presentational. No engine / logic touches.
   ============================================================ */
(() => {
"use strict";

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = window.matchMedia("(hover: none), (pointer: coarse)").matches;

/* ---------- 1 · cursor ripple rings (very subtle) ---------- */
const canvas = document.getElementById("cursor-ripples");
if (canvas && !REDUCED) {
  const ctx = canvas.getContext("2d");
  const rings = [];
  let acc = 0, lx = null, ly = null;

  const fit = () => {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * d), h = Math.round(innerHeight * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return d;
  };

  /* interactive zones where rings would be distracting */
  const isQuietZone = (t) =>
    !!(t && t.closest && t.closest("#network-canvas, .math-canvas, textarea, input, select, .modal"));

  const spawn = (x, y, maxR, alpha) => {
    if (rings.length > 40) return;
    rings.push({ x, y, r: 3, maxR, a: alpha });
  };

  addEventListener("pointermove", (e) => {
    if (COARSE) return;
    if (lx !== null) acc += Math.hypot(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
    if (acc > 42) {
      acc = 0;
      if (!isQuietZone(e.target)) spawn(e.clientX, e.clientY, 26 + Math.random() * 12, 0.20);
    }
  }, { passive: true });

  addEventListener("pointerdown", (e) => {
    if (!isQuietZone(e.target)) {
      spawn(e.clientX, e.clientY, 64, 0.30);
      spawn(e.clientX, e.clientY, 36, 0.22);
    }
  }, { passive: true });

  const tick = () => {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const d = fit();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dark = document.documentElement.dataset.theme !== "light";
    const col = dark ? "127,212,232" : "19,111,143";
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.r += (g.maxR - g.r) * 0.09 + 0.3;
      g.a *= 0.93;
      if (g.a < 0.01 || g.r >= g.maxR - 0.5) { rings.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(g.x * d, g.y * d, g.r * d, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col},${g.a})`;
      ctx.lineWidth = 1.1 * d;
      ctx.stroke();
    }
  };
  requestAnimationFrame(tick);
}

/* ---------- 2 · button click ripple ---------- */
document.addEventListener("pointerdown", (e) => {
  if (REDUCED) return;
  const btn = e.target && e.target.closest ? e.target.closest(".btn") : null;
  if (!btn || btn.disabled) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const s = document.createElement("span");
  s.className = "btn-ripple";
  s.style.width = s.style.height = size + "px";
  s.style.left = (e.clientX - r.left - size / 2) + "px";
  s.style.top = (e.clientY - r.top - size / 2) + "px";
  btn.appendChild(s);
  setTimeout(() => s.remove(), 650);
}, { passive: true });

/* ---------- 3 · cursor-reactive panel glow ---------- */
if (!REDUCED && !COARSE) {
  document.addEventListener("pointermove", (e) => {
    const panel = e.target && e.target.closest ? e.target.closest(".panel") : null;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    panel.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    panel.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  }, { passive: true });
}

})();
