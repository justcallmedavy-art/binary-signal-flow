/* ============================================================================
   Feed facade.

   Views and the bot engine talk to `feed`, never to a transport directly:

     live  — everything goes to Deriv's WebSocket API
     sim   — Deriv is unreachable (offline, blocked network, no account), so a
             local synthetic-tick simulator takes over with PAPER money

   The simulator is deliberately honest: outcomes are decided by the next real
   (simulated) tick, payouts follow the true probability of each contract, and
   the UI always says the feed is simulated.
   ========================================================================== */
import { api } from './deriv.js';
import { SYMBOLS, symbolDigits, lastDigit } from './market.js';
import { STORE } from './config.js';

const TICK_MS = 1000;
const HOUSE_EDGE = 0.95;

/* ── Probability of winning a contract, used to price simulated payouts ── */
function winProbability(contractType, barrier) {
  const b = Number(barrier == null ? 5 : barrier);
  switch (contractType) {
    case 'DIGITOVER': return (9 - b) / 10;
    case 'DIGITUNDER': return b / 10;
    case 'DIGITEVEN': case 'DIGITODD': return 0.5;
    case 'DIGITDIFF': return 0.9;
    case 'DIGITMATCH': return 0.1;
    default: return 0.5;                       // CALL / PUT
  }
}

class Simulator {
  constructor() {
    this.authorized = true;
    /* The paper account survives reloads so reports and the balance stay
       continuous while the simulator is in use. */
    const saved = STORE.get('paper', null) || {};
    this.balance = typeof saved.balance === 'number' ? saved.balance : 10000;
    this.settled = Array.isArray(saved.transactions) ? saved.transactions : [];
    this.auth = { loginid: 'VRTC-SIMULATED', currency: 'USD', is_virtual: true, balance: this.balance };
    this.states = new Map();     // symbol -> { price, subs:Set, history:[] }
    this.contracts = new Map();  // id -> contract
    this.balanceSubs = new Set();
    this.lastParams = null;
    this.seq = 100000;
    this._timer = null;
  }

  emitBalance() {
    const payload = { balance: +this.balance.toFixed(2), currency: 'USD', loginid: this.auth.loginid };
    this.balanceSubs.forEach((cb) => cb(payload));
  }

  state(symbol) {
    if (!this.states.has(symbol)) {
      const base = 400 + (Math.abs(hash(symbol)) % 2400) + (symbol.startsWith('frx') ? 1.0 : 0);
      const st = { price: symbol.startsWith('frx') ? 1.0842 : +base.toFixed(2), subs: new Set(), history: [] };
      /* Seed history so charts and digit analytics have something to show. */
      const n = 240;
      for (let i = n; i > 0; i--) {
        st.price = nextPrice(st.price, symbol);
        st.history.push({ epoch: Math.floor(Date.now() / 1000) - i, quote: +st.price.toFixed(symbolDigits(symbol)) });
      }
      this.states.set(symbol, st);
    }
    return this.states.get(symbol);
  }

  loop() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      const epoch = Math.floor(Date.now() / 1000);
      this.states.forEach((st, symbol) => {
        if (!st.subs.size && !this.hasOpenOn(symbol)) return;
        st.price = nextPrice(st.price, symbol);
        const quote = +st.price.toFixed(symbolDigits(symbol));
        const tick = { epoch, quote, symbol };
        st.history.push(tick);
        if (st.history.length > 600) st.history.shift();
        st.subs.forEach((cb) => cb(tick));
        this.advanceContracts(symbol, tick);
      });
    }, TICK_MS);
    if (this._timer.unref) this._timer.unref();
  }

  hasOpenOn(symbol) {
    for (const c of this.contracts.values()) if (c.symbol === symbol && !c.sold) return true;
    return false;
  }

  tickStream(symbol, handler) {
    const st = this.state(symbol);
    st.subs.add(handler);
    this.loop();
    /* Deliver the latest tick immediately so views are never stuck on “—”. */
    const last = st.history[st.history.length - 1];
    if (last) setTimeout(() => handler(last), 30);
    return Promise.resolve({ unsubscribe: () => Promise.resolve(st.subs.delete(handler)) });
  }

  ticksHistory(symbol, count) {
    const st = this.state(symbol);
    return Promise.resolve(st.history.slice(-count));
  }

  /* History only covers the last few minutes, so older buckets are generated
     from a deterministic walk (seeded by symbol + bucket) and stitched in
     front of the ticks we actually observed. */
  candles(symbol, granularity, count) {
    const st = this.state(symbol);
    const meta = SYMBOLS[symbol] || { pip: 0.01 };
    const bucketOf = (t) => Math.floor(t / granularity) * granularity;
    const real = new Map();
    st.history.forEach((t) => {
      const k = bucketOf(t.epoch);
      const c = real.get(k);
      if (!c) real.set(k, { time: k, open: t.quote, high: t.quote, low: t.quote, close: t.quote });
      else { c.high = Math.max(c.high, t.quote); c.low = Math.min(c.low, t.quote); c.close = t.quote; }
    });
    const nowBucket = bucketOf(Math.floor(Date.now() / 1000));
    const out = [];
    let price = st.price;
    for (let i = 0; i < count; i++) {
      const k = nowBucket - (count - 1 - i) * granularity;
      const observed = real.get(k);
      if (observed) { out.push(observed); price = observed.close; continue; }
      const r = lcg(hash(symbol) ^ Math.floor(k / granularity));
      const vol = Math.max(meta.pip, price * 0.0007);
      const open = price;
      const close = open + (r() - 0.5) * vol * 7;
      const high = Math.max(open, close) + r() * vol * 2;
      const low = Math.min(open, close) - r() * vol * 2;
      price = close;
      out.push({ time: k, open, high, low, close });
    }
    return Promise.resolve(out);
  }

  balanceStream(handler) {
    this.balanceSubs.add(handler);
    setTimeout(() => this.emitBalance(), 20);
    return Promise.resolve({ unsubscribe: () => Promise.resolve(this.balanceSubs.delete(handler)) });
  }

  proposal(params) {
    const p = winProbability(params.contract_type, params.barrier);
    const amount = Number(params.amount);
    const payout = Math.max(amount * 1.02, +((amount / p) * HOUSE_EDGE).toFixed(2));
    const st = this.state(params.symbol);
    return Promise.resolve({
      id: 'sim-prop-' + (++this.seq),
      ask_price: amount,
      payout: +payout.toFixed(2),
      spot: +st.price.toFixed(symbolDigits(params.symbol)),
      longcode: `Simulated ${params.contract_type} ${amount} USD on ${params.symbol}`,
      simulated: true,
      params
    });
  }

  buy(id, price) {
    const params = this.lastParams || { symbol: 'R_100', contract_type: 'DIGITOVER', duration: 1, barrier: '5' };
    const st = this.state(params.symbol);
    const amount = Number(price);
    if (this.balance < amount) return Promise.reject(new Error('Insufficient simulated balance'));
    const payout = Math.max(amount * 1.02, +((amount / winProbability(params.contract_type, params.barrier)) * HOUSE_EDGE).toFixed(2));
    const contract = {
      contract_id: 'sim-' + (++this.seq),
      symbol: params.symbol,
      contract_type: params.contract_type,
      barrier: params.barrier,
      currency: 'USD',
      buy_price: amount,
      payout: +payout.toFixed(2),
      ticksLeft: Number(params.duration) || 1,
      entry: st.price,
      entryDigit: lastDigit(st.price, symbolDigits(params.symbol)),
      entryDisplay: st.price.toFixed(symbolDigits(params.symbol)),
      sold: false,
      handlers: new Set()
    };
    this.balance = +(this.balance - amount).toFixed(2);
    this.emitBalance();
    this.contracts.set(contract.contract_id, contract);
    return Promise.resolve({
      buy: {
        contract_id: contract.contract_id,
        buy_price: contract.buy_price,
        payout: contract.payout,
        longcode: `Simulated ${contract.contract_type}`,
        currency: 'USD'
      }
    });
  }

  /* Called by the loop; decides the outcome from the following real tick. */
  advanceContracts(symbol, tick) {
    for (const c of this.contracts.values()) {
      if (c.sold || c.symbol !== symbol) continue;
      c.ticksLeft--;
      c.current = tick.quote;
      c.currentDigit = lastDigit(tick.quote, symbolDigits(symbol));
      this.push(c, false);
      if (c.ticksLeft > 0) continue;

      c.sold = true;
      c.exit = tick.quote;
      c.exitDigit = c.currentDigit;
      const digit = c.currentDigit;
      const b = Number(c.barrier == null ? 5 : c.barrier);
      const won = {
        DIGITOVER: digit > b,
        DIGITUNDER: digit < b,
        DIGITEVEN: digit % 2 === 0,
        DIGITODD: digit % 2 === 1,
        DIGITDIFF: digit !== b,
        DIGITMATCH: digit === b,
        CALL: tick.quote > c.entry,
        PUT: tick.quote < c.entry
      }[c.contract_type];
      c.profit = +(won ? c.payout - c.buy_price : -c.buy_price).toFixed(2);
      if (won) this.balance = +(this.balance + c.payout).toFixed(2);
      this.settled.unshift({
        contract_id: c.contract_id,
        buy_price: c.buy_price,
        payout: c.payout,
        profit: c.profit,
        currency: 'USD',
        shortcode: c.contract_type,
        longcode: `Simulated ${c.contract_type} on ${c.symbol} · entry digit ${c.entryDigit} · exit digit ${c.exitDigit}`,
        purchase_time: Math.floor(Date.now() / 1000)
      });
      if (this.settled.length > 150) this.settled.pop();
      STORE.set('paper', { balance: this.balance, transactions: this.settled });
      this.auth.balance = this.balance;
      this.emitBalance();
      this.push(c, true);
    }
  }

  push(c, sold) {
    const msg = {
      proposal_open_contract: {
        contract_id: c.contract_id,
        contract_type: c.contract_type,
        currency: 'USD',
        buy_price: c.buy_price,
        payout: c.payout,
        is_sold: sold ? 1 : 0,
        status: sold ? 'sold' : 'open',
        profit: sold ? c.profit : 0,
        entry_tick: c.entry,
        entry_tick_display_value: c.entryDisplay,
        exit_tick: sold ? c.exit : undefined,
        exit_tick_display_value: sold ? c.exit.toFixed(symbolDigits(c.symbol)) : undefined,
        current_spot: c.current,
        current_spot_display_value: c.current != null ? c.current.toFixed(symbolDigits(c.symbol)) : undefined,
        longcode: `Simulated ${c.contract_type} · entry digit ${c.entryDigit}${sold ? ` · exit digit ${c.exitDigit}` : ''}`,
        simulated: true
      }
    };
    c.handlers.forEach((h) => h(msg));
  }

  openContract(id, handler) {
    const c = this.contracts.get(id);
    if (!c) return Promise.reject(new Error('Unknown simulated contract'));
    if (c.sold) { handler({ proposal_open_contract: { contract_id: id, is_sold: 1, profit: c.profit, buy_price: c.buy_price, payout: c.payout, currency: 'USD' } }); return Promise.resolve({ unsubscribe: () => Promise.resolve() }); }
    c.handlers.add(handler);
    this.push(c, false);
    return Promise.resolve({ unsubscribe: () => Promise.resolve(c.handlers.delete(handler)) });
  }

  sellContract(id) {
    const c = this.contracts.get(id);
    if (!c || c.sold) return Promise.reject(new Error('Contract not open'));
    c.sold = true;
    c.profit = +(-c.buy_price * 0.5).toFixed(2);
    this.push(c, true);
    return Promise.resolve({ sell: { sold_for: c.buy_price * 0.5 } });
  }

  portfolio() {
    const open = [...this.contracts.values()].filter((c) => !c.sold);
    return Promise.resolve({ contracts: open.map((c) => ({ contract_id: c.contract_id, buy_price: c.buy_price, currency: 'USD' })) });
  }

  profitTable(limit = 50) {
    if (this.settled.length) return Promise.resolve({ transactions: this.settled.slice(0, limit) });
    const settled = [...this.contracts.values()].filter((c) => c.sold).slice(-limit).reverse();
    return Promise.resolve({
      transactions: settled.map((c) => ({
        contract_id: c.contract_id,
        buy_price: c.buy_price,
        payout: c.payout,
        profit: c.profit,
        currency: 'USD',
        shortcode: c.contract_type,
        longcode: `Simulated ${c.contract_type} on ${c.symbol}`,
        purchase_time: Math.floor(Date.now() / 1000)
      }))
    });
  }
}

function nextPrice(price, symbol) {
  const meta = SYMBOLS[symbol] || { pip: 0.01 };
  const vol = Math.max(meta.pip, price * 0.00035);
  const drift = (Math.random() - 0.5) * 2;
  const next = price + drift * vol * 3;
  return next <= 0 ? price + vol : next;
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}
/* Deterministic PRNG so generated candles stay stable across re-renders. */
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ══════════════════════════════════════════════════════════════════════════
   MarketFeed — picks a transport per call.
   ═════════════════════════════════════════════════════════════════════════ */
export class MarketFeed extends EventTarget {
  constructor(transport = api) {
    super();
    this.api = transport;
    this.sim = new Simulator();
    /* Sticky flag: the user can pin the simulator, otherwise we keep trying
       Deriv and switch back the moment the socket recovers. */
    this.pinned = !!STORE.get('force_sim', false);
    this.simulated = this.pinned;
  }

  /* Live means: Deriv's socket is up and we are not pinned to the simulator. */
  get live() { return this.api.connected && !this.simulated; }

  get authorized() { return this.api.authorized || this.sim.authorized; }
  get auth() { return this.api.authorized ? this.api.auth : this.sim.auth; }
  get isPaper() { return !this.api.authorized; }

  useSimulator(reason = 'Deriv unreachable', { user = false } = {}) {
    if (this.simulated) return;
    this.simulated = true;
    if (user) { this.pinned = true; STORE.set('force_sim', true); }
    this.dispatchEvent(new CustomEvent('modechange', { detail: { simulated: true, reason } }));
  }
  useLive() {
    if (this.pinned || !this.simulated) return;
    this.simulated = false;
    this.dispatchEvent(new CustomEvent('modechange', { detail: { simulated: false } }));
  }

  /* Market data — delegated with fallback on failure. */
  async tickStream(symbol, handler) {
    if (this.live) {
      try { return await this.api.tickStream(symbol, handler); }
      catch (e) { this.useSimulator('tick stream failed'); }
    }
    return this.sim.tickStream(symbol, handler);
  }
  async ticksHistory(symbol, count) {
    if (this.live) { try { return await this.api.ticksHistory(symbol, count); } catch (e) { /* fall through */ } }
    return this.sim.ticksHistory(symbol, count);
  }
  async candles(symbol, granularity, count) {
    if (this.live) { try { return await this.api.candles(symbol, granularity, count); } catch (e) { /* fall through */ } }
    return this.sim.candles(symbol, granularity, count);
  }
  async balanceStream(handler) {
    if (this.api.authorized) {
      try { return await this.api.balanceStream(handler); }
      catch (e) { /* fall through */ }
    }
    return this.sim.balanceStream(handler);
  }
  async portfolio() {
    if (this.api.authorized) { try { return await this.api.portfolio(); } catch (e) { /* fall through */ } }
    return this.sim.portfolio();
  }
  async profitTable(limit) {
    if (this.api.authorized) { try { return await this.api.profitTable(limit); } catch (e) { /* fall through */ } }
    return this.sim.profitTable(limit);
  }

  /* Trading — sim only when there is no live session or it is pinned. */
  async proposal(params) {
    this.sim.lastParams = params;
    if (this.live) { try { return await this.api.proposal(params); } catch (e) { /* fall through */ } }
    return this.sim.proposal(params);
  }
  async buy(id, price) {
    if (this.live && !String(id).startsWith('sim-')) return this.api.buy(id, price);
    this.sim.lastParams = this.sim.lastParams || null;
    return this.sim.buy(id, price);
  }
  async openContract(id, handler) {
    if (this.live && !String(id).startsWith('sim-')) {
      try { return await this.api.openContract(id, handler); } catch (e) { /* fall through */ }
    }
    return this.sim.openContract(id, handler);
  }
  async sellContract(id, price) {
    if (this.live && !String(id).startsWith('sim-')) { try { return await this.api.sellContract(id, price); } catch (e) { /* fall through */ } }
    return this.sim.sellContract(id);
  }
  async authorize(token) { return this.api.authorize(token); }
  get loginid() { return this.authorized ? this.auth.loginid : null; }
  get currency() { return this.auth ? this.auth.currency : 'USD'; }
}

export const feed = new MarketFeed(api);
