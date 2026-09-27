/* ============================================================================
   Deriv API client — WebSocket v3 transport + OAuth entry point.

   Responsibilities
     · one socket, request/response correlation by req_id
     · streaming subscriptions (ticks, candles, open contracts, balance)
     · OAuth redirect in, token hand-off, `authorize` call
     · automatic reconnect with backoff while subscriptions are alive

   The token never leaves this module: views talk to `api` only.
   ========================================================================== */
import { CONFIG, appId, STORE } from './config.js';

export class DerivError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'DerivError';
    this.code = code;
  }
}

export class DerivAPI extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.reqId = 1;
    this.pending = new Map();       // req_id -> {resolve, reject, stream}
    this.bySubscription = new Map(); // subscription id -> handler
    this.openStreams = new Map();   // key -> payload (for auto-resubscribe)
    this.connected = false;
    this.ready = false;
    this.retries = 0;
    this.manualClose = false;
    this.authorized = false;
    this.token = null;
    this.auth = null;               // full authorize payload from Deriv
  }

  /* ── Connection ─────────────────────────────────────────────────────── */
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return Promise.resolve(this.ws);
    this.manualClose = false;
    const url = `${CONFIG.wsUrl}?app_id=${appId()}&l=EN&brand=deriv`;
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      const ready = () => {
        this.connected = true; this.ready = true; this.retries = 0;
        this.emit('open');
        this.resubscribeAll();
        resolve(this.ws);
      };
      this.ws.onopen = ready;
      this.ws.onmessage = (ev) => this.handle(ev.data);
      this.ws.onerror = () => { this.emit('error', new DerivError('WS_ERROR', 'Connection error')); };
      this.ws.onclose = () => {
        this.connected = false; this.ready = false;
        this.emit('close');
        for (const [, p] of this.pending) p.reject(new DerivError('DISCONNECTED', 'Socket closed'));
        this.pending.clear();
        if (!this.manualClose) this.scheduleReconnect();
      };
      setTimeout(() => { if (!this.connected) reject(new DerivError('TIMEOUT', 'Could not reach Deriv')); }, 9000);
    });
  }

  scheduleReconnect() {
    /* Give up after a handful of attempts: a blocked or geo-fenced network
       never recovers, and the caller exposes a manual retry instead. */
    if (this.retries >= 8) { this.emit('giveup', { attempts: this.retries }); return; }
    this.retries++;
    const delay = Math.min(1000 * Math.pow(1.6, this.retries), 20000);
    this.emit('reconnecting', { attempt: this.retries, delay });
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      this.connect().then(() => {
        if (this.token) this.authorize(this.token).catch(() => { /* stays logged out */ });
      }).catch(() => { /* onclose fires again */ });
    }, delay);
  }

  resetRetries() { this.retries = 0; }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this._rt);
    if (this.ws) this.ws.close();
  }

  get socketState() {
    if (!this.ws) return 'closed';
    return ['connecting', 'open', 'closing', 'closed'][this.ws.readyState];
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, fn); return () => this.removeEventListener(type, fn); }

  /* ── Transport ──────────────────────────────────────────────────────── */
  send(payload) {
    if (!this.ws || this.ws.readyState !== 1) throw new DerivError('NOT_CONNECTED', 'Not connected to Deriv');
    const req_id = this.reqId++;
    const body = Object.assign({ req_id }, payload);
    this.ws.send(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(req_id)) {
          this.pending.delete(req_id);
          reject(new DerivError('TIMEOUT', 'Deriv did not answer the request'));
        }
      }, 30000);
    });
  }

  async request(payload) {
    await this.connect();
    return this.send(payload);
  }

  handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.error) {
      const err = new DerivError(msg.error.code, msg.error.message);
      this.emit('api-error', err);
      const p = msg.req_id && this.pending.get(msg.req_id);
      if (p) { this.pending.delete(msg.req_id); p.reject(err); }
      return;
    }
    if (msg.ping === 'pong' || msg.msg_type === 'ping') return;

    const p = msg.req_id != null ? this.pending.get(msg.req_id) : null;
    const streamId = msg.subscription && msg.subscription.id;

    if (streamId) {
      const handler = this.bySubscription.get(streamId);
      if (handler) { handler(msg); if (p) this.pending.delete(msg.req_id); return; }
      if (p) { this.pending.delete(msg.req_id); p.resolve(msg); return; }
      return;
    }
    if (p) {
      this.pending.delete(msg.req_id);
      if (p.stream) { p.stream(msg); return; }
      p.resolve(msg);
      return;
    }
    this.emit('message', msg);
  }

  /* ── Streaming helpers ──────────────────────────────────────────────── */
  async stream(payload, handler) {
    const msg = await this.request(payload);
    const id = msg.subscription && msg.subscription.id;
    if (id) {
      this.bySubscription.set(id, handler);
      this.openStreams.set(id, payload);
    }
    handler(msg);
    return {
      subscriptionId: id,
      unsubscribe: () => this.forget(id, payload.forget)
    };
  }

  async forget(subscriptionId, sub) {
    this.bySubscription.delete(subscriptionId);
    if (this.openStreams.has(subscriptionId)) {
      const payload = this.openStreams.get(subscriptionId);
      this.openStreams.delete(subscriptionId);
      sub = Object.assign({}, sub, payload, { forget: subscriptionId });
    }
    if (sub && this.connected) { try { await this.request(sub); } catch (e) { /* already gone */ } }
  }

  async resubscribeAll() {
    /* A reconnected socket has no subscriptions; re-issue the ones we kept. */
    const entries = [...this.bySubscription.entries()];
    for (const [id, handler] of entries) {
      const payload = this.openStreams.get(id);
      this.bySubscription.delete(id); this.openStreams.delete(id);
      if (!payload) continue;
      try { await this.stream(payload, handler); } catch (e) { /* skip */ }
    }
  }

  /* ── Auth ───────────────────────────────────────────────────────────── */
  loginUrl(redirect) {
    const params = new URLSearchParams({
      app_id: String(appId()),
      l: 'EN',
      redirect_uri: redirect || (location.origin + location.pathname),
      brand: 'deriv'
    });
    return `${CONFIG.oauthUrl}?${params.toString()}`;
  }

  startOAuth() {
    /* Full-page redirect to Deriv's own login / sign-up screen. */
    location.href = this.loginUrl();
  }

  /* Deriv returns ?token=...&acct1=...&cur1=... (or the same in the hash). */
  readRedirect() {
    const fromQuery = new URLSearchParams(location.search);
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const get = (k) => fromQuery.get(k) || fromHash.get(k);
    const token = get('token');
    if (!token) return null;
    const accounts = [];
    for (let i = 1; i <= 6; i++) {
      const id = get('acct' + i);
      if (!id) break;
      accounts.push({
        loginid: id,
        currency: get('cur' + i) || 'USD',
        token: get('token' + i) || token
      });
    }
    return { token, accounts };
  }

  clearRedirect() {
    if (location.search || location.hash) {
      history.replaceState(null, '', location.origin + location.pathname);
    }
  }

  async authorize(token) {
    const res = await this.request({ authorize: token });
    const a = res.authorize;
    this.token = token;
    this.authorized = true;
    this.auth = a;
    STORE.set('token', token);
    if (a.loginid) STORE.set('loginid', a.loginid);
    this.emit('auth', a);
    return a;
  }

  logout() {
    this.token = null; this.authorized = false; this.auth = null;
    STORE.del('token'); STORE.del('loginid');
    this.emit('logout');
  }

  /* ── Market data ────────────────────────────────────────────────────── */
  activeSymbols() {
    return this.request({ active_symbols: 'brief', product_type: 'basic' })
      .then((r) => r.active_symbols || []);
  }

  candles(symbol, granularity, count = 240) {
    const end = 'latest';
    return this.request({
      ticks_history: symbol, adjust_start_time: 1, count, end,
      style: 'candles', granularity
    }).then((r) => (r.candles || []).map((c) => ({
      time: c.epoch, open: +c.open, high: +c.high, low: +c.low, close: +c.close
    })));
  }

  tickStream(symbol, handler) {
    return this.stream({ ticks: symbol, subscribe: 1 }, (msg) => {
      if (msg.tick) handler({ epoch: msg.tick.epoch, quote: +msg.tick.quote, symbol: msg.tick.symbol });
      else if (msg.history) handler({ history: msg.history, msg });
    });
  }

  /* ── Trading ────────────────────────────────────────────────────────── */
  proposal(params) {
    return this.request(Object.assign({ proposal: 1, product_type: 'basic' }, params))
      .then((r) => r.proposal);
  }

  buy(id, price) {
    return this.request({ buy: id, price });
  }

  balanceStream(handler) {
    return this.stream({ balance: 1, subscribe: 1 }, (msg) => {
      if (msg.balance) handler(msg.balance);
    });
  }

  portfolio() { return this.request({ portfolio: 1 }).then((r) => r.portfolio); }
  statement(limit = 50) {
    return this.request({ statement: 1, description: 1, limit }).then((r) => r.statement);
  }
  profitTable(limit = 50) {
    return this.request({ profit_table: 1, description: 1, limit, sort: 'DESC' })
      .then((r) => r.profit_table);
  }
  openContract(id, handler) {
    return this.stream({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }, handler);
  }
  ticksHistory(symbol, count = 100) {
    return this.request({ ticks_history: symbol, count, end: 'latest', style: 'ticks' })
      .then((r) => (r.history ? r.history.times.map((t, i) => ({ epoch: t, quote: +r.history.prices[i] })) : []));
  }
  sellContract(id, price = 0) { return this.request({ sell: id, price }); }
}

export const api = new DerivAPI();

/* ── High level session helpers used by the shell ───────────────────────── */
export function restoreSession() {
  const token = STORE.get('token', null);
  if (!token) return Promise.resolve(null);
  return api.authorize(token).catch(() => { STORE.del('token'); return null; });
}
