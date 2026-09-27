/* ============================================================================
   Landing page motion: preloader hand-off, particle/candle hero canvas,
   scroll reveals, animated counters and the market marquee.
   Everything degrades gracefully — reduced-motion users get a static page.
   ========================================================================== */
import { DEFAULT_SYMBOLS, SYMBOLS, symbolLabel } from './market.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Hero canvas: drifting price line + rising particles ───────────────── */
function heroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return { start() {}, stop() {} };
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, t = 0, running = false;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  /* Particles: slow-rising dots that read like ticks travelling upward. */
  const particles = Array.from({ length: 70 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: Math.random() * 1.7 + 0.5,
    vy: Math.random() * 0.35 + 0.08,
    vx: (Math.random() - 0.5) * 0.25,
    a: Math.random() * 0.5 + 0.15
  }));

  /* Series: two synthetic price walks drawn as glowing polylines. */
  const makeSeries = (count, amp, colour, baseline) => {
    const pts = [];
    let y = 0;
    for (let i = 0; i < count; i++) {
      y += (Math.random() - 0.48) * amp;
      y = Math.max(-amp * 6, Math.min(amp * 6, y));
      pts.push({ i, y, colour, baseline });
    }
    return pts;
  };
  const series = [
    makeSeries(160, 6, 'rgba(0,215,200,.9)', 0.62),
    makeSeries(160, 4, 'rgba(120,160,255,.55)', 0.72)
  ];

  const drawSeries = (pts, offset) => {
    ctx.beginPath();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = pts[0].colour;
    pts.forEach((p, i) => {
      const x = (i / (pts.length - 1)) * (w + 200) - 100;
      const y = h * p.baseline + Math.sin((i + offset) * 0.09) * 14 + p.y;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  const frame = () => {
    if (!running) return;
    t += 0.6;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(8,13,23,0)');
    grad.addColorStop(1, 'rgba(8,13,23,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.y -= p.vy; p.x += p.vx;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(140,190,255,${p.a * 0.55})`;
      ctx.fill();
    });

    series.forEach((s, i) => drawSeries(s, t * (i ? 0.5 : 1)));
    raf = requestAnimationFrame(frame);
  };

  return {
    start() { if (reduce || running) return; running = true; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); }
  };
}

/* ── Counters ──────────────────────────────────────────────────────────── */
function counters() {
  const nodes = document.querySelectorAll('.count');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      const target = +el.dataset.count;
      const suffix = el.dataset.suffix || '';
      const decimals = +el.dataset.decimals || 0;
      const t0 = performance.now();
      const dur = 1400;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = (target * eased).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  nodes.forEach((n) => io.observe(n));
}

/* ── Scroll reveals ────────────────────────────────────────────────────── */
function reveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('#landing .reveal').forEach((el) => io.observe(el));
}

/* ── Marquee: pseudo-live prices with gentle drift ─────────────────────── */
function marquee() {
  const track = document.getElementById('marqueeTrack');
  if (!track) return;
  const syms = DEFAULT_SYMBOLS.concat(['R_25', 'stpRNG', 'JD50', 'frxEURUSD']);
  const rows = syms.map((s) => ({ sym: s, price: 100 + Math.random() * 2000, chg: (Math.random() - 0.45) * 1.4 }));
  const html = () => rows.map((r) => `
      <span class="mq"><b>${symbolLabel(r.sym) || r.sym}</b>
      ${r.price.toLocaleString('en-US', { minimumFractionDigits: (SYMBOLS[r.sym] || { digits: 2 }).digits, maximumFractionDigits: (SYMBOLS[r.sym] || { digits: 2 }).digits })}
      <em class="${r.chg >= 0 ? 'up' : 'down'}" style="font-style:normal">${r.chg >= 0 ? '▲' : '▼'} ${r.chg.toFixed(2)}%</em></span>`).join('');
  const paint = () => { track.innerHTML = html() + html(); };
  paint();
  setInterval(() => {
    rows.forEach((r) => {
      r.chg += (Math.random() - 0.5) * 0.22;
      r.price *= 1 + (Math.random() - 0.5) * 0.0009;
      r.chg = Math.max(-4, Math.min(4, r.chg));
    });
    paint();
  }, 2600);
}

/* ── Boot the landing animations ───────────────────────────────────────── */
const hero = heroCanvas();
counters();
reveals();
marquee();

window.__bsfLanding = {
  start() { hero.start(); },
  stop() { hero.stop(); }
};
