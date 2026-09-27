/* ============================================================================
   Bot model + runtime engine.

   A bot is plain JSON (so it can be exported / imported / shared):

     { name, params:{...}, setups:[...], analysis:[...],
       purchase:[...], sell:[...], restart:[...] }

   The engine subscribes to the symbol's tick stream, maintains the digit
   history, evaluates the purchase rules, then proposes → buys → tracks the
   contract to settlement, applying the restart rules before the next trade.
   ========================================================================== */
import { DerivError } from './deriv.js';
import { feed } from './feed.js';
import { SYMBOLS, MARKET_TREE, lastDigit, symbolDigits } from './market.js';
import { fmt } from './config.js';

/* ── Block library shown in the Blocks menu ────────────────────────────── */
export const BLOCK_LIBRARY = [
  {
    group: 'Analysis Logics', emoji: '🔥', open: true, blocks: [
      { id: 'analysis-logic', icon: '⚡', colour: '#f2a93b', title: 'Analysis condition', hint: 'Gate trading on a market observation', section: 'analysis' },
      { id: 'streak-counter', icon: '#', colour: '#2f6fd0', title: 'Streak counter', hint: 'Count consecutive rise / fall ticks', section: 'analysis' }
    ]
  },
  {
    group: 'Market Structure', emoji: '🏗️', blocks: [
      { id: 'market-structure', icon: '🏗️', colour: '#6b4ee6', title: 'Market structure', hint: 'Higher highs / lower lows detector', section: 'analysis' }
    ]
  },
  {
    group: 'Trade parameters', blocks: [
      { id: 'trade-parameters', icon: '1', colour: '#1f3557', title: 'Trade parameters', hint: 'Market, symbol, contract type, interval', section: 'trade' },
      { id: 'alternate-markets', icon: '⇄', colour: '#54617d', title: 'Alternate markets', hint: 'Rotate symbols between trades', section: 'trade' }
    ]
  },
  {
    group: 'Purchase conditions', blocks: [
      { id: 'purchase-condition', icon: '🔵', colour: '#00a79d', title: 'Purchase condition', hint: 'Last digit / streak predicate', section: 'purchase' },
      { id: 'purchase-every', icon: '⏱', colour: '#00a79d', title: 'Purchase every N ticks', hint: 'Timer based entry', section: 'purchase' }
    ]
  },
  {
    group: 'Sell conditions (optional)', blocks: [
      { id: 'take-profit', icon: '🎯', colour: '#12a150', title: 'Take profit', hint: 'Stop the bot when profit is reached', section: 'sell' },
      { id: 'stop-loss', icon: '🛑', colour: '#d21f26', title: 'Stop loss', hint: 'Stop the bot when loss is reached', section: 'sell' }
    ]
  },
  {
    group: 'Restart trading conditions', blocks: [
      { id: 'restart-rule', icon: '↻', colour: '#2f6fd0', title: 'Restart rule', hint: 'Martingale / reset after a trade', section: 'restart' },
      { id: 'max-trades', icon: 'Σ', colour: '#2f6fd0', title: 'Max trades', hint: 'Hard run limit', section: 'sell' }
    ]
  },
  {
    group: 'Analysis', blocks: [
      { id: 'ma-cross', icon: '📈', colour: '#1b2c4a', title: 'Moving average cross', hint: 'SMA fast / slow alignment', section: 'analysis' },
      { id: 'digit-frequency', icon: '📊', colour: '#1b2c4a', title: 'Digit frequency', hint: 'Hot / cold last digits', section: 'analysis' }
    ]
  },
  {
    group: 'Utility', blocks: [
      { id: 'set-variable', icon: '=', colour: '#54617d', title: 'Set variable', hint: 'Stake, martingale, stop loss…', section: 'setups' },
      { id: 'notify', icon: '🔔', colour: '#54617d', title: 'Notify', hint: 'Journal + toast message', section: 'utility' },
      { id: 'journal-note', icon: '📝', colour: '#54617d', title: 'Journal note', hint: 'Write a line into the journal', section: 'utility' }
    ]
  },
  {
    group: 'Binary Signal Flow Tools', blocks: [
      { id: 'ai-generator', icon: '✨', colour: '#6b4ee6', title: 'AI strategy generator', hint: 'Build a graph from a description', section: 'ai' },
      { id: 'virtual-hook', icon: '🪝', colour: '#f2a93b', title: 'Virtual hook', hint: 'Run inside a virtual account mirror', section: 'trade' },
      { id: 'copy-trade', icon: '🧬', colour: '#6b4ee6', title: 'Copy trade hook', hint: 'Mirror the run to another account', section: 'utility' }
    ]
  }
];

/* ── Variables that configurable `set` blocks may assign ──────────────── */
export const VARIABLES = [
  { name: 'Stake', unit: 'USD' },
  { name: 'Martingale_stake', unit: 'USD' },
  { name: 'Martingale_size', unit: '×' },
  { name: 'Stop_loss', unit: 'USD' },
  { name: 'Take_profit', unit: 'USD' },
  { name: 'Max_trades', unit: 'count' },
  { name: 'Multiplier', unit: '×' }
];

export const CONTRACT_TYPES = {
  digits: { label: 'Digits', types: ['overunder', 'evenodd', 'diffmatch'] },
  risefall: { label: 'Rise/Fall', types: ['risefall'] },
  higherlower: { label: 'Higher/Lower', types: ['higherlower'] }
};

export function defaultBot(name = 'Martingale V2') {
  return {
    name,
    params: {
      market: 'synthetics',
      submarket: 'Continuous Indices',
      symbol: 'R_100',
      alternateMarkets: false,
      alternateMode: 'random',
      tradeType: 'digits',
      contractType: 'overunder',
      candleInterval: 60,
      restartOnError: true,
      useVirtualHook: false,
      restartLastTradeOnError: true
    },
    setups: [
      { id: 's1', name: 'Stake', value: 2.5 },
      { id: 's2', name: 'Martingale_stake', value: 'Stake' },
      { id: 's3', name: 'Martingale_size', value: 1.5 },
      { id: 's4', name: 'Stop_loss', value: 1000 },
      { id: 's5', name: 'Take_profit', value: 1000 },
      { id: 's6', name: 'Max_trades', value: 30 }
    ],
    analysis: [
      { id: 'a1', when: 'digit-freq', op: '>=', value: 10, note: 'at least 10 sampled digits' }
    ],
    purchase: [
      { id: 'p1', when: 'lastDigit', op: '>=', value: 5, side: 'over', digit: 5 },
      { id: 'p2', when: 'lastDigit', op: '<=', value: 4, side: 'under', digit: 5 }
    ],
    sell: [
      { id: 'x1', when: 'totalProfit', op: '>=', value: 100, action: 'stop' },
      { id: 'x2', when: 'totalProfit', op: '<=', value: -200, action: 'stop' }
    ],
    restart: [
      { id: 'r1', when: 'result', op: 'is', value: 'Win', action: 'reset' },
      { id: 'r2', when: 'result', op: 'is', value: 'Loss', action: 'martingale' }
    ]
  };
}

export function defaultKnockoutBot() {
  const b = defaultBot('Volatility Knockout');
  b.params.contractType = 'risefall';
  b.params.tradeType = 'risefall';
  b.params.symbol = '1HZ100V';
  b.setups = [
    { id: 's1', name: 'Stake', value: 1 },
    { id: 's2', name: 'Multiplier', value: 2 },
    { id: 's3', name: 'Stop_loss', value: 50 },
    { id: 's4', name: 'Take_profit', value: 75 },
    { id: 's5', name: 'Max_trades', value: 20 }
  ];
  b.purchase = [{ id: 'p1', when: 'maCross', op: 'is', value: 'bullish', side: 'rise', digit: 5 }];
  b.restart = [
    { id: 'r1', when: 'result', op: 'is', value: 'Win', action: 'reset' },
    { id: 'r2', when: 'result', op: 'is', value: 'Loss', action: 'increase' }
  ];
  return b;
}

/* ── Contract mapping ─────────────────────────────────────────────────── */
const DIGIT_CONTRACT = {
  over: 'DIGITOVER', under: 'DIGITUNDER',
  even: 'DIGITEVEN', odd: 'DIGITODD',
  differs: 'DIGITDIFF', matches: 'DIGITMATCH'
};

export function contractFor(bot, rule) {
  const p = bot.params;
  if (p.tradeType === 'digits') {
    if (p.contractType === 'evenodd') return p.side === 'odd' ? 'DIGITODD' : 'DIGITEVEN';
    if (p.contractType === 'diffmatch') return rule && rule.side === 'matches' ? 'DIGITMATCH' : 'DIGITDIFF';
    const side = rule ? rule.side : 'over';
    return DIGIT_CONTRACT[side] || 'DIGITOVER';
  }
  if (p.tradeType === 'higherlower') return 'CALL';
  return rule && rule.side === 'fall' ? 'PUT' : 'CALL';
}

export function contractLabel(type) {
  return {
    DIGITOVER: 'Digit Over', DIGITUNDER: 'Digit Under', DIGITEVEN: 'Digit Even', DIGITODD: 'Digit Odd',
    DIGITDIFF: 'Digit Differs', DIGITMATCH: 'Digit Matches', CALL: 'Rise', PUT: 'Fall'
  }[type] || type;
}

/* ══════════════════════════════════════════════════════════════════════════
   BotEngine
   ═════════════════════════════════════════════════════════════════════════ */
export class BotEngine {
  constructor() {
    this.bot = null;
    this.running = false;
    this.digits = [];        // raw quotes, newest last
    this.digitValues = [];   // last digits
    this.ticks = [];
    this.stake = 0;
    this.baseStake = 0;
    this.trades = 0;
    this.wins = 0;
    this.losses = 0;
    this.totalStake = 0;
    this.totalPayout = 0;
    this.tradesRows = [];
    this.contract = null;
    this.vars = {};
    this.listeners = {};
    /* The journal lives on the engine so a re-mounted builder still shows the
       full history of the current run. */
    this.logLines = [];
    this._tickSub = null;
    this._ocSub = null;
    this._lastTradeEpoch = 0;
    this.stopped = false;
  }

  /* Returns an unsubscribe function — views detach when they are replaced. */
  on(evt, fn) {
    const list = (this.listeners[evt] = this.listeners[evt] || []);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  fire(evt, data) { (this.listeners[evt] || []).forEach((f) => f(data)); }
  log(kind, text) {
    const line = { kind, text, at: new Date() };
    this.logLines.push(line);
    if (this.logLines.length > 500) this.logLines.shift();
    this.fire('journal', line);
  }

  get profit() { return this.totalPayout - this.totalStake; }

  async start(bot) {
    if (this.running) return;
    this.bot = bot;
    this.rolled = false;
    const p = bot.params;
    this.digits = []; this.digitValues = []; this.ticks = [];
    this.tradesRows = []; this.trades = 0; this.wins = 0; this.losses = 0;
    this.totalStake = 0; this.totalPayout = 0; this.stopped = false;
    this.vars = {};
    bot.setups.forEach((s) => { this.vars[s.name] = s.value; });
    this.baseStake = Number(this.resolve('Stake')) || 1;
    this.stake = this.baseStake;
    this.digitHistory = [];
    this.logLines = [];
    this.running = true;

    this.log('info', `── Bot "${bot.name}" starting ──`);
    this.log('info', `Market: ${p.market} › ${p.submarket} › ${SYMBOLS[p.symbol] ? SYMBOLS[p.symbol].name : p.symbol}`);
    this.log('info', `Trade type: ${(CONTRACT_TYPES[p.tradeType] || {}).label} · Contract: ${p.contractType}`);
    this.log('info', `Stake ${fmt.num(this.stake)} · Martingale ×${this.vars.Martingale_size} · Max trades ${this.vars.Max_trades}`);

    if (!feed.authorized) {
      this.running = false;
      throw new DerivError('NOT_AUTHORIZED', 'Log in with Deriv before running a bot.');
    }
    this.currency = feed.currency;
    if (feed.isPaper) this.log('warn', 'Running on the simulated feed with paper money — no real orders are placed.');
    await feed.api.connect().catch(() => {});
    this._startTicks(p.symbol);
    this.fire('started', bot);
  }

  _startTicks(symbol) {
    if (this._tickSub) this._tickSub.unsubscribe();
    feed.tickStream(symbol, (t) => this.onTick(t)).then((sub) => {
      this._tickSub = sub;
      this.log('ok', `Subscribed to ${symbol} tick stream`);
    }).catch((e) => this.fail(e));
    /* Seed digit history from the recent tick list so conditions are usable
       immediately instead of after 60 seconds of waiting. */
    feed.ticksHistory(symbol, 60).then((list) => {
      if (!this.running || !list.length) return;
      const digits = symbolDigits(symbol);
      this.digits = list.map((t) => t.quote);
      this.digitValues = list.map((t) => lastDigit(t.quote, digits));
      this.ticks = list;
      this.log('info', `Seeded ${list.length} historical ticks (last digit ${this.digitValues[this.digitValues.length - 1]})`);
      this.fire('seed', { digits: this.digitValues.slice() });
    }).catch(() => { /* history is a nicety */ });
  }

  onTick(t) {
    if (!this.running || !t || t.quote == null) return;
    const p = this.bot.params;
    const digits = symbolDigits(p.symbol);
    this.digits.push(t.quote);
    this.ticks.push(t);
    if (this.digits.length > 400) { this.digits.shift(); this.ticks.shift(); }
    const d = lastDigit(t.quote, digits);
    this.digitValues.push(d);
    if (this.digitValues.length > 400) this.digitValues.shift();
    this.fire('tick', { tick: t, digit: d, digits: this.digitValues.slice() });
    if (this.contract) return;                       // one contract at a time
    if (this.stopped) return;
    this.maybeTrade(t);
  }

  resolve(name) { return this.vars[name]; }

  /* ── Rule evaluation ──────────────────────────────────────────────────── */
  ruleHolds(rule) {
    const d = this.digitValues;
    switch (rule.when) {
      case 'always': return true;
      case 'lastDigit': {
        if (!d.length) return false;
        const v = d[d.length - 1];
        return cmp(v, rule.op, Number(rule.value));
      }
      case 'streak': {
        if (!d.length) return false;
        let n = 0; const target = Number(rule.value) || 3;
        const rising = d[d.length - 1] >= 5;
        for (let i = d.length - 1; i >= 0 && (d[i] >= 5) === rising; i--) n++;
        return n >= target;
      }
      case 'digit-freq': return this.digitValues.length >= (Number(rule.value) || 10);
      case 'maCross': {
        if (this.digits.length < 30) return false;
        const fast = avg(this.digits.slice(-10));
        const slow = avg(this.digits.slice(-30));
        return rule.value === 'bullish' ? fast > slow : fast < slow;
      }
      case 'totalProfit': return cmp(this.profit, rule.op, Number(rule.value));
      case 'consecutiveLosses': return cmp(this.lossStreak || 0, rule.op, Number(rule.value));
      case 'trades': return cmp(this.trades, rule.op, Number(rule.value));
      case 'result': return false;
      default: return false;
    }
  }

  maybeTrade(tick) {
    const bot = this.bot;
    if (!bot.analysis.every((r) => r.when !== 'digit-freq' || this.ruleHolds(r))) {
      return;                                   // analysis gate not satisfied yet
    }
    const rule = bot.purchase.find((r) => this.ruleHolds(r));
    if (!rule) return;
    if (tick.epoch - this._lastTradeEpoch < 1) return;
    this._lastTradeEpoch = tick.epoch;
    this.placeTrade(rule, tick);
  }

  async placeTrade(rule, tick) {
    const bot = this.bot;
    const p = bot.params;
    const contractType = contractFor(bot, rule);
    const digits = symbolDigits(p.symbol);
    const barrier = String(rule.digit != null ? rule.digit : 5);
    const useBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITDIFF', 'DIGITMATCH'].includes(contractType);

    try {
      const proposal = await feed.proposal({
        amount: Number(this.stake).toFixed(2),
        basis: 'stake',
        contract_type: contractType,
        currency: this.currency || 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: p.symbol,
        ...(useBarrier ? { barrier } : {})
      });
      if (!this.running) return;
      const buy = await feed.buy(proposal.id, proposal.ask_price);
      const c = buy.buy;
      this.contract = {
        id: c.contract_id, type: contractType,
        stake: +c.buy_price, payout: +c.payout,
        entrySpot: lastQuote(this.digits),
        openedAt: new Date()
      };
      this.trades++;
      this.totalStake += +c.buy_price;
      this.log('info', `Buy ${contractLabel(contractType)} #${c.contract_id} · stake ${fmt.num(c.buy_price)} · payout ${fmt.num(c.payout)}`);
      this.fire('trade-open', this.contract);
      this.watchContract(c.contract_id);
    } catch (e) {
      this.log('bad', `Trade failed: ${e.message}`);
      this.fire('error', e);
      if (!bot.params.restartOnError) this.stop('error');
      else if (bot.params.restartLastTradeOnError) this._lastTradeEpoch = 0;
    }
  }

  watchContract(id) {
    if (this._ocSub) this._ocSub.unsubscribe().catch(() => {});
    feed.openContract(id, (msg) => {
      const oc = msg.proposal_open_contract;
      if (!oc) return;
      if (oc.is_sold || oc.status === 'sold') this.settle(oc);
      else this.fire('contract-update', oc);
    }).then((sub) => { this._ocSub = sub; }).catch(() => {});
  }

  settle(oc) {
    const profit = +oc.profit;
    const stake = +oc.buy_price;
    const payout = +oc.payout;
    const won = profit > 0;
    won ? this.wins++ : this.losses++;
    this.lossStreak = won ? 0 : (this.lossStreak || 0) + 1;
    this.totalPayout += payout;
    const row = {
      id: oc.contract_id,
      type: contractLabel(this.contract ? this.contract.type : oc.contract_type),
      entry: oc.entry_tick != null ? +oc.entry_tick : null,
      exit: oc.exit_tick != null ? +oc.exit_tick : null,
      stake, payout, profit,
      won, at: new Date(),
      entryDigit: oc.entry_tick_display_value != null
        ? lastDigit(oc.entry_tick_display_value, symbolDigits(this.bot.params.symbol)) : null,
      exitDigit: oc.exit_tick_display_value != null
        ? lastDigit(oc.exit_tick_display_value, symbolDigits(this.bot.params.symbol)) : null
    };
    this.tradesRows.unshift(row);
    if (this.tradesRows.length > 200) this.tradesRows.pop();
    this.log(won ? 'ok' : 'bad',
      `Contract #${oc.contract_id} ${won ? 'WON' : 'LOST'} · profit ${fmt.signed(profit)} ${this.currency || 'USD'} · total ${fmt.signed(this.profit)}`);
    this.contract = null;
    this.fire('trade-settled', row);
    this.fire('stats', this.stats());
    this.applyRestart(row);
  }

  applyRestart(row) {
    const rules = this.bot.restart.filter((r) => r.when === 'result' && r.value === (row.won ? 'Win' : 'Loss'));
    const actions = rules.map((r) => r.action);
    /* Position management first (stop conditions), then stake sizing. */
    const sellHit = this.bot.sell.find((r) => this.ruleHolds(r) && r.action === 'stop');
    if (sellHit) {
      this.log('warn', `Stop rule hit (${sellHit.when} ${sellHit.op} ${sellHit.value}) — bot stopped`);
      this.fire('stats', this.stats());
      this.stop('sell-rule');
      return;
    }
    if (this.trades >= Number(this.vars.Max_trades || 0)) {
      this.log('warn', `Max trades reached (${this.vars.Max_trades}) — bot stopped`);
      this.fire('stats', this.stats());
      this.stop('max-trades');
      return;
    }
    if (actions.includes('reset')) {
      this.stake = this.baseStake;
      this.log('info', `Stake reset to ${fmt.num(this.stake)}`);
    }
    if (actions.includes('martingale')) {
      this.stake = +(this.stake * Number(this.vars.Martingale_size || 2)).toFixed(2);
      this.log('info', `Martingale applied → next stake ${fmt.num(this.stake)}`);
    }
    if (actions.includes('increase')) {
      this.stake = +(this.stake * Number(this.vars.Multiplier || 2)).toFixed(2);
      this.log('info', `Stake increased → next stake ${fmt.num(this.stake)}`);
    }
    const stopRule = this.bot.restart.find((r) => r.action === 'stop' && this.ruleHolds(r));
    if (stopRule) {
      this.log('warn', 'Restart rule requested stop — bot halted');
      this.stop('restart-rule');
      return;
    }
    this.fire('stake', this.stake);
    this.fire('stats', this.stats());
  }

  fail(e) { this.log('bad', `Engine error: ${e.message}`); this.fire('error', e); }

  stop(reason = 'manual') {
    if (!this.running) return;
    this.running = false;
    this.stopped = true;
    if (this._tickSub) { this._tickSub.unsubscribe().catch(() => {}); this._tickSub = null; }
    if (this._ocSub) { this._ocSub.unsubscribe().catch(() => {}); this._ocSub = null; }
    this.log('warn', `Bot stopped (${reason}) · ${this.trades} trades · net ${fmt.signed(this.profit)}`);
    this.fire('stopped', { reason, stats: this.stats() });
  }

  stats() {
    return {
      running: this.running,
      trades: this.trades, wins: this.wins, losses: this.losses,
      totalStake: this.totalStake, totalPayout: this.totalPayout,
      profit: this.profit, stake: this.stake,
      winRate: this.trades ? (this.wins / this.trades) * 100 : 0,
      rows: this.tradesRows
    };
  }
}

/* ── small helpers ───────────────────────────────────────────────────── */
function cmp(a, op, b) {
  switch (op) {
    case '>=': return a >= b; case '<=': return a <= b;
    case '>': return a > b; case '<': return a < b;
    case '==': case 'is': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}
function avg(list) { return list.reduce((a, b) => a + b, 0) / (list.length || 1); }
function lastQuote(list) { return list.length ? list[list.length - 1] : null; }

/* ── Naive-but-useful natural language → bot translator ──────────────── */
/* Longest-alias match, so “Volatility 100 (1s)” wins over “Volatility 100”. */
function findSymbol(text) {
  let best = null, bestLen = 0;
  Object.keys(SYMBOLS).forEach((code) => {
    const name = SYMBOLS[code].name.toLowerCase();
    const short = name.replace(/\s*index$/, '');
    const aliases = [name, short, code.toLowerCase(), short.replace('volatility', 'vol'),
      name.replace(/[()]/g, ''), short.replace(/[()]/g, '')];
    aliases.forEach((a) => {
      if (a.length > 3 && text.includes(a) && a.length > bestLen) { best = code; bestLen = a.length; }
    });
  });
  return best;
}

export function botFromPrompt(text) {
  const t = String(text).toLowerCase();
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 2);
  const bot = defaultBot('AI ' + (words.join(' ') || 'strategy'));
  const sym = findSymbol(t);
  if (sym) {
    bot.params.symbol = sym;
    const tree = Object.entries(MARKET_TREE).find(([, m]) =>
      Object.values(m.submarkets).some((list) => list.includes(sym)));
    if (tree) {
      bot.params.market = tree[0];
      bot.params.submarket = Object.entries(tree[1].submarkets).find(([, l]) => l.includes(sym))[0];
    }
  }
  const stake = t.match(/stake\s*(?:of|:)?\s*\$?([\d.]+)/);
  if (stake) bot.setups.find((s) => s.name === 'Stake').value = +stake[1];
  const mart = t.match(/martingale\s*(?:of|:|\*|x)?\s*([\d.]+)/);
  if (mart) bot.setups.find((s) => s.name === 'Martingale_size').value = +mart[1];
  const sl = t.match(/stop[\s-]?loss\s*(?:of|:)?\s*\$?([\d.]+)/);
  if (sl) bot.setups.find((s) => s.name === 'Stop_loss').value = +sl[1];
  const tp = t.match(/take[\s-]?profit\s*(?:of|:)?\s*\$?([\d.]+)/);
  if (tp) bot.setups.find((s) => s.name === 'Take_profit').value = +tp[1];
  const maxT = t.match(/(?:max(?:imum)?\s*(?:trades|runs)|(\d+)\s*trades)/);
  if (maxT) bot.setups.find((s) => s.name === 'Max_trades').value = +(maxT[1] || 30);
  if (/even|odd/.test(t)) bot.params.contractType = 'evenodd';
  if (/differ|match/.test(t)) bot.params.contractType = 'diffmatch';
  if (/rise|fall|call|put|trend/.test(t)) { bot.params.tradeType = 'risefall'; bot.params.contractType = 'risefall'; }
  const digit = t.match(/digit\s*(?:>|over|above|>=)\s*(\d)/);
  if (digit) {
    bot.purchase = [{ id: 'p1', when: 'lastDigit', op: '>=', value: +digit[1], side: 'over', digit: +digit[1] }];
  } else if (/even/.test(t)) {
    bot.purchase = [{ id: 'p1', when: 'lastDigit', op: '==', value: 0, side: 'even', digit: 5 }];
  } else if (/rise|bull/.test(t)) {
    bot.purchase = [{ id: 'p1', when: 'maCross', op: 'is', value: 'bullish', side: 'rise', digit: 5 }];
  }
  if (/no martingale|flat stake|fixed stake/.test(t)) {
    bot.restart = [{ id: 'r1', when: 'result', op: 'is', value: 'Loss', action: 'reset' }];
    bot.setups = bot.setups.filter((s) => s.name !== 'Martingale_stake');
  }
  return bot;
}
