/* Minimal dependency-free canvas charting for Wanion. */

const CHART_PAL = window.PALETTE || {};

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function niceAxis(data, lo, hi) {
  if (lo != null && hi != null) return [lo, hi];
  let mn = Infinity, mx = -Infinity;
  for (const v of data) {
    if (v == null) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!isFinite(mn)) { mn = -1; mx = 1; }
  if (mn === mx) { mn -= 0.5; mx += 0.5; }
  const pad = (mx - mn) * 0.12 || 0.1;
  return [mn - pad, mx + pad];
}

function drawAxes(ctx, w, h, pad, yLo, yHi, labels, yFmt) {
  ctx.strokeStyle = CHART_PAL.axis || "#DDD9D0";
  ctx.fillStyle = CHART_PAL.axisText || "#6E746B";
  ctx.font = "10px SF Mono, ui-monospace, monospace";
  ctx.lineWidth = 1;
  const plotH = h - pad.top - pad.bottom;
  // y gridlines
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const y = pad.top + plotH * (1 - frac);
    const val = yLo + (yHi - yLo) * frac;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.strokeStyle = CHART_PAL.grid || "rgba(221,217,208,.6)";
    ctx.stroke();
    ctx.fillText(yFmt(val), 4, y + 3);
  }
  // x labels
  const n = labels.length;
  const maxTicks = 6;
  const step = Math.max(1, Math.ceil(n / maxTicks));
  for (let i = 0; i < n; i += step) {
    const x = pad.left + ((w - pad.left - pad.right) * i) / (n - 1 || 1);
    ctx.fillStyle = CHART_PAL.axisText || "#6E746B";
    ctx.textAlign = "center";
    ctx.fillText(String(labels[i]), x, h - 4);
  }
  ctx.textAlign = "left";
}

function xy(ctx, w, h, pad, i, n, val, yLo, yHi) {
  const x = pad.left + ((w - pad.left - pad.right) * i) / (n - 1 || 1);
  const y = pad.top + (h - pad.top - pad.bottom) * (1 - (val - yLo) / (yHi - yLo || 1));
  return [x, y];
}

/* Line chart with optional confidence band. */
function drawLineChart(canvas, opts) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { top: 12, right: 14, bottom: 22, left: 34 };
  const series = opts.series || [];
  const labels = opts.labels || [];
  const n = labels.length;
  let allVals = [];
  for (const s of series) { allVals = allVals.concat(s.data); if (s.band) allVals = allVals.concat(s.band.lo, s.band.hi); }
  const [yLo, yHi] = niceAxis(allVals, opts.yMin, opts.yMax);
  const yFmt = opts.yFmt || ((v) => v.toFixed(1));
  drawAxes(ctx, w, h, pad, yLo, yHi, labels, yFmt);
  const nSeries = series.length;
  series.forEach((s, si) => {
    // confidence band
    if (s.band) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x, y] = xy(ctx, w, h, pad, i, n, s.band.lo[i], yLo, yHi);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        const [x, y] = xy(ctx, w, h, pad, i, n, s.band.hi[i], yLo, yHi);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = hexToRgba(s.color, 0.12);
      ctx.fill();
    }
    // line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [x, y] = xy(ctx, w, h, pad, i, n, s.data[i], yLo, yHi);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    // zero line if within range
    if (yLo < 0 && yHi > 0) {
      const [, zy] = xy(ctx, w, h, pad, 0, n, 0, yLo, yHi);
      ctx.beginPath();
      ctx.moveTo(pad.left, zy);
      ctx.lineTo(w - pad.right, zy);
      ctx.strokeStyle = CHART_PAL.zeroLine || "rgba(110,116,107,.4)";
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

/* Stacked area chart (camp shares). */
function drawStackedChart(canvas, opts) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { top: 12, right: 14, bottom: 22, left: 34 };
  const layers = opts.layers || [];
  const labels = opts.labels || [];
  const n = labels.length;
  drawAxes(ctx, w, h, pad, 0, 1, labels, (v) => (v * 100).toFixed(0) + "%");
  const plotH = h - pad.top - pad.bottom;
  const plotW = w - pad.left - pad.right;
  // build cumulative y arrays (top edge per layer)
  const tops = layers.map(() => new Array(n).fill(0));
  const bottoms = layers.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let li = 0; li < layers.length; li++) {
      bottoms[li][i] = acc;
      acc += layers[li].data[i] || 0;
      tops[li][i] = acc;
    }
  }
  layers.forEach((layer, li) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad.left + (plotW * i) / (n - 1 || 1);
      const y = pad.top + plotH * (1 - tops[li][i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const x = pad.left + (plotW * i) / (n - 1 || 1);
      const y = pad.top + plotH * (1 - bottoms[li][i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
  });
}

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

window.Charts = { drawLineChart, drawStackedChart, setupCanvas, hexToRgba };
