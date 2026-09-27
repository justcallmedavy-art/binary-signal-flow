#!/usr/bin/env node
/* ============================================================================
   Meridian Terminal — optional backend
   ─────────────────────────────────────────────────────────────────────────
   Two jobs:
     1. Serve the static front end over http:// (which the app needs for
        localStorage + module-free relative fetches, and which makes this
        origin usable as an OAuth-style redirect target later).
     2. Expose /api/market/* backed by a KEYED market-data provider, so the
        browser never sees a credential. Secrets come from environment
        variables only; nothing is ever echoed to the client.

   Deliberately dependency-free: Node's stdlib only, no npm install.

   Run:
     DATA_PROVIDER=twelvedata TWELVEDATA_API_KEY=xxx node server/server.js
     (or copy .env.example → .env and pass it through your process manager)

   Endpoints (all GET, all JSON, all normalised to the shapes the front end
   already expects from its built-in providers):
     /api/market/health
     /api/market/candles?symbol=BTCUSD&timeframe=1h&limit=400
     /api/market/tickers?symbols=BTCUSD,ETHUSD
     /api/market/markets
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT || '8787', 10);
const ROOT = path.resolve(__dirname, '..');           // the app directory
const PROVIDER = (process.env.DATA_PROVIDER || 'none').toLowerCase();
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || '20000', 10);
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || '90', 10);
const MAX_LIMIT = parseInt(process.env.MAX_BARS || '1000', 10);

/* ── Instrument mapping: canonical id → provider-native symbol ─────────── */
const INSTRUMENTS = {
  BTCUSD: { twelvedata: 'BTC/USD', polygon: 'X:BTCUSD' },
  ETHUSD: { twelvedata: 'ETH/USD', polygon: 'X:ETHUSD' },
  SOLUSD: { twelvedata: 'SOL/USD', polygon: 'X:SOLUSD' },
  XRPUSD: { twelvedata: 'XRP/USD', polygon: 'X:XRPUSD' },
  BNBUSD: { twelvedata: 'BNB/USD', polygon: 'X:BNBUSD' },
  ADAUSD: { twelvedata: 'ADA/USD', polygon: 'X:ADAUSD' },
  DOGEUSD: { twelvedata: 'DOGE/USD', polygon: 'X:DOGEUSD' },
  LTCUSD: { twelvedata: 'LTC/USD', polygon: 'X:LTCUSD' },
  EURUSD: { twelvedata: 'EUR/USD', polygon: 'C:EURUSD' },
  XAUUSD: { twelvedata: 'XAU/USD', polygon: 'C:XAUUSD' }
};

const TIMEFRAMES = {
  '1m': { twelvedata: '1min', polygon: { mult: 1, span: 'minute' } },
  '5m': { twelvedata: '5min', polygon: { mult: 5, span: 'minute' } },
  '15m': { twelvedata: '15min', polygon: { mult: 15, span: 'minute' } },
  '1h': { twelvedata: '1h', polygon: { mult: 1, span: 'hour' } },
  '4h': { twelvedata: '4h', polygon: { mult: 4, span: 'hour' } },
  '1D': { twelvedata: '1day', polygon: { mult: 1, span: 'day' } },
  '1W': { twelvedata: '1week', polygon: { mult: 1, span: 'week' } }
};

/* ── Provider adapters ───────────────────────────────────────────────────
   Each adapter implements fetchCandles / fetchTickers and normalises to:
     candle = {time, open, high, low, close, volume}
     ticker = {id, price, changePct24h, volume24h, high24h, low24h, source}
   Add a provider by adding one object — the front end needs no change.
   ──────────────────────────────────────────────────────────────────────── */
const ADAPTERS = {
  twelvedata: {
    label: 'Twelve Data',
    needs: ['TWELVEDATA_API_KEY'],
    ready: () => !!process.env.TWELVEDATA_API_KEY,
    symbol: (id) => (INSTRUMENTS[id] || {})[process.env.DATA_PROVIDER] || id,
    async fetchCandles(id, tf, limit) {
      const sym = ADAPTERS.twelvedata.symbol(id);
      const interval = (TIMEFRAMES[tf] || {}).twelvedata;
      if (!interval) throw httpError(400, 'Unsupported timeframe for this provider: ' + tf);
      const endpoint = 'https://api.twelvedata.com/time_series?' + new URLSearchParams({
        symbol: sym, interval, outputsize: String(limit), order: 'ASC',
        apikey: process.env.TWELVEDATA_API_KEY
      }).toString();
      const data = await getJSON(endpoint);
      if (data.status === 'error' || !Array.isArray(data.values)) {
        throw httpError(502, 'Provider error: ' + (data.message || 'no values returned'));
      }
      const candles = data.values.map((v) => ({
        time: Math.floor(new Date(v.datetime.replace(' ', 'T') + 'Z').getTime() / 1000),
        open: parseFloat(v.open), high: parseFloat(v.high),
        low: parseFloat(v.low), close: parseFloat(v.close),
        volume: v.volume != null ? parseFloat(v.volume) : null
      })).filter((c) => isFinite(c.close) && isFinite(c.time));
      return { candles, meta: { provider: 'twelvedata', dataQuality: 'live', hasVolume: true, nativeSymbol: sym } };
    },
    async fetchTickers(ids) {
      const symbolList = ids.join(',');
      const endpoint = 'https://api.twelvedata.com/quote?' + new URLSearchParams({
        symbol: symbolList, apikey: process.env.TWELVEDATA_API_KEY
      }).toString();
      const raw = await getJSON(endpoint);
      const rows = Array.isArray(raw) ? raw : (raw.data && Array.isArray(raw.data) ? raw.data : [raw]);
      const tickers = {};
      ids.forEach((id, i) => {
        const s = ADAPTERS.twelvedata.symbol(id);
        const row = rows.find((r) => r && (r.symbol === s || r.symbol === id)) || rows[i];
        if (!row || row.close == null) return;
        const price = parseFloat(row.close);
        const prev = row.previous_close != null ? parseFloat(row.previous_close) : null;
        tickers[id] = {
          id, price,
          changePct24h: row.percent_change != null ? parseFloat(row.percent_change)
            : (prev ? ((price - prev) / prev) * 100 : null),
          volume24h: row.volume != null ? parseFloat(row.volume) : null,
          high24h: row.high != null ? parseFloat(row.high) : null,
          low24h: row.low != null ? parseFloat(row.low) : null,
          source: 'twelvedata'
        };
      });
      return { tickers, meta: { provider: 'twelvedata', dataQuality: 'live' } };
    }
  },

  polygon: {
    label: 'Polygon.io',
    needs: ['POLYGON_API_KEY'],
    ready: () => !!process.env.POLYGON_API_KEY,
    symbol: (id) => (INSTRUMENTS[id] || {}).polygon || id,
    async fetchCandles(id, tf, limit) {
      const sym = ADAPTERS.polygon.symbol(id);
      const bar = (TIMEFRAMES[tf] || {}).polygon;
      if (!bar) throw httpError(400, 'Unsupported timeframe for this provider: ' + tf);
      const to = Math.floor(Date.now() / 1000);
      const step = { minute: 60, hour: 3600, day: 86400, week: 604800 }[bar.span];
      const from = to - step * bar.mult * limit * 2;
      const endpoint = 'https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(sym) +
        '/range/' + bar.mult + '/' + bar.span + '/' + from + '/' + to +
        '?adjusted=true&sort=asc&limit=50000&apiKey=' + encodeURIComponent(process.env.POLYGON_API_KEY);
      const data = await getJSON(endpoint);
      if (!Array.isArray(data.results)) throw httpError(502, 'Provider error: ' + (data.error || data.message || 'no results'));
      const candles = data.results.slice(-limit).map((r) => ({
        time: Math.floor(r.t / 1000), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v != null ? r.v : null
      }));
      return { candles, meta: { provider: 'polygon', dataQuality: 'live', hasVolume: true, nativeSymbol: sym } };
    },
    async fetchTickers(ids) {
      const tickers = {};
      for (const id of ids.slice(0, 20)) {
        const sym = ADAPTERS.polygon.symbol(id);
        const prev = await getJSON('https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(sym) +
          '/prev?adjusted=true&apiKey=' + encodeURIComponent(process.env.POLYGON_API_KEY));
        const r = prev.results && prev.results[0];
        if (!r) continue;
        tickers[id] = {
          id, price: r.c, changePct24h: r.o ? ((r.c - r.o) / r.o) * 100 : null,
          volume24h: r.v != null ? r.v : null, high24h: r.h != null ? r.h : null,
          low24h: r.l != null ? r.l : null, source: 'polygon'
        };
      }
      return { tickers, meta: { provider: 'polygon', dataQuality: 'live' } };
    }
  },

  /* 'none' is the honest default: the proxy is reachable but unconfigured. */
  none: {
    label: 'Not configured',
    needs: [],
    ready: () => false,
    symbol: (id) => id,
    async fetchCandles() { throw httpError(501, 'The backend proxy has no provider configured. Set DATA_PROVIDER and the matching API key in the environment. Public providers (Binance, CoinGecko) need no key and are used directly by the browser.'); },
    async fetchTickers() { throw httpError(501, 'The backend proxy has no provider configured.'); }
  }
};

function activeAdapter() {
  const a = ADAPTERS[PROVIDER] || ADAPTERS.none;
  return a;
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ── HTTP helpers ──────────────────────────────────────────────────────── */
const NODE_FETCH = typeof fetch === 'function';   // Node 18+
function getJSON(endpoint) {
  if (!NODE_FETCH) return Promise.reject(httpError(501, 'This server needs Node 18+ (global fetch) to reach upstream providers.'));
  return fetch(endpoint, { headers: { accept: 'application/json' } }).then(async (res) => {
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { throw httpError(502, 'Upstream returned non-JSON (' + res.status + ')'); }
    if (!res.ok) throw httpError(res.status === 429 ? 429 : 502, 'Upstream error ' + res.status);
    return body;
  });
}

/* ── Caching + rate limiting ───────────────────────────────────────────── */
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  cache.delete(key);
  return null;
}
function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > 300) {
    for (const [k, v] of cache) { if (v.expires < Date.now()) cache.delete(k); }
  }
}
const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, reset: now + 60000 };
  if (now > b.reset) { b.count = 0; b.reset = now + 60000; }
  b.count++;
  buckets.set(ip, b);
  return { limited: b.count > RATE_LIMIT, retryAfter: Math.ceil((b.reset - now) / 1000) };
}

/* ── Input validation (never trust the query string) ───────────────────── */
function sanitizeId(raw) {
  const id = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(id)) throw httpError(400, 'Invalid instrument identifier.');
  if (!Object.prototype.hasOwnProperty.call(INSTRUMENTS, id)) {
    throw httpError(400, 'Instrument not enabled on this server: ' + id);
  }
  return id;
}
function sanitizeLimit(raw) {
  const n = parseInt(raw, 10);
  if (!isFinite(n)) return 300;
  return Math.min(Math.max(n, 20), MAX_LIMIT);
}

/* ── Static file serving (app root, traversal-safe) ────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(ROOT, '.' + rel);
  if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': stat.size
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ── Router ────────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  // WHATWG URL rather than the deprecated url.parse().
  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Malformed request URL');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname || '/');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Malformed request path');
    return;
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  function send(status, body, extraHeaders) {
    const payload = JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }, extraHeaders || {}));
    res.end(payload);
  }

  if (!pathname.startsWith('/api/market/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }
    serveStatic(req, res, pathname);
    return;
  }

  const rl = rateLimited(ip);
  if (rl.limited) {
    send(429, { error: 'Rate limit exceeded. Slow down.', code: 'RATE_LIMITED' }, { 'retry-after': String(rl.retryAfter) });
    return;
  }

  const adapter = activeAdapter();
  const action = pathname.slice('/api/market/'.length);

  try {
    if (action === 'health') {
      send(200, {
        ok: true,
        proxy: 'meridian-market-proxy/1.0',
        provider: PROVIDER,
        providerLabel: adapter.label,
        configured: adapter.ready(),
        requiresEnv: adapter.needs,
        enabledInstruments: Object.keys(INSTRUMENTS),
        rateLimitPerMinute: RATE_LIMIT,
        cacheTtlMs: CACHE_TTL_MS,
        note: 'No credential is ever returned to the browser. The front end reaches this proxy through MT.CONFIG.proxyBase.'
      });
      return;
    }

    const ENDPOINTS = ['candles', 'tickers', 'markets'];
    if (ENDPOINTS.indexOf(action) < 0) {
      send(404, { error: 'Unknown proxy endpoint: ' + action, available: ['health'].concat(ENDPOINTS) });
      return;
    }

    // Validate the request BEFORE the configuration gate, so a bad symbol or an
    // unknown timeframe reports the real problem (400) rather than a blanket
    // "not configured" (501) that hides the actual mistake.
    let request;
    if (action === 'candles') {
      const tf = String(parsed.searchParams.get('timeframe') || '1h');
      if (!(tf in TIMEFRAMES)) throw httpError(400, 'Unsupported timeframe: ' + tf);
      request = {
        id: sanitizeId(parsed.searchParams.get('symbol')),
        timeframe: tf,
        limit: sanitizeLimit(parsed.searchParams.get('limit')),
        key: null
      };
      request.key = 'candles|' + request.id + '|' + tf + '|' + request.limit;
    } else if (action === 'tickers') {
      const raw = String(parsed.searchParams.get('symbols') || '').split(',').filter(Boolean);
      if (!raw.length) throw httpError(400, 'No instruments requested. Pass ?symbols=BTCUSD,ETHUSD');
      request = { ids: raw.map(sanitizeId).slice(0, 25), key: 'tickers|' + raw.join(',') };
    } else {
      request = { ids: Object.keys(INSTRUMENTS), key: 'markets|' + PROVIDER };
    }

    if (!adapter.ready()) {
      send(501, {
        error: 'No keyed provider is configured on this server. The app works without it via Binance, CoinGecko, or the built-in simulator.',
        code: 'NOT_CONFIGURED', requiresEnv: adapter.needs
      });
      return;
    }

    const cached = cacheGet(request.key);
    if (cached) { send(200, cached); return; }

    let out;
    if (action === 'candles') {
      out = await adapter.fetchCandles(request.id, request.timeframe, request.limit);
    } else if (action === 'tickers') {
      out = await adapter.fetchTickers(request.ids);
    } else {
      const res2 = await adapter.fetchTickers(request.ids);
      const markets = Object.keys(res2.tickers).map((id) => Object.assign({ name: id }, res2.tickers[id]));
      out = {
        markets,
        meta: Object.assign({}, res2.meta, {
          note: 'Keyed providers generally do not publish market capitalisation; that column will be empty for them.'
        })
      };
    }
    cacheSet(request.key, out);
    send(200, out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    // Never leak upstream URLs, keys or stack traces to the client.
    send(status, { error: (e && e.message) || 'Proxy failure', code: status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'PROXY_ERROR' });
  }
});

server.listen(PORT, () => {
  const adapter = activeAdapter();
  console.log('Meridian Terminal backend');
  console.log('  app      http://localhost:' + PORT + '/');
  console.log('  proxy    http://localhost:' + PORT + '/api/market/health');
  console.log('  provider ' + PROVIDER + ' (' + adapter.label + ')' + (adapter.ready() ? ' — configured' : ' — NOT configured'));
  if (!adapter.ready() && adapter.needs.length) {
    console.log('  note     set ' + adapter.needs.join(', ') + ' to enable the keyed provider');
  }
});
