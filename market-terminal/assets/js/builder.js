/* ============================================================================
   Bot Builder UI — palette · block canvas · run panel.
   Mirrors the layout of the reference workspace: numbered parameter blocks on
   the canvas, a Blocks menu on the left, live Summary/Transactions/Journal on
   the right.
   ========================================================================== */
import { feed } from './feed.js';
import { SYMBOLS, MARKET_TREE, symbolDigits, symbolLabel, lastDigit } from './market.js';
import { fmt } from './config.js';
import {
  BLOCK_LIBRARY, VARIABLES, CONTRACT_TYPES, BotEngine,
  defaultBot, defaultKnockoutBot, botFromPrompt, contractLabel
} from './bot-engine.js';
import { toast, modal, confirmModal } from './ui.js';

/* ── DOM helper ───────────────────────────────────────────────────────── */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k))); });
  return el;
}

function select(options, value, onChange, cls = 'sel-box') {
  const el = h('select', { class: cls, onchange: (e) => onChange(e.target.value) });
  options.forEach(([v, label]) => el.append(h('option', { value: v, selected: String(v) === String(value) }, label)));
  return el;
}
function numInput(value, onChange, cls = 'num-box', opts = {}) {
  return h('input', {
    class: cls, type: 'number', value, step: opts.step || 'any', min: opts.min, max: opts.max,
    oninput: (e) => onChange(e.target.value)
  });
}
function toggle(on, onChange) {
  return h('button', { class: 'switch' + (on ? ' on' : ''), onclick: () => onChange(!on), type: 'button' });
}
function checkbox(on, onChange, label) {
  const box = h('span', { class: 'check' + (on ? ' on' : ''), html: on ? '<svg><use href="#i-close"/></svg>' : '' });
  const row = h('div', { class: 'rowp', onclick: () => onChange(!on) }, box, h('span', {}, label));
  row.style.cursor = 'pointer';
  return row;
}
function iconBtn(icon, title, onClick) {
  return h('button', { class: 'x', title, html: `<svg><use href="#${icon}"/></svg>`, onclick: onClick });
}

const INTERVALS = [[60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [3600, '1 hour'], [86400, '1 day']];
const OPS = ['>=', '<=', '>', '<', '==', '!='];

/* ══════════════════════════════════════════════════════════════════════════
   Builder
   ═════════════════════════════════════════════════════════════════════════ */
export class Builder {
  constructor(root, ctx = {}) {
    this.root = root;
    this.ctx = ctx;
    this.bot = ctx.bot || defaultBot();
    this.engine = ctx.engine || new BotEngine();
    this.stakeHistory = [];
    this.activeTab = 'summary';
    this.history = [];
    this.future = [];
    this._seedDigits = [];
    this.currency = ctx.currency || feed.currency;
    this._wireEngine();
    this.render();
  }

  /* ── Engine wiring ─────────────────────────────────────────────────── */
  _wireEngine() {
    const e = this.engine;
    const offs = [];
    offs.push(e.on('journal', () => { if (this.activeTab === 'journal') this.renderJournal(); }));
    offs.push(e.on('tick', (d) => {
      this._seedDigits = d.digits;
      this.updateDigitStrip(d);
      if (this.activeTab === 'summary') this.updateLiveProfit();
    }));
    offs.push(e.on('trade-settled', (row) => {
      this.stakeHistory.push({ stake: row.stake, profit: row.profit });
      /* The same table backs both the Summary and Transactions tabs. */
      this.renderTransactions();
      this.renderStats();
    }));
    offs.push(e.on('stats', (s) => { this.lastStats = s; this.renderStats(); }));
    offs.push(e.on('stake', (s) => { if (this.stakeEl) this.stakeEl.textContent = fmt.num(s); }));
    offs.push(e.on('started', () => this.setRunningUI(true)));
    offs.push(e.on('stopped', () => this.setRunningUI(false)));
    offs.push(e.on('error', (err) => toast('Bot error', err.message, 'err')));
    this._offs = offs;
  }

  /* The router calls this when the workspace is left, so a re-render never
     leaves a second set of listeners attached to the shared engine. */
  destroy() {
    (this._offs || []).forEach((off) => off());
    this._offs = [];
    if (this._stream) { this._stream.unsubscribe().catch(() => {}); this._stream = null; }
  }

  _detach() { (this._offs || []).forEach((off) => off()); this._offs = []; }

  setBot(bot, { keepHistory = false } = {}) {
    if (this.engine.running) this.engine.stop('replaced');
    this.bot = bot;
    if (!keepHistory) { this.engine.logLines = []; this.stakeHistory = []; }
    this.currency = feed.currency;
    this.render();
  }

  /* ── Top-level render ──────────────────────────────────────────────── */
  render() {
    this.root.innerHTML = '';
    /* The root is the router's <section class="view"> — add, never replace. */
    this.root.classList.add('builder');
    this.root.append(this.renderPalette(), this.renderWorkspace());
    this.renderStats();
    this.renderTransactions();
    this.renderJournal();
    this.setRunningUI(this.engine.running);
  }

  /* ── Palette ───────────────────────────────────────────────────────── */
  renderPalette() {
    const search = h('input', { placeholder: 'Search', oninput: (e) => this.filterBlocks(e.target.value) });
    const list = h('div', { class: 'bm-list', id: 'bmList' });

    BLOCK_LIBRARY.forEach((cat) => {
      const items = h('div', { class: 'bm-items' });
      cat.blocks.forEach((b) => {
        items.append(h('button', {
          class: 'bm-item', draggable: 'true',
          dataset: { block: b.id, section: b.section, title: b.title, search: (b.title + ' ' + b.hint).toLowerCase() },
          ondragstart: (e) => { e.dataTransfer.setData('text/block', b.id); e.dataTransfer.effectAllowed = 'copy'; },
          onclick: () => this.addBlock(b)
        },
          h('span', { class: 'bh', style: `background:${b.colour}` }, b.icon),
          h('span', {}, b.title, h('small', {}, b.hint))
        ));
      });
      const catEl = h('div', { class: 'bm-cat' + (cat.open ? ' open' : ''), dataset: { group: cat.group.toLowerCase() } },
        h('button', { onclick: (e) => e.currentTarget.parentElement.classList.toggle('open') },
          h('span', { class: 'em' }, cat.emoji || ''), cat.group, h('svg', { html: '<use href="#i-chevron"/>' })),
        items);
      list.append(catEl);
    });

    const menu = h('div', { class: 'blocks-menu' },
      h('div', { class: 'bm-head', onclick: (e) => e.currentTarget.parentElement.classList.toggle('collapsed') },
        h('h3', {}, 'Blocks menu'), h('svg', { html: '<use href="#i-chevron"/>' })),
      h('div', { class: 'bm-body' },
        h('div', { class: 'bm-search', html: '<svg><use href="#i-search"/></svg>' }, search),
        list));

    const ai = h('button', { class: 'ai-gen', onclick: () => this.openAI() },
      h('svg', { html: '<use href="#i-ai"/>' }), 'AI Bot Generator');

    return h('div', { class: 'palette' }, ai, menu);
  }

  filterBlocks(q) {
    const term = q.trim().toLowerCase();
    this.root.querySelectorAll('.bm-cat').forEach((cat) => {
      let visible = 0;
      cat.querySelectorAll('.bm-item').forEach((item) => {
        const hit = !term || item.dataset.search.includes(term) || cat.dataset.group.includes(term);
        item.style.display = hit ? '' : 'none';
        if (hit) visible++;
      });
      cat.style.display = visible ? '' : 'none';
      if (term && visible) cat.classList.add('open');
    });
  }

  /* ── Workspace (rail + canvas + run panel) ─────────────────────────── */
  renderWorkspace() {
    const rail = h('div', { class: 'bld-rail' });
    [['i-dashboard', 'Home', () => this.ctx.go && this.ctx.go('dashboard')],
    ['i-grid', 'Trade parameters', () => this.scrollTo('trade')],
    ['i-candle', 'Analysis', () => this.scrollTo('analysis')],
    ['i-bot', 'Purchase conditions', () => this.scrollTo('purchase')],
    ['i-copy', 'Sell conditions', () => this.scrollTo('sell')],
    ['i-refresh', 'Restart rules', () => this.scrollTo('restart')],
    ['i-save', 'Export bot', () => this.exportBot()],
    ['i-folder', 'Import bot', () => this.importBot()],
    ['i-trash', 'Reset', () => this.resetBot()]].forEach(([icon, title, fn], i) => {
      if (i === 6) rail.append(h('div', { class: 'sep' }));
      rail.append(h('button', { title, html: `<svg><use href="#${icon}"/></svg>`, onclick: fn }));
    });

    const tools = h('div', { class: 'canvas-tools' },
      iconBtn('i-refresh', 'Refresh data', () => toast('Market data', 'Re-seeding tick history…', 'ok')),
      iconBtn('i-folder', 'Load bot', () => this.importBot()),
      iconBtn('i-save', 'Save bot', () => this.saveBot()),
      h('div', { class: 'divider' }),
      iconBtn('i-candle', 'Toggle digit strip', () => this.toggleDigits()),
      iconBtn('i-grid', 'Load template', () => this.loadTemplate()),
      h('div', { class: 'divider' }),
      iconBtn('i-undo', 'Undo', () => this.undo()),
      iconBtn('i-redo', 'Redo', () => this.redo()),
      h('div', { class: 'divider' }),
      iconBtn('i-zoom-in', 'Zoom in', () => this.zoom(1.08)),
      iconBtn('i-zoom-out', 'Zoom out', () => this.zoom(0.93)),
      h('div', { class: 'spacer' }),
      h('span', { class: 'tool-label', id: 'botNameLabel' }, this.bot.name),
      h('button', { class: 'tool-label', style: 'cursor:pointer', onclick: () => this.renameBot() }, 'Rename'));

    const canvas = h('div', {
      class: 'canvas', id: 'botCanvas',
      ondragover: (e) => { e.preventDefault(); canvas.classList.add('dragover'); },
      ondragleave: () => canvas.classList.remove('dragover'),
      ondrop: (e) => {
        e.preventDefault(); canvas.classList.remove('dragover');
        const id = e.dataTransfer.getData('text/block');
        const block = BLOCK_LIBRARY.flatMap((c) => c.blocks).find((b) => b.id === id);
        if (block) this.addBlock(block);
      }
    });
    this.canvasEl = canvas;
    this.buildCanvas();

    const digitStrip = h('div', { class: 'canvas-tools', id: 'digitStrip', style: 'font-size:12px;color:#54617d' },
      h('span', { class: 'tool-label' }, 'Live digits'),
      h('span', { class: 'mono', id: 'digitRibbon' }, '—'));
    this.digitStripEl = digitStrip;

    const canvasCol = h('div', { class: 'canvas-col' }, tools, canvas, digitStrip);
    this.canvasColEl = canvasCol;

    return h('div', { class: 'workspace' }, rail, canvasCol, this.renderRunPanel());
  }

  scrollTo(section) {
    const el = this.canvasEl && this.canvasEl.querySelector(`[data-section-anchor="${section}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  toggleDigits() {
    if (this.digitStripEl) this.digitStripEl.hidden = !this.digitStripEl.hidden;
  }

  zoom(f) {
    this._zoom = Math.min(1.3, Math.max(0.7, (this._zoom || 1) * f));
    this.canvasColEl.style.fontSize = (13 * this._zoom) + 'px';
    this.canvasEl.style.transform = `scale(${this._zoom})`;
    this.canvasEl.style.transformOrigin = 'top left';
  }

  /* ── Canvas blocks ─────────────────────────────────────────────────── */
  buildCanvas() {
    const c = this.canvasEl;
    c.innerHTML = '';
    const p = this.bot.params;
    const set = (path, value) => this.edit(() => {
      const keys = path.split('.');
      let obj = this.bot;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
    }, { quiet: true });

    /* 1 · Trade parameters */
    const submarkets = Object.keys(MARKET_TREE[p.market].submarkets);
    if (!submarkets.includes(p.submarket)) p.submarket = submarkets[0];
    const symbolsInSub = MARKET_TREE[p.market].submarkets[p.submarket];
    if (!symbolsInSub.includes(p.symbol)) p.symbol = symbolsInSub[0];

    const trade = this.block(1, 'Trade parameters', 'trade', [
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Market:'),
        select(Object.entries(MARKET_TREE).map(([k, v]) => [k, v.label]), p.market, (v) => {
          set('params.market', v);
          set('params.submarket', Object.keys(MARKET_TREE[v].submarkets)[0]);
          set('params.symbol', Object.values(MARKET_TREE[v].submarkets)[0][0]);
          this.buildCanvas();
        }),
        h('span', { class: 'arrow' }, '›'),
        select(submarkets.map((s) => [s, s]), p.submarket, (v) => {
          set('params.submarket', v);
          set('params.symbol', MARKET_TREE[p.market].submarkets[v][0]);
          this.buildCanvas();
        }),
        h('span', { class: 'arrow' }, '›'),
        select(symbolsInSub.map((s) => [s, symbolLabel(s)]), p.symbol, (v) => { set('params.symbol', v); this.buildCanvas(); })),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Alternate markets (Continuous Indices only):'),
        toggle(p.alternateMarkets, (v) => set('params.alternateMarkets', v))),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Alternate mode:'),
        select([['random', 'Random'], ['sequential', 'Sequential'], ['off', 'Off']], p.alternateMode, (v) => set('params.alternateMode', v))),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Trade Type:'),
        select(Object.entries(CONTRACT_TYPES).map(([k, v]) => [k, v.label]), p.tradeType, (v) => {
          set('params.tradeType', v);
          set('params.contractType', CONTRACT_TYPES[v].types[0]);
          this.buildCanvas();
        }),
        h('span', { class: 'arrow' }, '›'),
        select(CONTRACT_TYPES[p.tradeType].types.map((t) => [t, t === 'overunder' ? 'Over/Under' : t === 'evenodd' ? 'Even/Odd' : t === 'diffmatch' ? 'Differs/Matches' : t === 'risefall' ? 'Rise/Fall' : 'Higher/Lower']),
          p.contractType, (v) => { set('params.contractType', v); this.buildCanvas(); })),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Contract Type:'),
        select([['both', 'Both'], ['over', 'Over only'], ['under', 'Under only']], p.contractSide || 'both', (v) => set('params.contractSide', v))),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Default Candle Interval:'),
        select(INTERVALS, p.candleInterval, (v) => set('params.candleInterval', +v))),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Restart buy/sell on error (disable for better performance):'),
        toggle(p.restartOnError, (v) => set('params.restartOnError', v))),
      h('div', { class: 'rowp' },
        h('span', { class: 'lbl' }, 'Virtual Hook:'),
        toggle(p.useVirtualHook, (v) => set('params.useVirtualHook', v)),
        p.useVirtualHook ? h('span', { class: 'chip' }, 'VH Settings ⚡') : null),
      checkbox(p.restartLastTradeOnError, (v) => set('params.restartLastTradeOnError', v),
        'Restart last trade on error (bot ignores the unsuccessful trade):')
    ]);

    /* 2 · Analysis gate */
    const analysis = this.block(2, 'Analysis', 'analysis',
      this.bot.analysis.map((r, i) => h('div', { class: 'set-block' },
        h('span', { class: 'kw' }, 'Analyse'),
        select([['digit-freq', 'digit sample size'], ['maCross', 'moving average cross'], ['always', 'nothing (always trade)']], r.when,
          (v) => this.edit(() => { this.bot.analysis[i].when = v; }, { rerender: true })),
        h('span', { class: 'eq' }, r.op),
        numInput(r.value, (v) => this.edit(() => { this.bot.analysis[i].value = Number(v); }, { quiet: true })),
        h('span', { class: 'blk-hint' }, r.when === 'maCross' ? 'bullish / bearish' : r.note || ''),
        iconBtn('i-trash', 'Remove', () => this.edit(() => { this.bot.analysis.splice(i, 1); }, { rerender: true })))),
      h('button', { class: 'add-set', onclick: () => this.edit(() => { this.bot.analysis.push({ id: 'a' + Date.now(), when: 'digit-freq', op: '>=', value: 10 }); }, { rerender: true }) }, '+ Add analysis block'),
      h('div', { class: 'blk-hint' }, `Digits sampled this run: ${this._seedDigits.length}`)
    );

    /* 3 · Purchase conditions */
    const purchase = this.block(3, 'Purchase conditions', 'purchase',
      this.bot.purchase.map((r, i) => h('div', { class: 'set-block' },
        h('span', { class: 'kw' }, 'Buy when'),
        select([['lastDigit', 'last digit'], ['streak', 'streak length'], ['maCross', 'moving average'], ['always', 'always']], r.when,
          (v) => this.edit(() => { this.bot.purchase[i].when = v; }, { rerender: true })),
        h('span', { class: 'eq' }, r.op),
        numInput(r.value, (v) => this.edit(() => { this.bot.purchase[i].value = Number(v); }, { quiet: true })),
        h('span', { class: 'arrow' }, '→'),
        select([['over', 'Over'], ['under', 'Under'], ['even', 'Even'], ['odd', 'Odd'], ['differs', 'Differs'], ['matches', 'Matches'], ['rise', 'Rise'], ['fall', 'Fall']],
          r.side, (v) => this.edit(() => { this.bot.purchase[i].side = v; }, { rerender: true })),
        h('span', { class: 'rowp' }, h('span', { class: 'blk-hint' }, 'digit'), numInput(r.digit, (v) => this.edit(() => { this.bot.purchase[i].digit = Number(v); }, { quiet: true }))),
        iconBtn('i-trash', 'Remove', () => this.edit(() => { this.bot.purchase.splice(i, 1); }, { rerender: true })))),
      h('button', { class: 'add-set', onclick: () => this.edit(() => { this.bot.purchase.push({ id: 'p' + Date.now(), when: 'lastDigit', op: '>=', value: 5, side: 'over', digit: 5 }); }, { rerender: true }) }, '+ Add purchase condition')
    );

    /* 4 · Sell conditions */
    const sell = this.block(4, 'Sell conditions (optional)', 'sell',
      this.bot.sell.map((r, i) => h('div', { class: 'set-block' },
        h('span', { class: 'kw' }, 'Stop bot when'),
        select([['totalProfit', 'total profit/loss'], ['trades', 'number of trades'], ['consecutiveLosses', 'consecutive losses']], r.when,
          (v) => this.edit(() => { this.bot.sell[i].when = v; }, { rerender: true })),
        h('span', { class: 'eq' }, r.op),
        numInput(r.value, (v) => this.edit(() => { this.bot.sell[i].value = Number(v); }, { quiet: true })),
        h('span', { class: 'blk-hint' }, this.currency),
        iconBtn('i-trash', 'Remove', () => this.edit(() => { this.bot.sell.splice(i, 1); }, { rerender: true })))),
      h('button', { class: 'add-set', onclick: () => this.edit(() => { this.bot.sell.push({ id: 'x' + Date.now(), when: 'totalProfit', op: '<=', value: -100, action: 'stop' }); }, { rerender: true }) }, '+ Add sell condition')
    );

    /* 5 · Restart trading conditions */
    const restart = this.block(5, 'Restart trading conditions', 'restart',
      this.bot.restart.map((r, i) => h('div', { class: 'set-block' },
        h('span', { class: 'kw' }, 'If'),
        select([['result', 'Result'], ['consecutiveLosses', 'Consecutive losses'], ['totalProfit', 'Total profit/loss']], r.when,
          (v) => this.edit(() => { this.bot.restart[i].when = v; }, { rerender: true })),
        h('span', { class: 'eq' }, 'is'),
        r.when === 'result'
          ? select([['Win', 'Win'], ['Loss', 'Loss']], r.value, (v) => this.edit(() => { this.bot.restart[i].value = v; }, { rerender: true }))
          : numInput(r.value, (v) => this.edit(() => { this.bot.restart[i].value = Number(v); }, { quiet: true })),
        h('span', { class: 'arrow' }, 'then'),
        select([['reset', 'reset stake to base'], ['martingale', 'apply martingale'], ['increase', 'increase stake'], ['stop', 'stop the bot']], r.action,
          (v) => this.edit(() => { this.bot.restart[i].action = v; }, { rerender: true })),
        iconBtn('i-trash', 'Remove', () => this.edit(() => { this.bot.restart.splice(i, 1); }, { rerender: true })))),
      h('button', { class: 'add-set', onclick: () => this.edit(() => { this.bot.restart.push({ id: 'r' + Date.now(), when: 'result', op: 'is', value: 'Loss', action: 'martingale' }); }, { rerender: true }) }, '+ Add restart condition')
    );

    /* 6 · Run once at start */
    const setups = h('div', { class: 'blk-body', style: 'background:#fff' });
    this.bot.setups.forEach((s, i) => {
      if (s.name === 'Martingale_stake') {
        setups.append(h('div', { class: 'set-block' },
          h('span', { class: 'kw' }, 'set'),
          select(VARIABLES.map((v) => [v.name, v.name]), s.name, () => {}),
          h('span', { class: 'eq' }, 'to'),
          select(VARIABLES.map((v) => [v.name, v.name]), s.value, (v) => this.edit(() => { this.bot.setups[i].value = v; }, { quiet: true })),
          h('span', { class: 'blk-hint' }, '(uses the current Stake value)')));
      } else if (s.name === 'Martingale_size' || s.name === 'Multiplier') {
        setups.append(this.setupRow(s, i));
      } else {
        setups.append(this.setupRow(s, i));
      }
    });
    setups.append(h('button', { class: 'add-set', onclick: () => this.edit(() => { this.bot.setups.push({ id: 's' + Date.now(), name: 'Stake', value: 1 }); }, { rerender: true }) },
      '+ Add “set variable” block'));
    const startBlock = h('div', { class: 'blk alt' },
      h('div', { class: 'blk-head' }, h('span', { class: 'idx' }, '6.'), h('span', {}, 'Run once at start'), h('span', { class: 'spacer' })),
      setups);
    startBlock.dataset.sectionAnchor = 'start';

    const drop = h('div', { class: 'blk-drop' }, 'Drag a block from the Blocks menu and drop it here to extend the strategy.');

    [trade, analysis, purchase, sell, restart, startBlock, drop].forEach((b) => c.append(b));
  }

  setupRow(s, i) {
    const v = VARIABLES.find((x) => x.name === s.name) || { unit: '' };
    const row = h('div', { class: 'set-block' },
      h('span', { class: 'kw' }, 'set'),
      select(VARIABLES.map((x) => [x.name, x.name]), s.name, (val) => this.edit(() => { this.bot.setups[i].name = val; }, { rerender: true })),
      h('span', { class: 'eq' }, 'to'),
      numInput(s.value, (val) => this.edit(() => { this.bot.setups[i].value = Number(val); }, { quiet: true })),
      h('span', { class: 'blk-hint' }, v.unit || ''),
      iconBtn('i-trash', 'Remove', () => this.edit(() => { this.bot.setups.splice(i, 1); }, { rerender: true }))
    );
    return row;
  }

  block(index, title, anchor, body) {
    const el = h('div', { class: 'blk' },
      h('div', { class: 'blk-head' },
        h('span', { class: 'idx' }, index + '.'),
        h('span', {}, title),
        h('span', { class: 'spacer' }),
        h('span', { class: 'grip', html: '<svg><use href="#i-grid"/></svg>' })),
      h('div', { class: 'blk-body' }, body));
    el.dataset.sectionAnchor = anchor;
    return el;
  }

  addBlock(block) {
    const b = block || {};
    switch (b.section) {
      case 'purchase':
        this.edit(() => this.bot.purchase.push({ id: 'p' + Date.now(), when: 'lastDigit', op: '>=', value: 5, side: 'over', digit: 5 }), { rerender: true });
        this.scrollTo('purchase');
        toast('Block added', 'Purchase condition', 'ok');
        break;
      case 'sell':
        this.edit(() => this.bot.sell.push({ id: 'x' + Date.now(), when: 'totalProfit', op: '<=', value: -50, action: 'stop' }), { rerender: true });
        this.scrollTo('sell');
        break;
      case 'restart':
        this.edit(() => this.bot.restart.push({ id: 'r' + Date.now(), when: 'result', op: 'is', value: 'Loss', action: 'martingale' }), { rerender: true });
        this.scrollTo('restart');
        break;
      case 'analysis':
        this.edit(() => this.bot.analysis.push({ id: 'a' + Date.now(), when: 'digit-freq', op: '>=', value: 10 }), { rerender: true });
        this.scrollTo('analysis');
        break;
      case 'setups':
        this.edit(() => this.bot.setups.push({ id: 's' + Date.now(), name: 'Stake', value: 1 }), { rerender: true });
        break;
      case 'ai': this.openAI(); break;
      case 'utility':
        this.engine.log('info', 'Journal note block added');
        this.renderJournal();
        break;
      case 'trade':
      default: this.scrollTo('trade'); toast('Already on the canvas', 'Trade parameters block is always present', 'warn');
    }
  }

  /* ── Edit history ──────────────────────────────────────────────────── */
  edit(fn, opts = {}) {
    const snap = JSON.stringify(this.bot);
    fn();
    if (!opts.quiet) { this.history.push(snap); this.future.length = 0; }
    if (opts.rerender) this.buildCanvas();
    this.ctx.persist && this.ctx.persist(this.bot);
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.bot));
    this.bot = JSON.parse(this.history.pop());
    this.render();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.bot));
    this.bot = JSON.parse(this.future.pop());
    this.render();
  }

  /* ── Run panel ─────────────────────────────────────────────────────── */
  renderRunPanel() {
    this.runBtn = h('button', { class: 'btn-run', onclick: () => this.toggleRun() },
      h('svg', { html: '<use href="#i-play"/>' }), h('span', {}, 'Run'));
    this.stateLabel = h('b', {}, 'Bot is not running');
    this.stakeEl = h('span', {}, fmt.num(this.bot.setups.find((s) => s.name === 'Stake')?.value || 0));
    this.runHead = h('div', { class: 'run-head' }, this.runBtn,
      h('div', { class: 'run-status' }, this.stateLabel,
        h('small', {}, 'Next stake: ', this.stakeEl, ' ', this.currency),
        h('div', { class: 'run-bar' }, h('i', { id: 'runBar' }))));

    this.summaryPane = h('div', { class: 'tabpane', id: 'paneSummary' });
    this.txPane = h('div', { class: 'tabpane', id: 'paneTx', hidden: true });
    this.journalPane = h('div', { class: 'tabpane journal', id: 'paneJournal', hidden: true });

    const tabs = h('div', { class: 'tabs' });
    [['summary', 'Summary'], ['transactions', 'Transactions'], ['journal', 'Journal']].forEach(([key, label]) => {
      tabs.append(h('button', {
        class: key === this.activeTab ? 'on' : '', dataset: { tab: key },
        onclick: () => this.selectTab(key)
      }, label));
    });
    this.tabsEl = tabs;

    // Summary layout
    this.summaryPane.append(
      h('div', { class: 'dl-row' },
        h('button', { class: 'btn solid', onclick: () => this.downloadCSV() }, h('svg', { html: '<use href="#i-download"/>' }), 'Download'),
        h('button', { class: 'btn plain', onclick: () => this.viewDetail() }, h('svg', { html: '<use href="#i-eye"/>' }), 'View Detail')),
      this.renderTransactionsTable(),
      h('span', { class: 'whats', onclick: () => toast('Statistics', 'Computed live from every settled contract in this run.', 'ok') }, "What's this?"),
      h('div', { class: 'stat-grid', id: 'statGrid' }),
      h('button', { class: 'btn plain', style: 'width:100%;justify-content:center;margin-top:10px', onclick: () => this.resetRun() }, 'Reset'),
      h('div', { class: 'bot-note', id: 'botNote' }, 'The bot will trade on your authorised Deriv account.')
    );

    const card = h('div', { class: 'summary-card' }, tabs, this.summaryPane, this.txPane, this.journalPane);
    this.runPanel = h('div', { class: 'runpanel' }, this.runHead, card);
    return this.runPanel;
  }

  selectTab(key) {
    this.activeTab = key;
    [...this.tabsEl.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    this.summaryPane.hidden = key !== 'summary';
    this.txPane.hidden = key !== 'transactions';
    this.journalPane.hidden = key !== 'journal';
    if (key === 'transactions') this.renderTransactions();
    if (key === 'journal') this.renderJournal();
    if (key === 'summary') { this.renderStats(); this.renderTransactions(); }
  }

  renderTransactionsTable() {
    const wrap = h('table', { class: 'tx-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Type'), h('th', {}, 'Entry/Exit spot'), h('th', { class: 'num' }, 'Buy price and P/L'))));
    const body = h('tbody', { id: 'txBody' });
    this.txBody = body;
    wrap.append(body);
    this.txTableWrap = wrap;
    return wrap;
  }

  renderTransactions() {
    if (!this.txBody) return;
    const rows = this.engine.tradesRows.slice(0, 40);
    this.txBody.innerHTML = '';
    if (!rows.length) {
      this.txBody.append(h('tr', {}, h('td', { colspan: '3', style: 'color:#7b879c;text-align:center;padding:22px' }, 'No transactions yet — press Run to start trading.')));
      return;
    }
    rows.forEach((r) => {
      const icon = r.type.includes('Over') ? '▲' : r.type.includes('Under') ? '▼' : r.won ? '✔' : '✖';
      const dir = r.type.includes('Over') || r.type.includes('Rise') ? 'up' : 'down';
      this.txBody.append(h('tr', {},
        h('td', {}, h('span', { class: 'tx-icon', style: `color:${dir === 'up' ? '#12558f' : '#b3121a'}` }, icon)),
        h('td', {},
          h('div', {}, h('span', { class: 'chip', style: `background:${dir === 'up' ? '#e7f3fd' : '#fdeaea'};color:${dir === 'up' ? '#12558f' : '#b3121a'}` }, dir === 'up' ? '↑' : '↓'), ' ',
            this.digitsOf(r.entry)),
          h('div', { class: 'mono', style: 'color:#7b879c' }, '⚪ ' + this.digitsOf(r.exit))),
        h('td', { class: 'num' },
          h('div', {}, fmt.num(r.stake), ' ', this.currency),
          h('div', { class: r.profit >= 0 ? 'up' : 'down' }, fmt.signed(r.profit), ' ', this.currency))));
    });
  }

  digitsOf(v) {
    if (v == null) return '—';
    return Number(v).toFixed(symbolDigits(this.bot.params.symbol));
  }

  renderStats() {
    const grid = this.root.querySelector('#statGrid');
    if (!grid) return;
    const s = this.engine.stats();
    const cells = [
      ['Total stake', fmt.num(s.totalStake) + ' ' + this.currency],
      ['Total payout', fmt.num(s.totalPayout) + ' ' + this.currency],
      ['No. of runs', String(s.trades)],
      ['Contracts lost', String(s.losses)],
      ['Contracts won', String(s.wins)],
      ['Total profit/loss', h('span', { class: s.profit >= 0 ? 'up' : 'down' }, fmt.signed(s.profit) + ' ' + this.currency)]
    ];
    grid.innerHTML = '';
    cells.forEach(([label, value]) => {
      grid.append(h('div', {}, h('em', {}, label), h('b', {}, typeof value === 'string' ? value : value)));
    });
    const note = this.root.querySelector('#botNote');
    if (note) {
      note.textContent = s.running
        ? `Running · ${s.trades} trades · win rate ${fmt.num(s.winRate, 1)}% · next stake ${fmt.num(s.stake)}`
        : `Idle · ${s.trades} trades this run`;
    }
    const bar = this.root.querySelector('#runBar');
    if (bar) {
      const max = Number(this.bot.setups.find((x) => x.name === 'Max_trades')?.value || 30);
      bar.style.width = Math.min(100, (s.trades / Math.max(max, 1)) * 100) + '%';
    }
  }

  updateLiveProfit() {
    const el = this.root.querySelector('#liveProfit');
    if (!el) return;
    el.textContent = fmt.signed(this.engine.profit);
    el.className = this.engine.profit >= 0 ? 'up' : 'down';
  }

  updateDigitStrip(d) {
    const el = this.root.querySelector('#digitRibbon');
    if (!el) return;
    const tail = d.digits.slice(-24);
    el.innerHTML = tail.map((n) => `<span style="display:inline-block;width:16px;text-align:center;color:${n >= 5 ? '#12558f' : '#b3121a'};font-weight:700">${n}</span>`).join('');
    this._seedDigits = d.digits;
  }

  renderJournal() {
    const pane = this.journalPane;
    if (!pane) return;
    pane.innerHTML = '';
    const lines = this.engine.logLines;
    if (!lines.length) {
      pane.append(h('div', { style: 'color:#7b879c' }, 'Journal is empty — press Run.'));
      return;
    }
    lines.slice(-260).forEach((line) => {
      pane.append(h('div', {},
        h('span', { class: 't' }, fmt.time(line.at)),
        h('span', { class: line.kind }, line.text)));
    });
    pane.scrollTop = pane.scrollHeight;
  }

  setRunningUI(running) {
    if (!this.runBtn) return;
    this.runBtn.classList.toggle('stop', running);
    this.runBtn.innerHTML = running
      ? '<svg><use href="#i-close"/></svg><span>Stop</span>'
      : '<svg><use href="#i-play"/></svg><span>Run</span>';
    if (this.stateLabel) this.stateLabel.textContent = running ? 'Bot is running' : 'Bot is not running';
    if (this.stateLabel) this.stateLabel.style.color = running ? '#0e7b3f' : '';
    if (this.ctx.onRunning) this.ctx.onRunning(running);
  }

  async toggleRun() {
    if (this.engine.running) {
      this.engine.stop('stopped by user');
      return;
    }
    if (!feed.authorized) {
      toast('Not logged in', 'Connect your Deriv account first, or run on the simulated feed.', 'warn');
      this.ctx.requireAuth && this.ctx.requireAuth();
      return;
    }
    this.stakeHistory = [];
    this.selectTab('journal');
    try {
      this.currency = feed.currency;
      await this.engine.start(this.bot);
    } catch (e) {
      toast('Could not start bot', e.message, 'err');
      this.setRunningUI(false);
    }
  }

  resetRun() {
    if (this.engine.running) this.engine.stop('reset');
    this.engine.tradesRows = [];
    this.engine.trades = 0; this.engine.wins = 0; this.engine.losses = 0;
    this.engine.totalStake = 0; this.engine.totalPayout = 0;
    this.engine.stake = this.engine.baseStake || 1;
    this.engine.logLines = [];
    this.renderStats(); this.renderTransactions(); this.renderJournal();
    toast('Summary reset', 'Counters cleared for a fresh run.', 'ok');
  }

  viewDetail() {
    const s = this.engine.stats();
    const rows = s.rows.slice(0, 50).map((r) =>
      `<tr><td class="mono">${r.id}</td><td>${r.type}</td><td class="mono">${this.digitsOf(r.entry)} → ${this.digitsOf(r.exit)}</td>
       <td class="num">${fmt.num(r.stake)}</td><td class="num ${r.profit >= 0 ? 'up' : 'down'}">${fmt.signed(r.profit)}</td>
       <td>${fmt.time(r.at)}</td></tr>`).join('');
    modal({
      title: 'Run detail',
      subtitle: `${s.trades} contracts · net ${fmt.signed(s.profit)} ${this.currency}`,
      body: `<table class="data"><thead><tr><th>Contract</th><th>Type</th><th>Entry → Exit</th><th class="num">Stake</th><th class="num">P/L</th><th>Time</th></tr></thead>
             <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#7b879c">No contracts in this run yet.</td></tr>'}</tbody></table>`,
      actions: [{ label: 'Close', primary: true }]
    });
  }

  downloadCSV() {
    const rows = this.engine.tradesRows;
    if (!rows.length) { toast('Nothing to download', 'Run the bot first.', 'warn'); return; }
    const header = 'contract_id,type,entry_spot,exit_spot,stake,payout,profit,currency,settled_at\n';
    const body = rows.map((r) => [r.id, r.type, this.digitsOf(r.entry), this.digitsOf(r.exit), r.stake, r.payout, r.profit, this.currency, r.at.toISOString()].join(',')).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bsf-run-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Download ready', `${rows.length} transactions exported`, 'ok');
  }

  /* ── Bot file handling ─────────────────────────────────────────────── */
  exportBot() {
    const blob = new Blob([JSON.stringify(this.bot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.bot.name.replace(/\s+/g, '_').toLowerCase() + '.bsf.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Bot exported', 'Import it later or share it.', 'ok');
  }

  importBot() {
    const input = h('input', { type: 'file', accept: '.json,.xml', style: 'display:none' });
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.params || !parsed.setups) throw new Error('Not a Binary Signal Flow bot file');
          this.setBot(parsed);
          toast('Bot imported', parsed.name || 'Untitled bot', 'ok');
        } catch (e) {
          toast('Import failed', e.message, 'err');
        }
      };
      reader.readAsText(file);
    };
    document.body.append(input);
    input.click();
    input.remove();
  }

  saveBot() {
    const bots = JSON.parse(localStorage.getItem('bsf.bots') || '{}');
    bots[this.bot.name] = this.bot;
    localStorage.setItem('bsf.bots', JSON.stringify(bots));
    toast('Bot saved', `“${this.bot.name}” stored locally`, 'ok');
  }

  loadTemplate() {
    const useKnockout = this.bot.name.includes('Martingale');
    this.setBot(useKnockout ? defaultKnockoutBot() : defaultBot(), { keepHistory: true });
    toast('Template loaded', this.bot.name, 'ok');
  }

  renameBot() {
    modal({
      title: 'Rename bot',
      body: `<div class="field"><label>Bot name</label><input id="botNameInput" value="${this.bot.name.replace(/"/g, '&quot;')}"></div>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', primary: true, onClick: (rootEl) => {
            const v = rootEl.querySelector('#botNameInput').value.trim();
            if (v) {
              this.bot.name = v;
              const lbl = this.root.querySelector('#botNameLabel');
              if (lbl) lbl.textContent = v;
              this.ctx.persist && this.ctx.persist(this.bot);
            }
          }
        }
      ]
    });
  }

  async resetBot() {
    const ok = await confirmModal('Reset the canvas?', 'Every block returns to the default Martingale template. Your exported bots are untouched.');
    if (ok) { this.setBot(defaultBot()); toast('Canvas reset', 'Default template restored', 'ok'); }
  }

  /* ── AI generator ──────────────────────────────────────────────────── */
  openAI() {
    const examples = [
      'Volatility 100, stake 2.5, buy digit over 5, martingale 1.5, stop loss 100',
      'Rise/Fall on Volatility 100 1s using moving averages, flat stake 1, max 20 trades',
      'Even/Odd bot on Boom 500 with 10 USD take profit and no martingale'
    ];
    const root = modal({
      title: 'AI Bot Generator',
      subtitle: 'Describe the strategy in plain English — the generator assembles the blocks, you can edit everything afterwards.',
      body: `<div class="ai-panel">
        <textarea id="aiPrompt" placeholder="e.g. trade Volatility 100, stake 2.5 USD, buy digit Over 5, apply martingale 1.5 after a loss, stop at 100 USD profit"></textarea>
        <div class="ai-chips">${examples.map((e, i) => `<button data-ex="${i}">${e.slice(0, 44)}…</button>`).join('')}</div>
        <div class="ai-out" id="aiOut">Awaiting a prompt…</div>
      </div>`,
      actions: [
        { label: 'Cancel' },
        { label: 'Generate blocks', primary: true, keepOpen: true, onClick: (el) => {
            const text = el.querySelector('#aiPrompt').value.trim();
            if (!text) return;
            const out = el.querySelector('#aiOut');
            out.textContent = 'Parsing intent → blocks…';
            setTimeout(() => {
              const bot = botFromPrompt(text);
              out.textContent = `Draft bot “${bot.name}”\n· Market: ${bot.params.market} › ${bot.params.submarket} › ${symbolLabel(bot.params.symbol)}\n· Type: ${bot.params.tradeType} / ${bot.params.contractType}\n· Conditions: ${bot.purchase.length} purchase · ${bot.sell.length} sell · ${bot.restart.length} restart\n· Stake ${bot.setups.find((s) => s.name === 'Stake').value}`;
              this.setBot(bot, { keepHistory: true });
              toast('Draft bot generated', 'Review the blocks and press Run.', 'ok');
            }, 420);
          } }
      ]
    });
    root.querySelectorAll('.ai-chips button').forEach((b) => {
      b.onclick = () => { root.querySelector('#aiPrompt').value = examples[+b.dataset.ex]; };
    });
  }

  /* ── Live tick ribbon on the canvas ─────────────────────────────────── */
  attachMarketStream() {
    const symbol = this.bot.params.symbol;
    if (this._stream) this._stream.unsubscribe().catch(() => {});
    feed.tickStream(symbol, (t) => {
      const strip = this.root.querySelector('#digitRibbon');
      if (!strip) return;
      this._seedDigits.push(lastDigit(t.quote, symbolDigits(symbol)));
      if (this._seedDigits.length > 400) this._seedDigits.shift();
      this.updateDigitStrip({ digits: this._seedDigits });
    }).then((s) => { this._stream = s; }).catch(() => {});
  }
}
