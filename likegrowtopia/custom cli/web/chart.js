// Self-contained 1m candlestick renderer (no external chart library).
(function () {
  const MAX_CANDLES = 90;

  class CandleChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.candles = [];
      this.symbol = '';
      this._resize = () => this.draw();
      window.addEventListener('resize', this._resize);
    }

    setSymbol(symbol) {
      if (symbol !== this.symbol) this.candles = []; // never show another symbol's candles
      this.symbol = symbol;
    }

    setCandles(list) {
      this.candles = list.slice(-MAX_CANDLES);
      this.draw();
    }

    pushTick(tick) {
      const last = this.candles[this.candles.length - 1];
      if (last && last.t === tick.t) {
        // Update the candle that is still forming.
        this.candles[this.candles.length - 1] = tick;
      } else if (!last || tick.t > last.t) {
        // New candle (either just closed or just starting to form).
        this.candles.push(tick);
        if (this.candles.length > MAX_CANDLES) this.candles.shift();
      }
      this.draw();
    }

    draw() {
      const ctx = this.ctx;
      const canvas = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(0, 0, w, h);

      if (this.candles.length === 0) {
        ctx.fillStyle = '#7d8594';
        ctx.font = '12px monospace';
        ctx.fillText('menunggu data…', 12, 22);
        return;
      }

      const pad = { top: 12, right: 66, bottom: 20, left: 8 };
      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;
      const lows = this.candles.map((c) => c.l);
      const highs = this.candles.map((c) => c.h);
      let min = Math.min.apply(null, lows);
      let max = Math.max.apply(null, highs);
      if (min === max) { min -= 1; max += 1; }
      const padRange = (max - min) * 0.06;
      min -= padRange;
      max += padRange;
      const y = (price) => pad.top + ((max - price) / (max - min)) * plotH;
      const step = plotW / this.candles.length;
      const bodyW = Math.max(1, Math.min(step * 0.7, 14));

      // Horizontal grid + price labels.
      ctx.font = '10px monospace';
      ctx.strokeStyle = '#1c2028';
      ctx.fillStyle = '#7d8594';
      const lines = 5;
      for (let i = 0; i <= lines; i++) {
        const price = min + ((max - min) * i) / lines;
        const yy = y(price);
        ctx.beginPath();
        ctx.moveTo(pad.left, yy);
        ctx.lineTo(w - pad.right, yy);
        ctx.stroke();
        ctx.fillText(price.toFixed(2), w - pad.right + 6, yy + 3);
      }

      // Candles.
      for (let i = 0; i < this.candles.length; i++) {
        const c = this.candles[i];
        const x = pad.left + i * step + step / 2;
        const up = c.c >= c.o;
        const color = up ? '#3fb96f' : '#e05252';
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y(c.h));
        ctx.lineTo(x, y(c.l));
        ctx.stroke();
        const yO = y(c.o);
        const yC = y(c.c);
        const top = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yO - yC));
        ctx.fillStyle = color;
        ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
      }

      // Time labels (first and last candle).
      const fmt = (t) => {
        const d = new Date(t);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      ctx.fillStyle = '#7d8594';
      ctx.fillText(fmt(this.candles[0].t), pad.left, h - 6);
      const lastLabel = fmt(this.candles[this.candles.length - 1].t);
      ctx.fillText(lastLabel, w - pad.right - ctx.measureText(lastLabel).width, h - 6);
    }
  }

  window.CandleChart = CandleChart;
})();
