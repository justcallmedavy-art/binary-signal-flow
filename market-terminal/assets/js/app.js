/* ============================================================================
   Application shell: boot → landing → dashboard.

   · preloader talks to Deriv while it animates
   · OAuth redirect (or API token) creates the session
   · nav routes into lazily-rendered views
   ========================================================================== */
import { CONFIG, STORE, appId, fmt, gmtStamp } from './config.js';
import { api, restoreSession } from './deriv.js';
import { feed } from './feed.js';
import { SYMBOLS, DEFAULT_SYMBOLS, symbolLabel, symbolDigits, MARKET_TREE, lastDigit, CandleChart } from './market.js';
import { h, Builder } from './builder.js';
import { BotEngine, defaultBot, defaultKnockoutBot } from './bot-engine.js';
import { toast, modal, closeModal, confirmModal } from './ui.js';

/* ── Session state ─────────────────────────────────────────────────────── */
export const state = {
  view: 'dashboard',
  accounts: [],
  activeAccount: null,
  balance: { balance: null, currency: 'USD', loginid: null },
  watch: STORE.get('watch', DEFAULT_SYMBOLS.slice(0, 6)),
  selected: STORE.get('selected', 'R_100'),
  prices: {},
  engine: new BotEngine(),
  builder: null,
  streams: [],
  demo: { balance: 9914.6, currency: 'USD', loginid: 'DOT94408793' }
};

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'i-dashboard' },
  { key: 'bot-builder', label: 'Bot Builder', icon: 'i-bot' },
  { key: 'charts', label: 'Charts', icon: 'i-charts' },
  { key: 'bots', label: 'Trading Bots', icon: 'i-robots' },
  { key: 'bulk', label: 'Bulk Trader', icon: 'i-bulk' },
  { key: 'analysis', label: 'Analysis Tool', icon: 'i-analysis' },
  { key: 'reports', label: 'Reports', icon: 'i-report' },
  { key: 'risk', label: 'Risk Calculator', icon: 'i-risk' },
  { key: 'copy', label: 'Copy Trading', icon: 'i-copy' },
  { key: 'dtrader', label: 'DTrader', icon: 'i-quote', flag: true }
];

const st = () => document.getElementById('stage');
const viewEl = (name) => st().querySelector(`[data-view="${name}"]`);

/* ══════════════════════════════════════════════════════════════════════════
   BOOT
   ═════════════════════════════════════════════════════════════════════════ */
const PL_STEPS = ['Connecting to Deriv', 'Streaming market feed', 'Loading block library', 'Preparing your workspace'];

async function boot() {
  const fill = document.getElementById('plFill');
  const status = document.getElementById('plStatus');
  let step = 0;
  const tick = setInterval(() => {
    step = Math.min(step + 1, PL_STEPS.length - 1);
    status.textContent = PL_STEPS[step];
  }, 420);
  fill.style.width = '12%';

  /* Kick off the socket while the loader animates — it is cheap and makes the
     dashboard appear with live prices already flowing. */
  const connecting = api.connect().catch(() => null);
  fill.style.width = '45%';

  handleAuthRedirect();
  const session = await Promise.race([connecting, new Promise((r) => setTimeout(r, 4500))]);
  if (session) fill.style.width = '70%';

  const token = STORE.get('token', null);
  if (token) {
    fill.style.width = '85%';
    await Promise.race([restoreSession(), new Promise((r) => setTimeout(r, 6000))]);
  }

  wireLanding();
  clearInterval(tick);
  fill.style.width = '100%';
  status.textContent = 'Ready';
  await new Promise((r) => setTimeout(r, 420));
  document.getElementById('preloader').classList.add('done');
  document.body.classList.remove('booting');

  /* Deriv's WebSocket is the only source of live data; if it is not up (and no
     session is stored) fall back to the labelled paper-trading simulator so
     every view still works. The socket keeps retrying in the background. */
  if (!api.connected && !api.authorized) feed.useSimulator('Deriv socket unreachable');

  /* A stored Deriv session goes straight to the workspace; everyone else gets
     the landing page (skipping login is deliberately session-only). */
  if (api.authorized) enterApp();
  else showLanding();
}

function showLanding() {
  const landing = document.getElementById('landing');
  document.getElementById('app').hidden = true;
  landing.hidden = false;
  document.querySelectorAll('#landing .reveal').forEach((el, i) => {
    setTimeout(() => el.classList.add('in'), 90 * i);
  });
  if (window.__bsfLanding) window.__bsfLanding.start();
}

function enterApp() {
  document.getElementById('landing').hidden = true;
  const app = document.getElementById('app');
  app.hidden = false;
  if (window.__bsfLanding) window.__bsfLanding.stop();
  buildNav();
  buildAccountMenu();
  go('dashboard');
  watchBalance();
  wireChrome();
  renderModeBanner();
  feed.addEventListener('modechange', () => {
    renderModeBanner();
    go(state.view);
  });
}

/* A thin strip under the welcome banner whenever we are not on live Deriv. */
function renderModeBanner() {
  const existing = document.getElementById('modeBanner');
  if (existing) existing.remove();
  const banner = h('div', {
    id: 'modeBanner',
    style: 'flex:none;display:flex;align-items:center;gap:10px;padding:7px 16px;font-size:12.5px;font-weight:600;' +
      (api.authorized ? 'background:#e6f7ee;color:#0e7b3f;border-bottom:1px solid #c9ecd9' : 'background:#fdf1de;color:#8a5a12;border-bottom:1px solid #f2dfbe')
  },
    h('span', { html: `<svg style="width:15px;height:15px" ><use href="#${api.authorized ? 'i-lock' : 'i-risk'}"/></svg>` }),
    h('span', {}, api.authorized
      ? `Live · ${api.auth.loginid} (${api.auth.currency}) — orders are placed on your Deriv account.`
      : 'Paper trading on the simulated feed — Deriv’s WebSocket is not reachable, so no real orders are placed and prices are generated locally.'),
    h('span', { style: 'flex:1' }),
    h('button', {
      class: 'btn plain mini',
      onclick: () => {
        toast('Retrying Deriv', 'Attempting a fresh WebSocket connection…');
        api.resetRetries();
        api.disconnect();
        api.connect().then(() => {
          if (STORE.get('token')) return restoreSession();
        }).then(() => {
          feed.useLive();
          if (!api.connected) toast('Still unreachable', 'Deriv declined the socket — staying on the simulator.', 'warn');
        }).catch(() => toast('Still unreachable', 'Deriv declined the socket — staying on the simulator.', 'warn'));
      }
    }, 'Retry live feed'));
  document.getElementById('app').insertBefore(banner, document.getElementById('mainNav'));
}

/* ── Auth ──────────────────────────────────────────────────────────────── */
function handleAuthRedirect() {
  const redirect = api.readRedirect();
  if (!redirect) return;
  api.clearRedirect();
  STORE.set('token', redirect.token);
  if (redirect.accounts && redirect.accounts.length) {
    STORE.set('accounts', redirect.accounts);
    STORE.set('loginid', redirect.accounts[0].loginid);
  }
  history.replaceState(null, '', location.origin + location.pathname);
}

function openAuth(mode = 'signup') {
  const redirectUri = location.origin + location.pathname;
  const currentAppId = appId();
  const content = modal({
    title: mode === 'signup' ? 'Create your Deriv account' : 'Log in with Deriv',
    subtitle: 'Authentication happens on Deriv’s own OAuth page — Binary Signal Flow never sees your password, and trading runs on Deriv’s API under your own account.',
    body: `
      <div class="deriv-login">
        <div class="hero-mini">
          <div class="dm">D</div>
          <div><b>Deriv OAuth 2.0</b><small>app_id ${currentAppId} · redirect ${redirectUri}</small></div>
        </div>
        <div class="note">
          Sign-up and login both use the same Deriv screen: new users get an account in a couple of minutes,
          existing users just authorise access. Your virtual (demo) account works too — switch to it from the account menu.
        </div>
        <div class="field">
          <label>App ID (advanced)</label>
          <input id="appIdInput" value="${currentAppId}" placeholder="1089">
        </div>
        <div class="field">
          <label>Or paste an API token</label>
          <input id="tokenInput" placeholder="a1-xxxxxxxxxxxxxxxxxxxxxxxx" />
        </div>
      </div>`,
    actions: [
      {
        label: 'Continue with Deriv', primary: true, keepOpen: true, onClick: (el) => {
          const id = el.querySelector('#appIdInput').value.trim();
          if (id) STORE.set('app_id', id);
          toast('Redirecting to Deriv', 'Authorise access, you will come straight back.');
          setTimeout(() => api.startOAuth(), 500);
        }
      },
      {
        label: 'Use token', keepOpen: true, onClick: async (el) => {
          const token = el.querySelector('#tokenInput').value.trim();
          if (!token) { toast('Token required', 'Paste a Deriv API token with Read + Trade scope.', 'warn'); return; }
          try {
            await api.authorize(token);
            toast('Connected', `Authorised as ${api.auth.loginid}`, 'ok');
            closeModal();
            enterApp();
          } catch (e) {
            toast('Login failed', e.message, 'err');
          }
        }
      }
    ]
  });
  return content;
}

/* ── Chrome ────────────────────────────────────────────────────────────── */
function buildNav() {
  const nav = document.getElementById('mainNav');
  nav.innerHTML = '';
  NAV.forEach((item) => {
    nav.append(h('button', {
      class: 'navtab' + (item.key === state.view ? ' active' : ''),
      dataset: { nav: item.key },
      onclick: () => go(item.key)
    },
      h('span', { html: `<svg><use href="#${item.icon}"/></svg>` }),
      h('span', {}, item.label),
      item.flag ? h('span', { class: 'flag' }) : null));
  });
}

function setTitle(label) { document.getElementById('tbTitle').textContent = label; }

function buildAccountMenu() {
  const menu = document.getElementById('accountMenu');
  const render = () => {
    menu.innerHTML = '';
    const a = api.auth;
    menu.append(h('div', { class: 'am-head' }, 'Accounts'));
    const accounts = STORE.get('accounts', null) || (a ? [{ loginid: a.loginid, currency: a.currency }] : []);
    if (!accounts.length) {
      menu.append(h('div', { class: 'am-row' }, h('span', {}, 'No Deriv account connected')));
    }
    accounts.forEach((acc) => {
      const virtual = /^(VRTC|VRT)/.test(acc.loginid) || acc.is_virtual;
      menu.append(h('div', {
        class: 'am-account am-row' + (state.activeAccount === acc.loginid || (!state.activeAccount && a && a.loginid === acc.loginid) ? ' active' : ''),
        onclick: () => switchAccount(acc)
      },
        h('span', {}, h('b', {}, acc.loginid), h('small', { style: 'display:block' }, virtual ? 'Demo account' : 'Real account')),
        h('span', { class: 'am-badge' }, acc.currency || 'USD')));
    });
    menu.append(h('div', { class: 'am-sep' }));
    menu.append(h('div', { class: 'am-row', onclick: () => toast('Deposit / withdraw', 'Cashier lives on deriv.com — open Deriv in a new tab to move funds.', 'ok') }, h('span', {}, 'Cashier'), h('small', {}, 'deriv.com')));
    menu.append(h('div', { class: 'am-row', onclick: () => openSettings() }, h('span', {}, 'Settings'), h('small', {}, 'App ID · API')));
    menu.append(h('div', { class: 'am-row', onclick: () => { STORE.del('token'); api.logout(); location.reload(); } }, h('span', {}, 'Log out'), h('small', {}, 'End session')));
  };
  render();
  window.__renderAccountMenu = render;
}

function accountLabel() {
  const a = feed.auth;
  if (!a) return;
  document.getElementById('acctLoginId').textContent = a.loginid;
  document.getElementById('acctCurrency').textContent = a.currency;
  document.getElementById('avatarInitial').textContent = (a.loginid || 'D').slice(0, 1);
  document.getElementById('avatarInitial').style.background = /^(VRTC|VRT|SIM)/.test(a.loginid)
    ? 'linear-gradient(140deg,#f2a93b,#e0722c)'
    : 'linear-gradient(140deg,#2f6fd0,#7f4fe0)';
}

function switchAccount(acc) {
  if (!acc.token) { toast('Account switch', 'Re-authorise through Deriv to use this account.', 'warn'); return; }
  api.authorize(acc.token).then(() => {
    state.activeAccount = acc.loginid;
    accountLabel();
    window.__renderAccountMenu();
    watchBalance();
    toast('Account switched', acc.loginid, 'ok');
    go(state.view);
  }).catch((e) => toast('Switch failed', e.message, 'err'));
}

function watchBalance() {
  state.streams.forEach((s) => s && s.unsubscribe && s.unsubscribe().catch(() => {}));
  state.streams = [];
  accountLabel();
  feed.balanceStream((b) => {
    state.balance = b;
    document.getElementById('acctBalance').textContent = fmt.num(b.balance, 2);
    document.getElementById('acctCurrency').textContent = b.currency;
    const kpi = document.querySelector('#kpiBalance');
    if (kpi) kpi.textContent = fmt.num(b.balance, 2);
  }).then((sub) => state.streams.push(sub)).catch(() => {
    document.getElementById('acctBalance').textContent = '—';
  });
}

function openSettings() {
  modal({
    title: 'Settings',
    subtitle: 'Local configuration — nothing is sent anywhere except Deriv itself.',
    body: `
      <div class="field"><label>Deriv App ID</label><input id="setAppId" value="${appId()}"></div>
      <div class="field"><label>Optional market-data proxy</label><input id="setProxy" value="${STORE.get('proxy', '')}" placeholder="http://localhost:8787"></div>
      <div class="note">Register your own app_id at api.deriv.com for production redirect URIs. The proxy is the optional Node backend in <span class="mono">server/server.js</span>.</div>`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true, onClick: (el) => {
          STORE.set('app_id', el.querySelector('#setAppId').value.trim());
          STORE.set('proxy', el.querySelector('#setProxy').value.trim());
          toast('Settings saved', 'Reload to apply the app_id.', 'ok');
        }
      }
    ]
  });
}

function wireChrome() {
  document.getElementById('btnHome').onclick = () => go('dashboard');
  document.getElementById('btnRefresh').onclick = () => {
    toast('Reconnecting', 'Closing and reopening the Deriv socket…');
    api.resetRetries();
    api.disconnect();
    api.connect().then(() => {
      if (STORE.get('token')) restoreSession().then(() => { watchBalance(); go(state.view); });
      toast('Reconnected', 'Live feed restored', 'ok');
    }).catch(() => toast('Reconnect failed', 'Check your connection', 'err'));
  };
  document.getElementById('btnSupport').onclick = () => modal({
    title: 'Support',
    subtitle: 'Stuck on a block? The journal tells you exactly what the bot did.',
    body: `<div class="note">Check the Run panel journal first — every proposal, buy, settlement and rule decision is logged there.
      Deriv account issues (verification, deposits) are handled by Deriv support on deriv.com.</div>`,
    actions: [{ label: 'Close', primary: true }]
  });
  const acc = document.getElementById('accountPill');
  acc.onclick = (e) => { e.stopPropagation(); acc.classList.toggle('open'); };
  document.body.addEventListener('click', () => acc.classList.remove('open'));

  document.getElementById('btnTheme').onclick = () => {
    const dark = document.body.dataset.theme === 'dark';
    document.body.dataset.theme = dark ? 'light' : 'dark';
    toast('Theme', dark ? 'Light mode' : 'Dark mode', 'ok', 1800);
  };
  const langs = ['EN', 'PT', 'ES', 'FR', 'DE'];
  let li = 0;
  document.getElementById('btnLang').onclick = (e) => {
    li = (li + 1) % langs.length;
    e.currentTarget.textContent = langs[li];
    toast('Language', `${langs[li]} selected (interface strings ship in EN)`, 'ok', 1800);
  };
  document.getElementById('btnFull').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen blocked', 'The browser refused the request', 'warn'));
  };
  document.getElementById('fabAI').onclick = () => { go('bot-builder'); setTimeout(() => state.builder && state.builder.openAI(), 260); };
  document.getElementById('fabGemini').onclick = () => modal({
    title: 'Strategy assistant',
    subtitle: 'Pick a proven starting point, then tune it in the builder.',
    body: `<div class="ai-chips">
      ${['Martingale digit Over/Under on Volatility 100', 'Flat-stake Rise/Fall on Volatility 100 (1s)', 'Even/Odd sniper on Boom 500', 'Anti-martingale on Crash 300']
        .map((t, i) => `<button data-t="${i}">${t}</button>`).join('')}</div>
      <div class="note" style="margin-top:12px">Templates load a complete block graph — market, conditions, stake ladder and stop rules.</div>`,
    actions: [{ label: 'Close', primary: true }]
  });

  setInterval(() => { document.getElementById('clock').textContent = gmtStamp(); }, 1000);
  document.getElementById('clock').textContent = gmtStamp();

  api.on('close', () => { setSocketUI('dead', 'Reconnecting…'); feed.useSimulator('socket closed'); });
  api.on('open', () => { setSocketUI('live', 'Live feed connected'); feed.useLive(); });
  api.on('giveup', () => {
    setSocketUI('dead', 'Deriv unreachable — paper mode');
    toast('Deriv unreachable', 'Live feed gave up after several attempts. Use “Retry live feed” above when your network allows it.', 'warn', 7000);
  });
  api.on('reconnecting', (e) => setSocketUI('dead', feed.isPaper
    ? `Reconnecting (attempt ${e.detail.attempt})… · paper mode is active`
    : `Reconnecting (attempt ${e.detail.attempt})…`));
  api.on('error', (e) => setSocketUI('dead', e.detail.message));
  setSocketUI('live', api.connected ? 'Live feed connected' : 'Connecting…');

}

/* Landing CTAs are wired once at boot — they must work before enterApp(). */
function wireLanding() {
  document.querySelectorAll('#landing [data-auth]').forEach((btn) => {
    btn.addEventListener('click', () => openAuth(btn.dataset.auth));
  });
  /* Walk straight into the workspace: every trade runs on paper. */
  document.querySelectorAll('#landing [data-enter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      feed.useSimulator('browsing without an account');
      enterApp();
    });
  });
  const burger = document.querySelector('.lp-burger');
  if (burger) burger.onclick = () => {
    const links = document.querySelector('.lp-links');
    const open = links.style.display === 'flex';
    links.style.display = open ? 'none' : 'flex';
    links.style.position = 'absolute';
    links.style.flexDirection = 'column';
    links.style.background = '#0d1524';
    links.style.padding = '16px';
    links.style.top = '58px';
    links.style.right = '16px';
    links.style.borderRadius = '12px';
  };
}

function setSocketUI(kind, label) {
  const dot = document.getElementById('wsDot');
  if (!dot) return;
  dot.className = 'sb-dot' + (kind === 'live' ? ' live' : kind === 'dead' ? ' dead' : '');
  document.getElementById('wsLabel').textContent = label;
}

/* ══════════════════════════════════════════════════════════════════════════
   ROUTER
   ═════════════════════════════════════════════════════════════════════════ */
const RENDERERS = {
  dashboard: renderDashboard,
  'bot-builder': renderBuilder,
  charts: renderCharts,
  bots: renderSavedBots,
  bulk: renderBulk,
  analysis: renderAnalysis,
  reports: renderReports,
  risk: renderRisk,
  copy: renderCopy,
  dtrader: renderDTrader
};

let teardown = [];
function addStream(fn) { teardown.push(fn); }

export function go(key) {
  const nav = NAV.find((n) => n.key === key) || NAV[0];
  state.view = nav.key;
  document.querySelectorAll('#mainNav .navtab').forEach((b) => b.classList.toggle('active', b.dataset.nav === nav.key));
  setTitle(nav.label);
  teardown.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  teardown = [];
  st().querySelectorAll('.view').forEach((v) => {
    v.hidden = true;
    v.innerHTML = '';
  });
  /* Views are created on demand — no need to pre-declare every route. */
  let target = viewEl(nav.key);
  if (!target) {
    target = h('section', { class: 'view', dataset: { view: nav.key } });
    st().append(target);
  }
  target.hidden = false;
  target.classList.add('view');
  try { (RENDERERS[nav.key] || renderSimple)(target, nav); }
  catch (e) { target.append(h('div', { class: 'empty' }, h('h3', {}, 'View failed to render'), h('p', {}, e.message))); }
  st().scrollTop = 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═════════════════════════════════════════════════════════════════════════ */
function tickerBar() {
  const bar = h('div', { class: 'tickerbar', id: 'tickerBar' });
  state.watch.forEach((sym) => {
    const row = h('div', {},
      h('span', {}, symbolLabel(sym)),
      h('b', { id: `tk-${sym}` }, state.prices[sym] ? fmt.price(state.prices[sym], symbolDigits(sym)) : '—'),
      h('span', { id: `tkc-${sym}` }));
    bar.append(row);
  });
  state.watch.forEach((sym) => {
    feed.tickStream(sym, (t) => {
      state.prices[sym] = t.quote;
      const el = document.getElementById(`tk-${sym}`);
      if (el) { el.textContent = fmt.price(t.quote, symbolDigits(sym)); el.parentElement.classList.remove('tickflash'); void el.offsetWidth; el.parentElement.classList.add('tickflash'); }
      const w = document.getElementById(`w-${sym}`);
      if (w) w.textContent = fmt.price(t.quote, symbolDigits(sym));
    }).then((sub) => addStream(() => sub.unsubscribe())).catch(() => {});
  });
  return bar;
}

function renderDashboard(root) {
  const authed = feed.authorized;
  root.append(tickerBar());

  const kpis = h('div', { class: 'grid g-4', style: 'margin-bottom:16px' },
    h('div', { class: 'kpi' }, h('em', {}, 'Account balance'),
      h('b', { id: 'kpiBalance' }, authed ? fmt.num(state.balance.balance || 0) : fmt.num(state.demo.balance) + ' (demo)'),
      h('small', {}, authed ? `${feed.auth.loginid} · ${feed.auth.currency}${feed.isPaper ? ' · paper' : ''}` : 'Connect Deriv to see your real balance')),
    h('div', { class: 'kpi k2' }, h('em', {}, 'Open positions'), h('b', { id: 'kpiOpen' }, '0'), h('small', {}, 'Live contracts')),
    h('div', { class: 'kpi k3' }, h('em', {}, 'Session profit'), h('b', { id: 'kpiProfit', class: 'up' }, '+0.00'), h('small', {}, 'This browser session')),
    h('div', { class: 'kpi k4' }, h('em', {}, 'Bots available'), h('b', {}, String(Object.keys(JSON.parse(localStorage.getItem('bsf.bots') || '{}')).length || 0)), h('small', {}, 'Saved in the builder')));

  const chartCanvas = h('canvas', { style: 'width:100%;height:290px;display:block' });
  const chartHead = h('div', { class: 'card-head' },
    h('h3', {}, 'Market chart'), h('span', { class: 'chip', id: 'dashSym' }, symbolLabel(state.selected)),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn plain mini', onclick: () => go('charts') }, 'Open full chart'));

  const watchRows = h('div', { class: 'watch-list' },
    state.watch.map((sym) => h('div', { class: 'watch-row', dataset: { sym }, onclick: () => selectSymbol(sym) },
      h('div', { class: 'nm' }, symbolLabel(sym), h('small', {}, sym + ' · ' + (SYMBOLS[sym] ? SYMBOLS[sym].sub : ''))),
      h('div', { class: 'px', id: `w-${sym}` }, state.prices[sym] ? fmt.price(state.prices[sym], symbolDigits(sym)) : '—'),
      h('div', { class: 'ch mono', id: `d-${sym}` }, '—'))));

  const left = h('div', { class: 'card' }, chartHead, h('div', { class: 'card-body' }, chartCanvas));
  const right = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, 'Market watch'), h('span', { class: 'spacer' }),
      h('span', { class: 'chip' + (authed ? ' ok' : ' warn') }, authed ? 'Live' : 'Demo prices')),
    watchRows);

  root.append(kpis, h('div', { class: 'grid g-dash' }, left, right));

  /* activity + quick actions */
  const activity = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h3', {}, 'Recent activity'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn plain mini', onclick: () => go('reports') }, 'All reports')),
    h('div', { class: 'card-body', id: 'activityBody' }));
  root.append(h('div', { class: 'grid g-dash' }, activity,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Quick start')),
      h('div', { class: 'card-body', style: 'display:grid;gap:10px' },
        h('button', { class: 'btn solid', style: 'justify-content:center', onclick: () => go('bot-builder') }, 'Open Bot Builder'),
        h('button', { class: 'btn plain', style: 'justify-content:center', onclick: () => go('dtrader') }, 'Manual trade (DTrader)'),
        h('button', { class: 'btn plain', style: 'justify-content:center', onclick: () => go('risk') }, 'Size a position'),
        h('div', { class: 'note' }, authed
          ? (feed.isPaper
            ? 'Paper mode: the simulated feed prices every contract and orders never reach Deriv. Connect Deriv to trade for real.'
            : 'You are connected. Every trade placed here goes to your Deriv account with your own balance.')
          : 'You are browsing in demo mode. Connect Deriv to trade with real or virtual funds.')))));

  /* live chart on the selected symbol */
  const chart = new CandleChart(chartCanvas, { symbol: state.selected, digits: symbolDigits(state.selected), granularity: 60 });
  loadCandles(chart);
  addStream(() => chart.destroy());
  window.__dashChart = chart;

  /* live ticks keep the chart and table fresh */
  const tickSubs = [];
  state.watch.forEach((sym) => {
    feed.tickStream(sym, (t) => {
      const d = document.getElementById(`d-${sym}`);
      if (d) {
        d.textContent = lastDigit(t.quote, symbolDigits(sym));
        d.className = 'ch ' + (lastDigit(t.quote, symbolDigits(sym)) >= 5 ? 'up' : 'down');
      }
      if (sym === state.selected) chart.pushTick(t);
    }).then((s) => tickSubs.push(s)).catch(() => {});
  });
  addStream(() => tickSubs.forEach((s) => s.unsubscribe().catch(() => {})));

  if (authed) {
    feed.portfolio().then((p) => {
      const el = document.getElementById('kpiOpen');
      if (el) el.textContent = String((p.contracts || []).length);
    }).catch(() => {});
    feed.profitTable(10).then((t) => {
      const body = document.getElementById('activityBody');
      if (!body || !t || !t.transactions || !t.transactions.length) {
        if (body) body.innerHTML = '<div class="empty"><h3>No trades yet</h3><p>Your settled contracts will appear here, pulled straight from Deriv.</p></div>';
        return;
      }
      body.innerHTML = '';
      const table = h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Contract'), h('th', {}, 'Type'), h('th', { class: 'num' }, 'Buy'), h('th', { class: 'num' }, 'Payout'), h('th', { class: 'num' }, 'Profit'), h('th', {}, 'Purchased'))));
      const tb = h('tbody', {});
      t.transactions.slice(0, 10).forEach((tx) => {
        tb.append(h('tr', {},
          h('td', { class: 'mono' }, String(tx.contract_id)),
          h('td', {}, tx.longcode ? tx.longcode.split(' ').slice(0, 4).join(' ') : tx.shortcode),
          h('td', { class: 'num' }, fmt.num(tx.buy_price)),
          h('td', { class: 'num' }, fmt.num(tx.payout)),
          h('td', { class: 'num ' + (tx.profit >= 0 ? 'up' : 'down') }, fmt.signed(tx.profit)),
          h('td', {}, fmt.time(new Date(tx.purchase_time * 1000)))));
      });
      table.append(tb);
      body.append(table);
    }).catch(() => {});
  } else {
    document.getElementById('activityBody').innerHTML =
      '<div class="empty"><svg><use href="#i-lock"/></svg><h3>Connect Deriv to see activity</h3><p>Sign in and this panel shows your real settled contracts, portfolio and profit table.</p><button class="btn primary mini" id="dashConnect">Connect Deriv</button></div>';
    const c = document.getElementById('dashConnect');
    if (c) c.onclick = () => openAuth('login');
  }

  const engineProfit = document.getElementById('kpiProfit');
  addStream(state.engine.on('stats', (s) => {
    if (engineProfit) { engineProfit.textContent = fmt.signed(s.profit); engineProfit.className = s.profit >= 0 ? 'up' : 'down'; }
  }));

  window.__selectSymbol = selectSymbol;
}

function selectSymbol(sym) {
  state.selected = sym;
  STORE.set('selected', sym);
  document.querySelectorAll('.watch-row').forEach((r) => r.classList.toggle('sel', r.dataset.sym === sym));
  const label = document.getElementById('dashSym');
  if (label) label.textContent = symbolLabel(sym);
  if (window.__dashChart) window.__dashChart.setSymbol(sym, symbolDigits(sym));
  if (document.getElementById('chartSymbol')) {
    document.getElementById('chartSymbol').value = sym;
    go('charts');
  }
}

async function loadCandles(chart, count = 260) {
  try {
    const candles = await feed.candles(chart.symbol, chart.granularity, count);
    chart.setData(candles);
  } catch (e) {
    chart.setData([]);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   BOT BUILDER
   ═════════════════════════════════════════════════════════════════════════ */
function renderBuilder(root) {
  const saved = STORE.get('bot', null);
  const bot = saved || defaultBot();
  const builder = new Builder(root, {
    bot,
    engine: state.engine,
    currency: feed.currency,
    go,
    persist: (b) => STORE.set('bot', b),
    requireAuth: () => openAuth('login'),
    onRunning: (running) => {
      const dot = document.getElementById('wsDot');
      if (dot) { /* keep socket dot authoritative */ }
      if (running) toast('Bot started', 'Journal is open — watch the decisions live.', 'ok');
    }
  });
  state.builder = builder;
  builder.attachMarketStream();
  addStream(() => builder.destroy());
}

/* ══════════════════════════════════════════════════════════════════════════
   CHARTS
   ═════════════════════════════════════════════════════════════════════════ */
const GRANS = [[60, '1m'], [120, '2m'], [300, '5m'], [900, '15m'], [3600, '1h'], [86400, '1d']];

function renderCharts(root) {
  const head = h('div', { class: 'view-head' },
    h('h2', {}, 'Charts'),
    h('p', {}, 'Live candles straight from Deriv with a digit distribution panel.'),
    h('span', { class: 'spacer' }),
    selectEl(Object.keys(SYMBOLS).map((k) => [k, symbolLabel(k)]), state.selected, 'chartSymbol', (v) => { state.selected = v; redraw(); }),
    selectEl(GRANS, '60', 'chartGran', (v) => { gran = +v; redraw(); }));

  const canvas = h('canvas', { style: 'width:100%;height:460px;display:block' });
  const ohlc = h('div', { class: 'mono', style: 'color:#7b879c;font-size:12px' }, 'Hover the chart for a candle readout');
  const digitsPanel = h('div', { class: 'card-body', id: 'digitPanel' });

  root.append(head,
    h('div', { class: 'grid', style: 'grid-template-columns:minmax(0,1fr) 300px' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Candles'), h('span', { class: 'spacer' }), ohlc),
        h('div', { class: 'card-body' }, canvas)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Last-digit distribution')), digitsPanel)));

  let gran = 60;
  const chart = new CandleChart(canvas, {
    symbol: state.selected, digits: symbolDigits(state.selected), granularity: gran,
    onHover: (c) => {
      ohlc.textContent = c ? `${fmt.time(c.time * 1000)}  O ${c.open.toFixed(symbolDigits(chart.symbol))}  H ${c.high.toFixed(symbolDigits(chart.symbol))}  L ${c.low.toFixed(symbolDigits(chart.symbol))}  C ${c.close.toFixed(symbolDigits(chart.symbol))}` : '';
    }
  });
  const redraw = () => {
    chart.setSymbol(state.selected, symbolDigits(state.selected));
    chart.setGranularity(gran);
    loadCandles(chart);
    renderDigits();
  };
  addStream(() => chart.destroy());

  const hist = [];
  feed.tickStream(state.selected, (t) => {
    chart.pushTick(t);
    hist.push(lastDigit(t.quote, symbolDigits(state.selected)));
    if (hist.length > 300) hist.shift();
    renderDigitPanel(hist);
  }).then((s) => addStream(() => s.unsubscribe().catch(() => {}))).catch(() => {});

  function renderDigitPanel() {
    const counts = new Array(10).fill(0);
    hist.forEach((d) => counts[d]++);
    const total = hist.length || 1;
    const panel = document.getElementById('digitPanel');
    if (!panel) return;
    panel.innerHTML = '';
    counts.forEach((c, i) => {
      const pct = (c / total) * 100;
      panel.append(h('div', { style: 'display:grid;grid-template-columns:18px 1fr 54px;gap:9px;align-items:center;margin-bottom:7px;font-size:12.5px' },
        h('b', { style: `color:${i >= 5 ? '#12558f' : '#b3121a'}` }, String(i)),
        h('div', { style: 'height:9px;border-radius:99px;background:#eef1f6;overflow:hidden' },
          h('i', { style: `display:block;height:100%;width:${pct}%;background:${i >= 5 ? '#4b8fd6' : '#e0787c'}` })),
        h('span', { class: 'mono' }, pct.toFixed(1) + '%')));
    });
    panel.append(h('div', { class: 'note', style: 'margin-top:10px' }, `Sampled ${hist.length} ticks on ${symbolLabel(state.selected)} since this view opened.`));
  }
  const renderDigits = () => {
    feed.ticksHistory(state.selected, 200).then((list) => {
      hist.length = 0;
      list.forEach((t) => hist.push(lastDigit(t.quote, symbolDigits(state.selected))));
      renderDigitPanel();
    }).catch(() => {});
  };
  renderDigits();
  loadCandles(chart);
}

function selectEl(options, value, id, onChange) {
  const el = h('select', { class: 'sel-box', id, onchange: (e) => onChange(e.target.value) });
  options.forEach(([v, label]) => el.append(h('option', { value: v, selected: String(v) === String(value) }, label)));
  return el;
}

/* ══════════════════════════════════════════════════════════════════════════
   DTRADER — manual trade ticket
   ═════════════════════════════════════════════════════════════════════════ */
function renderDTrader(root) {
  let symbol = state.selected;
  let family = 'digits';
  let side = 'over';
  let barrier = 5;
  let stake = 2.5;
  let ticks = 1;

  const ticket = h('div', { class: 'ticket' });
  const monitor = h('div', { class: 'card-body', id: 'ocMonitor' }, h('div', { class: 'empty' }, h('h3', {}, 'No open contract'), h('p', {}, 'Buy a contract to monitor it here in real time.')));

  const build = () => {
    ticket.innerHTML = '';
    ticket.append(
      h('div', { class: 'field' }, h('label', {}, 'Market'),
        selectEl(Object.keys(SYMBOLS).map((k) => [k, `${symbolLabel(k)} · ${SYMBOLS[k].sub}`]), symbol, 'dtSymbol', (v) => { symbol = v; refreshTicks(); })),
      h('div', { class: 'field' }, h('label', {}, 'Trade type'),
        h('div', { class: 'seg' },
          ['digits', 'risefall'].map((f) => h('button', { class: f === family ? 'on' : '', onclick: () => { family = f; build(); } }, f === 'digits' ? 'Digits' : 'Rise / Fall')))),
      family === 'digits'
        ? h('div', { class: 'field' }, h('label', {}, 'Contract'),
            h('div', { class: 'seg' },
              [['over', 'Over'], ['under', 'Under'], ['even', 'Even'], ['odd', 'Odd']].map(([v, l]) =>
                h('button', { class: v === side ? 'on' : '', onclick: () => { side = v; build(); } }, l))))
        : h('div', { class: 'field' }, h('label', {}, 'Contract'),
            h('div', { class: 'seg' },
              [['rise', 'Rise'], ['fall', 'Fall']].map(([v, l]) =>
                h('button', { class: v === side ? 'on' : '', onclick: () => { side = v; build(); } }, l)))),
      (family === 'digits' && (side === 'over' || side === 'under'))
        ? h('div', { class: 'field' }, h('label', {}, `Barrier — last digit ${side === 'over' ? '>' : '<'} ${barrier}`),
            h('div', { class: 'digit-row' }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) =>
              h('div', {
                class: 'digit ' + (d === barrier ? 'on ' : '') + (d >= (side === 'over' ? barrier : 0) ? (side === 'over' ? 'over' : 'under') : ''),
                onclick: () => { barrier = d; build(); }
              }, String(d)))))
        : null,
      h('div', { class: 'field' }, h('label', {}, 'Stake (USD)'), h('input', { type: 'number', value: stake, step: '0.5', min: '0.35', oninput: (e) => { stake = +e.target.value; updateQuote(); } })),
      h('div', { class: 'field' }, h('label', {}, 'Duration (ticks)'), h('input', { type: 'number', value: ticks, min: '1', max: '10', oninput: (e) => { ticks = +e.target.value; updateQuote(); } })),
      h('div', { class: 'note', id: 'dtQuote' }, 'Fetching proposal…'),
      h('button', { class: 'btn primary lg', id: 'dtBuy', style: 'justify-content:center' }, 'Buy'),
      h('div', { class: 'blink-hint mono', id: 'dtDigit', style: 'text-align:center;color:#7b879c;font-size:12px' }, '—')
    );
    wire();
  };

  const contractTypeFor = () => {
    if (family === 'risefall') return side === 'rise' ? 'CALL' : 'PUT';
    return { over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD' }[side];
  };

  let proposal = null;
  let quoteBusy = false;
  const updateQuote = async () => {
    if (!feed.authorized || quoteBusy) return;
    quoteBusy = true;
    const ctype = contractTypeFor();
    const params = {
      amount: Number(stake).toFixed(2), basis: 'stake',
      contract_type: ctype, currency: feed.currency,
      duration: ticks, duration_unit: 't', symbol
    };
    if (['DIGITOVER', 'DIGITUNDER'].includes(ctype)) params.barrier = String(barrier);
    try {
      proposal = await feed.proposal(params);
      const el = document.getElementById('dtQuote');
      if (el) el.innerHTML = `Payout <b>${fmt.num(proposal.payout)} ${feed.currency}</b> · ask ${fmt.num(proposal.ask_price)} · spot ${fmt.price(proposal.spot, symbolDigits(symbol))}` +
        ` · win chance ${proposal.payout ? fmt.num((Number(stake) / proposal.payout) * 100, 1) : '—'}%`;
    } catch (e) {
      const el = document.getElementById('dtQuote');
      if (el) el.textContent = 'Proposal unavailable: ' + e.message;
    } finally { quoteBusy = false; }
  };

  const refreshTicks = () => {
    if (curSub) curSub.unsubscribe().catch(() => {});
    feed.tickStream(symbol, (t) => {
      const el = document.getElementById('dtDigit');
      if (el) el.textContent = `${fmt.price(t.quote, symbolDigits(symbol))} · last digit ${lastDigit(t.quote, symbolDigits(symbol))}`;
    }).then((s) => { curSub = s; }).catch(() => {});
  };
  let curSub = null;

  const wire = () => {
    const buy = document.getElementById('dtBuy');
    if (!buy) return;
    buy.onclick = async () => {
      if (!feed.authorized) { toast('Log in first', 'Connect your Deriv account to trade.', 'warn'); return openAuth('login'); }
      buy.disabled = true;
      buy.innerHTML = '<span class="spin"></span> Placing…';
      try {
        if (!proposal) await updateQuote();
        if (!proposal) throw new Error('No proposal');
        const res = await feed.buy(proposal.id, proposal.ask_price);
        toast('Contract bought', `#${res.buy.contract_id} · ${fmt.num(res.buy.buy_price)} ${feed.currency}${feed.isPaper ? ' (paper)' : ''}`, 'ok');
        monitorContract(res.buy.contract_id);
      } catch (e) {
        toast('Buy failed', e.message, 'err');
      } finally {
        buy.disabled = false;
        buy.textContent = 'Buy';
      }
    };
  };

  function monitorContract(id) {
    const box = document.getElementById('ocMonitor');
    box.innerHTML = '';
    box.append(h('div', { class: 'stat-grid' },
      h('div', {}, h('em', {}, 'Contract'), h('b', { class: 'mono' }, String(id))),
      h('div', {}, h('em', {}, 'Status'), h('b', { id: 'ocStatus' }, 'open')),
      h('div', {}, h('em', {}, 'Profit'), h('b', { id: 'ocProfit' }, '0.00'))));
    const detail = h('div', { class: 'note', id: 'ocDetail' }, 'Waiting for the contract stream…');
    box.append(detail, h('button', { class: 'btn danger', style: 'margin-top:10px;width:100%;justify-content:center', id: 'ocSell' }, 'Sell now'));
    /* The simulator can deliver its first (and even final) update
       synchronously inside openContract(), so the handle is assigned by
       reference and every call site is null-safe. */
    let unsub = () => {};
    let closed = false;
    feed.openContract(id, (msg) => {
      const oc = msg.proposal_open_contract;
      if (!oc) return;
      const statusEl = document.getElementById('ocStatus');
      const pf = document.getElementById('ocProfit');
      const d = document.getElementById('ocDetail');
      if (statusEl) statusEl.textContent = oc.is_sold ? 'sold' : 'open';
      if (pf) { pf.textContent = fmt.signed(+oc.profit) + ' ' + oc.currency; pf.className = +oc.profit >= 0 ? 'up' : 'down'; }
      if (d) {
        d.innerHTML = `Entry ${oc.entry_tick_display_value || '—'} · current ${oc.current_spot_display_value || '—'} · payout ${fmt.num(oc.payout)}<br>
          ${oc.is_sold ? (oc.profit >= 0 ? '<b class="up">Won</b>' : '<b class="down">Lost</b>') + ` · ${fmt.num(oc.exit_tick_display_value)}` : 'running…'}
          <br><span class="mono">${oc.longcode || ''}</span>`;
      }
      if (oc.is_sold && !closed) {
        closed = true;
        try { unsub(); } catch (e) { /* nothing left to forget */ }
        toast('Contract settled', fmt.signed(+oc.profit) + ' ' + oc.currency, +oc.profit >= 0 ? 'ok' : 'warn');
      }
    }).then((handle) => { unsub = () => handle && handle.unsubscribe && handle.unsubscribe(); })
      .catch((e) => toast('Monitor failed', e.message, 'err'));
    box.querySelector('#ocSell').onclick = async () => {
      try { await feed.sellContract(id, 0); toast('Sell requested', 'Contract will close at the market price', 'ok'); }
      catch (e) { toast('Sell failed', e.message, 'err'); }
    };
    addStream(() => { if (!closed) { closed = true; unsub(); } });
  }

  addStream(() => { if (curSub) curSub.unsubscribe().catch(() => {}); });

  root.append(h('div', { class: 'view-head' },
    h('h2', {}, 'DTrader'),
    h('p', {}, 'Manual trade ticket — proposals and execution use the same Deriv API the bots use.'),
    h('span', { class: 'spacer' }),
    feed.authorized
      ? h('span', { class: 'chip ' + (feed.isPaper ? 'warn' : 'ok') }, feed.isPaper ? 'Paper trading (simulated feed)' : `Trading as ${feed.auth.loginid} (${feed.auth.currency})`)
      : h('button', { class: 'btn primary mini', onclick: () => openAuth('login') }, 'Connect Deriv')),
    h('div', { class: 'grid g-dash', style: 'width:100%' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Trade ticket')), h('div', { class: 'card-body' }, ticket)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Open contract')), monitor)));

  /* Wire only after the ticket is in the document — getElementById needs it. */
  build();
  refreshTicks();
  updateQuote();
}

/* ══════════════════════════════════════════════════════════════════════════
   SAVED BOTS / BULK / ANALYSIS / REPORTS / RISK / COPY
   ═════════════════════════════════════════════════════════════════════════ */
function renderSavedBots(root) {
  const bots = Object.entries(JSON.parse(localStorage.getItem('bsf.bots') || '{}'));
  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Trading Bots'), h('p', {}, 'Bots saved from the builder, ready to open or duplicate.'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary mini', onclick: () => go('bot-builder') }, 'New bot')));

  const grid = h('div', { class: 'grid g-3' });
  const templates = [
    { bot: defaultBot('Martingale V2'), tag: 'Digits · Over/Under' },
    { bot: defaultKnockoutBot(), tag: 'Rise/Fall · MA cross' }
  ];
  templates.concat(bots.map(([name, bot]) => ({ bot, tag: 'Saved locally' }))).forEach(({ bot, tag }) => {
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, bot.name || 'Untitled'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, tag)),
      h('div', { class: 'card-body' },
        h('div', { style: 'font-size:12.5px;color:#54617d;display:grid;gap:5px' },
          h('div', {}, 'Market: ', h('b', {}, symbolLabel(bot.params.symbol))),
          h('div', {}, 'Stake ladder: ', h('b', {}, `×${bot.setups.find((s) => s.name === 'Martingale_size')?.value ?? '—'}`)),
          h('div', {}, 'Conditions: ', h('b', {}, `${bot.purchase.length} purchase · ${bot.restart.length} restart`))),
        h('div', { style: 'display:flex;gap:8px;margin-top:13px' },
          h('button', { class: 'btn solid mini', onclick: () => { STORE.set('bot', bot); go('bot-builder'); } }, 'Open'),
          h('button', { class: 'btn plain mini', onclick: () => openAuth('login') }, 'Deploy')))));
  });
  if (!bots.length) {
    grid.append(h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'empty' }, h('h3', {}, 'No saved bots yet'), h('p', {}, 'Build one in Bot Builder and hit the save icon — it will show up here.')))));
  }
  root.append(grid);
}

function renderBulk(root) {
  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Bulk Trader'), h('p', {}, 'Fan one strategy across several indices at once.')));
  const rows = h('div', { class: 'card-body' });
  state.watch.slice(0, 5).forEach((sym) => {
    rows.append(h('div', { class: 'watch-row', style: 'grid-template-columns:1fr 120px 120px 90px' },
      h('div', { class: 'nm' }, symbolLabel(sym), h('small', {}, sym)),
      h('div', {}, h('input', { class: 'num-box', value: '2.5', style: 'width:100px' })),
      h('div', {}, h('span', { class: 'chip' }, 'Digits · Over 5')),
      h('div', { style: 'text-align:right' }, h('button', { class: 'btn plain mini', onclick: () => toast('Bulk trade', 'Enable the copy-trade bridge to fan orders across accounts.', 'warn') }, 'Queue'))));
  });
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Queue'), h('span', { class: 'spacer' }), h('span', { class: 'chip warn' }, 'Preview')), rows));
}

function renderAnalysis(root) {
  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Analysis Tool'), h('p', {}, 'Digit frequency, streaks and mean reversion read straight off the live tick stream.')));
  const tableBody = h('tbody', {});
  const streaks = h('div', { class: 'card-body' });
  root.append(h('div', { class: 'grid g-dash' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Digit frequency — last 500 ticks')), h('div', { class: 'card-body' },
      h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Digit'), h('th', { class: 'num' }, 'Count'), h('th', { class: 'num' }, 'Share'), h('th', {}, 'Bias'))), tableBody))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Market structure')), streaks)));

  const counts = new Array(10).fill(0);
  let total = 0, lastDir = null, streak = 0, maxStreak = 0;
  const render = () => {
    tableBody.innerHTML = '';
    counts.forEach((c, i) => {
      const share = total ? (c / total) * 100 : 0;
      const bias = share > 10.6 ? 'Over-represented' : share < 9.4 ? 'Under-represented' : 'Balanced';
      tableBody.append(h('tr', {},
        h('td', {}, h('b', {}, String(i))),
        h('td', { class: 'num' }, String(c)),
        h('td', { class: 'num' }, share.toFixed(1) + '%'),
        h('td', {}, h('span', { class: 'chip ' + (bias === 'Balanced' ? '' : bias === 'Over-represented' ? 'ok' : 'bad') }, bias))));
    });
    streaks.innerHTML = '';
    [['Sampled ticks', String(total)], ['Longest rise run', String(maxRun.rise)], ['Longest fall run', String(maxRun.fall)],
      ['Last digit', total ? String(lastDigitVal) : '—'], ['Streak direction', lastDir == null ? '—' : lastDir ? 'Rising' : 'Falling']]
      .forEach(([k, v]) => streaks.append(h('div', { class: 'watch-row', style: 'grid-template-columns:1fr auto' }, h('div', { class: 'nm' }, k), h('div', { class: 'px' }, v))));
  };
  const maxRun = { rise: 0, fall: 0 };
  let run = 0, runDir = null, lastDigitVal = 0;

  feed.ticksHistory(state.selected, 500).then((list) => {
    list.forEach((t) => {
      const d = lastDigit(t.quote, symbolDigits(state.selected));
      counts[d]++; total++; lastDigitVal = d;
      const dir = d >= 5;
      if (dir === runDir) run++; else { runDir = dir; run = 1; }
      if (dir) maxRun.rise = Math.max(maxRun.rise, run); else maxRun.fall = Math.max(maxRun.fall, run);
      lastDir = dir;
    });
    render();
  }).catch((e) => toast('History unavailable', e.message, 'err'));

  feed.tickStream(state.selected, (t) => {
    const d = lastDigit(t.quote, symbolDigits(state.selected));
    counts[d]++; total++; lastDigitVal = d;
    const dir = d >= 5;
    if (dir === runDir) run++; else { runDir = dir; run = 1; }
    if (dir) maxRun.rise = Math.max(maxRun.rise, run); else maxRun.fall = Math.max(maxRun.fall, run);
    lastDir = dir;
    if (total % 10 === 0) render();
  }).then((s) => addStream(() => s.unsubscribe().catch(() => {}))).catch(() => {});
  render();
}

function renderReports(root) {
  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Reports'), h('p', {}, 'Profit table and statement pulled live from Deriv.'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn plain mini', onclick: () => exportTable('profit') }, h('svg', { html: '<use href="#i-download"/>' }), 'Export CSV')));
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Profit table')), h('div', { class: 'card-body', id: 'reportBody' }));
  root.append(card);
  const body = card.querySelector('#reportBody');
  if (!feed.authorized) {
    body.append(h('div', { class: 'empty' }, h('svg', { html: '<use href="#i-lock"/>' }), h('h3', {}, 'Sign in to load reports'),
      h('p', {}, 'Deriv only releases statements to an authorised session — connect your account first.'),
      h('button', { class: 'btn primary mini', onclick: () => openAuth('login') }, 'Connect Deriv')));
    return;
  }
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spin dark' }), h('p', {}, 'Loading your profit table…')));
  feed.profitTable(100).then((t) => {
    body.innerHTML = '';
    const rows = (t && t.transactions) || [];
    if (!rows.length) { body.append(h('div', { class: 'empty' }, h('h3', {}, 'No settled contracts yet'), h('p', {}, 'Trade once and this table fills up.'))); return; }
    window.__reportRows = rows;
    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Purchased'), h('th', {}, 'Contract'), h('th', {}, 'Description'), h('th', { class: 'num' }, 'Buy'), h('th', { class: 'num' }, 'Payout'), h('th', { class: 'num' }, 'Profit'))));
    const tb = h('tbody', {});
    rows.forEach((r) => tb.append(h('tr', {},
      h('td', {}, fmt.stamp(new Date(r.purchase_time * 1000))),
      h('td', { class: 'mono' }, String(r.contract_id)),
      h('td', {}, r.longcode || r.shortcode || '—'),
      h('td', { class: 'num' }, fmt.num(r.buy_price)),
      h('td', { class: 'num' }, fmt.num(r.payout)),
      h('td', { class: 'num ' + (r.profit >= 0 ? 'up' : 'down') }, fmt.signed(r.profit)))));
    table.append(tb);
    body.append(table);
  }).catch((e) => {
    body.innerHTML = '';
    body.append(h('div', { class: 'empty' }, h('h3', {}, 'Could not load reports'), h('p', {}, e.message)));
  });
}

function exportTable() {
  const rows = window.__reportRows;
  if (!rows || !rows.length) { toast('Nothing to export', 'Load the profit table first.', 'warn'); return; }
  const csv = 'contract_id,purchased,buy_price,payout,profit,currency\n' +
    rows.map((r) => [r.contract_id, new Date(r.purchase_time * 1000).toISOString(), r.buy_price, r.payout, r.profit, r.currency].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'bsf-profit-table.csv';
  a.click();
  toast('Exported', `${rows.length} rows`, 'ok');
}

const RISK_VARS = { stake: 2.5, balance: 1000, stopLoss: 100, martingale: 1.5, winRate: 55 };

function renderRisk(root) {
  const out = h('div', { class: 'card-body', id: 'riskOut' });
  const fields = h('div', { class: 'card-body', style: 'display:grid;gap:12px' });
  const inputs = [
    ['stake', 'Base stake (USD)', 0.35, 10000, 0.5],
    ['balance', 'Account balance (USD)', 10, 1000000, 10],
    ['stopLoss', 'Stop loss (USD)', 1, 1000000, 10],
    ['martingale', 'Martingale multiplier', 1, 5, 0.1],
    ['winRate', 'Assumed win rate (%)', 1, 99, 1]
  ];
  const vals = Object.assign({}, RISK_VARS);
  if (api.authorized && state.balance.balance) vals.balance = +state.balance.balance;
  inputs.forEach(([key, label, min, max, step]) => {
    fields.append(h('div', { class: 'field' }, h('label', {}, label),
      h('input', {
        type: 'number', value: vals[key], min, max, step, id: 'risk-' + key,
        oninput: (e) => { vals[key] = +e.target.value; compute(); }
      })));
  });

  function compute() {
    const { stake, balance, stopLoss, martingale, winRate } = vals;
    let s = stake, risk = 0, n = 0, ladder = [];
    while (risk + s <= stopLoss && n < 60) {
      risk += s; n++;
      ladder.push({ n, stake: s, cumulative: risk });
      s = +(s * martingale).toFixed(2);
    }
    const depth = n;
    const shares = ladder.map((l) => l.cumulative / risk * 100);
    const ruin = 1 - Math.pow(winRate / 100, depth);
    const growth = Math.pow(1 + (winRate / 100) * (1 / martingale) - (1 - winRate / 100), 1);
    const rows = ladder.slice(0, 12);
    out.innerHTML = '';
    out.append(h('div', { class: 'stat-grid' },
      h('div', {}, h('em', {}, 'Steps before stop loss'), h('b', {}, String(depth))),
      h('div', {}, h('em', {}, 'Capital committed'), h('b', {}, fmt.num(risk))),
      h('div', {}, h('em', {}, '% of balance at risk'), h('b', {}, fmt.num((risk / balance) * 100, 1) + '%'))));
    const t = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Step'), h('th', { class: 'num' }, 'Stake'), h('th', { class: 'num' }, 'Cumulative exposure'), h('th', { class: 'num' }, '% of stop loss')))),
      tb = h('tbody', {});
    rows.forEach((l, i) => tb.append(h('tr', {},
      h('td', {}, String(l.n)),
      h('td', { class: 'num' }, fmt.num(l.stake)),
      h('td', { class: 'num' }, fmt.num(l.cumulative)),
      h('td', { class: 'num' }, fmt.num(shares[i], 1) + '%'))));
    t.append(tb);
    out.append(t);
    out.append(h('div', { class: 'note', style: 'margin-top:12px' },
      `With a ${winRate}% win rate, the chance of hitting the full ${depth}-step losing ladder is about ${fmt.num(ruin * 100, 2)}%. ` +
      `Expected value per contract at these odds is roughly ${fmt.signed(stake * ((winRate / 100) * (1 / martingale) - (1 - winRate / 100)))} USD. ` +
      'Martingale increases variance — cap the ladder with the sell conditions in the builder.'));
  }

  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Risk Calculator'), h('p', {}, 'Size the stake ladder before the bot does it for you.')),
    h('div', { class: 'grid g-dash' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Inputs')), fields),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Ladder')), out)));
  compute();
}

function renderCopy(root) {
  root.append(h('div', { class: 'view-head' }, h('h2', {}, 'Copy Trading'), h('p', {}, 'Mirror a live run to another Deriv account.')));
  const bots = Object.entries(JSON.parse(localStorage.getItem('bsf.bots') || '{}'));
  const grid = h('div', { class: 'grid g-3' });
  (bots.length ? bots : [['Martingale V2', defaultBot()]]).forEach(([name, bot]) => {
    grid.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, name), h('span', { class: 'spacer' }), h('span', { class: 'chip warn' }, 'Bridge required')),
      h('div', { class: 'card-body' }, h('div', { class: 'note' }, 'Mirroring trades between accounts needs the optional backend bridge. The block is on the canvas and the engine emits every settlement, so wiring it up is a small job.'),
        h('button', { class: 'btn plain mini', style: 'margin-top:12px', onclick: () => go('bot-builder') }, 'Open in builder'))));
  });
  root.append(grid);
}

function renderSimple(root, nav) {
  const copy = {
    bulk: ['Bulk Trader', 'Fan one strategy across several indices at once.'],
    bots: ['Trading Bots', 'Your saved automations.'],
    analysis: ['Analysis Tool', 'Digit and structure analytics.'],
    copy: ['Copy Trading', 'Mirror runs between accounts.']
  }[nav.key] || [nav.label, 'This workspace is being built.'];
  root.append(h('div', { class: 'view-head' }, h('h2', {}, copy[0]), h('p', {}, copy[1])),
    h('div', { class: 'card' }, h('div', { class: 'card-body' },
      h('div', { class: 'empty' }, h('svg', { html: '<use href="#i-grid"/>' }),
        h('h3', {}, 'Coming in the next drop'),
        h('p', {}, 'The Dashboard, Bot Builder, Charts, DTrader, Reports and Risk Calculator are fully wired to Deriv. This view is queued.'),
        h('span', { class: 'soon' }, 'Queued')))));
}

/* ── Go ───────────────────────────────────────────────────────────────── */
boot();
/* Exposed for debugging and for the desktop shell to drive the app. */
window.bsf = { state, api, go, openAuth, CONFIG, enter: enterApp, showLanding };
