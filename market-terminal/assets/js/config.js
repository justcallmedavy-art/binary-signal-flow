/* ============================================================================
   Runtime configuration + tiny storage helpers.
   Everything Deriv-specific lives here so a fork only edits one file.
   ========================================================================== */
export const CONFIG = {
  /* Deriv app_id. 1089 is Deriv's public test id; register your own at
     https://api.deriv.com and put it in local storage under `bsf.app_id`
     (Settings → API) for production use. */
  appId: 1089,
  wsUrl: 'wss://ws.derivws.com/websockets/v3',
  oauthUrl: 'https://oauth.deriv.com/oauth2/authorize',
  /* Optional keyed market-data proxy from server/server.js (may be empty). */
  proxyBase: '',
  version: '1.0.0'
};

export const STORE = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem('bsf.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('bsf.' + key, JSON.stringify(value)); } catch (e) { /* quota */ }
    return value;
  },
  del(key) { try { localStorage.removeItem('bsf.' + key); } catch (e) { /* ignore */ } }
};

export function appId() {
  const custom = STORE.get('app_id', null);
  return custom ? Number(custom) : CONFIG.appId;
}

/* ── Formatting helpers shared by every view ───────────────────────────── */
export const fmt = {
  money(v, currency = 'USD', digits = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) +
      (currency ? ' ' + currency : '');
  },
  num(v, digits = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  signed(v, digits = 2) { return (v > 0 ? '+' : '') + fmt.num(v, digits); },
  price(v, digits = 3) { return v == null ? '—' : Number(v).toFixed(digits); },
  time(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false });
  },
  stamp(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
};

/* Sync clock label used by the status bar (GMT, like the reference build). */
export function gmtStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' GMT';
}
