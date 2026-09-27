/* ============================================================================
   Market catalogue + canvas chart renderer.
   Symbol metadata mirrors the subset of Deriv's `active_symbols` we expose in
   the builder cascades; live prices always come from the Deriv API.
   ========================================================================== */

export const SYMBOLS = {
  /* Continuous Indices — Volatility */
  R_10:    { name: 'Volatility 10 Index',      sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  R_25:    { name: 'Volatility 25 Index',      sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  R_50:    { name: 'Volatility 50 Index',      sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  R_75:    { name: 'Volatility 75 Index',      sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  R_100:   { name: 'Volatility 100 Index',     sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  '1HZ10V':  { name: 'Volatility 10 (1s) Index',  sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  '1HZ25V':  { name: 'Volatility 25 (1s) Index',  sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  '1HZ50V':  { name: 'Volatility 50 (1s) Index',  sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  '1HZ75V':  { name: 'Volatility 75 (1s) Index',  sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  '1HZ100V': { name: 'Volatility 100 (1s) Index', sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  RDBEAR:  { name: 'Bear Market Index',        sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  RDBULL:  { name: 'Bull Market Index',        sub: 'Continuous Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  /* Crash / Boom */
  BOOM300N:  { name: 'Boom 300 Index',  sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  BOOM500:   { name: 'Boom 500 Index',  sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  BOOM1000:  { name: 'Boom 1000 Index', sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  CRASH300N: { name: 'Crash 300 Index', sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  CRASH500:  { name: 'Crash 500 Index', sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  CRASH1000: { name: 'Crash 1000 Index', sub: 'Crash/Boom Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  /* Step / Jump / Range Break */
  stpRNG:   { name: 'Step Index',           sub: 'Step Indices', digits: 2, pip: 0.1, min: 0.35, max: 30000 },
  stpRNG2:  { name: 'Step Index 200',       sub: 'Step Indices', digits: 2, pip: 0.1, min: 0.35, max: 30000 },
  stpRNG3:  { name: 'Step Index 300',       sub: 'Step Indices', digits: 2, pip: 0.1, min: 0.35, max: 30000 },
  stpRNG4:  { name: 'Step Index 400',       sub: 'Step Indices', digits: 2, pip: 0.1, min: 0.35, max: 30000 },
  stpRNG5:  { name: 'Step Index 500',       sub: 'Step Indices', digits: 2, pip: 0.1, min: 0.35, max: 30000 },
  JD10:  { name: 'Jump 10 Index',  sub: 'Jump Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  JD25:  { name: 'Jump 25 Index',  sub: 'Jump Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  JD50:  { name: 'Jump 50 Index',  sub: 'Jump Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  JD75:  { name: 'Jump 75 Index',  sub: 'Jump Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  JD100: { name: 'Jump 100 Index', sub: 'Jump Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  RB100: { name: 'Range Break 100 Index', sub: 'Range Break Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  RB200: { name: 'Range Break 200 Index', sub: 'Range Break Indices', digits: 2, pip: 0.01, min: 0.35, max: 30000 },
  /* Forex majors */
  frxEURUSD: { name: 'EUR/USD', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 },
  frxGBPUSD: { name: 'GBP/USD', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 },
  frxUSDJPY: { name: 'USD/JPY', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 },
  frxAUDUSD: { name: 'AUD/USD', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 },
  frxUSDCAD: { name: 'USD/CAD', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 },
  frxUSDCHF: { name: 'USD/CHF', sub: 'Major Pairs', digits: 5, pip: 0.00001, min: 0.35, max: 200 }
};

export const MARKET_TREE = {
  synthetics: {
    label: 'Deriv indices',
    submarkets: {
      'Continuous Indices': ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V', 'RDBEAR', 'RDBULL'],
      'Crash/Boom Indices': ['BOOM300N', 'BOOM500', 'BOOM1000', 'CRASH300N', 'CRASH500', 'CRASH1000'],
      'Step Indices': ['stpRNG', 'stpRNG2', 'stpRNG3', 'stpRNG4', 'stpRNG5'],
      'Jump Indices': ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
      'Range Break Indices': ['RB100', 'RB200']
    }
  },
  forex: {
    label: 'Forex',
    submarkets: { 'Major Pairs': Object.keys(SYMBOLS).filter((s) => s.startsWith('frx')) }
  }
};

export const DEFAULT_SYMBOLS = ['R_100', 'R_50', 'R_75', 'R_10', '1HZ100V', '1HZ10V', 'CRASH300N', 'BOOM300N'];

export function symbolLabel(code) {
  const s = SYMBOLS[code];
  return s ? s.name : String(code).replace(/_/g, ' ');
}
export function symbolDigits(code) {
  const s = SYMBOLS[code];
  return s ? s.digits : 2;
}
export function lastDigit(quote, digits) {
  const s = Number(quote).toFixed(digits == null ? 2 : digits);
  return Number(s[s.length - 1]);
}
export function submarketOf(code) {
  for (const [key, m] of Object.entries(MARKET_TREE)) {
    for (const [sub, list] of Object.entries(m.submarkets)) if (list.includes(code)) return { market: key, sub };
  }
  return { market: 'synthetics', sub: 'Continuous Indices' };
}

/* ══════════════════════════════════════════════════════════════════════════
   CandleChart — dependency-free canvas chart.
     · streaming updates via pushTick()
     · crosshair + OHLC readout in the header
     · auto-scaling price axis and time axis
   ═════════════════════════════════════════════════════════════════════════ */
export class CandleChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.granularity = opts.granularity || 60;
    this.symbol = opts.symbol || 'R_100';
    this.digits = opts.digits || 2;
    this.overlays = [];              // {type:'line'|'marker'|'band', ...}
    this.crosshair = null;
    this.onHover = opts.onHover || null;
    this.up = opts.up || '#12a150';
    this.down = opts.down || '#d21f26';
    this.grid = opts.grid || '#e6eaf2';
    this.axis = opts.axis || '#8c97ab';
    this.buyMarkers = [];
    this._bind();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas.parentElement || canvas);
    this.draw();
  }

  destroy() { this._ro.disconnect(); this._unbind(); }

  setData(candles) { this.candles = candles.slice(); this.draw(); }
  setSymbol(symbol, digits) { this.symbol = symbol; if (digits != null) this.digits = digits; this.draw(); }
  setGranularity(g) { this.granularity = g; this.draw(); }

  pushTick(t) {
    if (!this.candles.length) return;
    const g = this.granularity;
    const bucket = Math.floor(t.epoch / g) * g;
    const last = this.candles[this.candles.length - 1];
    if (bucket <= last.time) {
      last.close = t.quote;
      last.high = Math.max(last.high, t.quote);
      last.low = Math.min(last.low, t.quote);
    } else {
      this.candles.push({ time: bucket, open: last.close, high: Math.max(last.close, t.quote), low: Math.min(last.close, t.quote), close: t.quote });
      if (this.candles.length > 400) this.candles.shift();
    }
    this.draw();
  }

  markTrade(kind, price) {
    this.buyMarkers.push({ kind, price, time: Date.now() / 1000 });
    if (this.buyMarkers.length > 40) this.buyMarkers.shift();
    this.draw();
  }

  _bind() {
    this._move = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.crosshair = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    };
    this._leave = () => { this.crosshair = null; this.draw(); };
    this.canvas.addEventListener('mousemove', this._move);
    this.canvas.addEventListener('mouseleave', this._leave);
  }
  _unbind() {
    this.canvas.removeEventListener('mousemove', this._move);
    this.canvas.removeEventListener('mouseleave', this._leave);
  }

  _layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 320;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, padL: 8, padR: 66, padT: 10, padB: 24 };
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, padL, padR, padT, padB } = this._layout();
    ctx.clearRect(0, 0, w, h);

    const data = this.candles;
    if (!data.length) {
      ctx.fillStyle = this.axis; ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.fillText('Waiting for market data…', padL + 12, h / 2);
      return;
    }
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    let hi = -Infinity, lo = Infinity;
    for (const c of data) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); }
    const span = Math.max(hi - lo, 1e-9);
    const x = (i) => padL + (i + 0.5) * (plotW / data.length);
    const y = (p) => padT + plotH - ((p - lo) / span) * plotH;

    /* grid + price axis */
    ctx.font = '10.5px Inter, system-ui, sans-serif';
    ctx.strokeStyle = this.grid; ctx.fillStyle = this.axis; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const yy = padT + (plotH / 5) * i;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      const price = hi - (span / 5) * i;
      ctx.fillText(price.toFixed(this.digits), padL + plotW + 7, yy + 3.5);
    }
    /* time axis */
    const step = Math.max(1, Math.floor(data.length / 6));
    for (let i = 0; i < data.length; i += step) {
      const d = new Date(data[i].time * 1000);
      const lbl = this.granularity >= 86400
        ? d.toISOString().slice(5, 10)
        : d.toTimeString().slice(0, 5);
      ctx.fillText(lbl, x(i) - 14, h - 7);
    }

    /* candles */
    const bw = Math.max(1.5, (plotW / data.length) * 0.62);
    data.forEach((c, i) => {
      const bull = c.close >= c.open;
      ctx.strokeStyle = bull ? this.up : this.down;
      ctx.fillStyle = bull ? this.up : this.down;
      const cx = x(i);
      ctx.beginPath(); ctx.moveTo(cx, y(c.high)); ctx.lineTo(cx, y(c.low)); ctx.lineWidth = 1; ctx.stroke();
      const top = y(Math.max(c.open, c.close));
      const bh = Math.max(1, Math.abs(y(c.open) - y(c.close)));
      ctx.fillRect(cx - bw / 2, top, bw, bh);
    });

    /* trade markers */
    this.buyMarkers.forEach((m) => {
      const i = data.findIndex((c) => c.time >= m.time - this.granularity);
      const idx = i < 0 ? data.length - 1 : i;
      const cx = x(idx);
      const px = y(Math.min(Math.max(m.price, lo), hi));
      ctx.fillStyle = m.kind === 'buy' ? this.up : this.down;
      ctx.beginPath();
      ctx.moveTo(cx, px - 12); ctx.lineTo(cx - 5, px - 3); ctx.lineTo(cx + 5, px - 3);
      ctx.closePath(); ctx.fill();
    });

    /* last price line */
    const last = data[data.length - 1];
    const lx = y(last.close);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(0,167,157,.75)';
    ctx.beginPath(); ctx.moveTo(padL, lx); ctx.lineTo(padL + plotW, lx); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#00a79d';
    ctx.fillRect(padL + plotW + 2, lx - 8, 62, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(last.close.toFixed(this.digits), padL + plotW + 7, lx + 3.5);

    /* crosshair */
    if (this.crosshair) {
      const { x: mx, y: my } = this.crosshair;
      if (mx > padL && mx < padL + plotW && my > padT && my < padT + plotH) {
        ctx.strokeStyle = 'rgba(15,23,42,.28)';
        ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + plotH); ctx.moveTo(padL, my); ctx.lineTo(padL + plotW, my); ctx.stroke();
        const idx = Math.min(data.length - 1, Math.max(0, Math.round((mx - padL) / (plotW / data.length) - 0.5)));
        if (this.onHover) this.onHover(data[idx], idx === data.length - 1);
      }
    }
  }
}
