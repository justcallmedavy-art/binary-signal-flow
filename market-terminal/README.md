# Binary Signal Flow — front end

An animated landing page that leads into a full trading workspace: dashboard, **Bot
Builder**, charts, DTrader, reports and a risk calculator — all wired to **Deriv's
public API** (WebSocket v3 + OAuth 2.0). No build step, no npm dependencies: plain
ES modules served by the Node backend that already lives in `server/`.

> Independent, unofficial front end for the Deriv API. Not affiliated with, endorsed
> by, or connected to Deriv, Binary.com or the site referenced for the layout. All
> code, copy, styling and artwork here are original; no third-party assets were
> copied.

## Run it

```bash
node server/server.js          # http://localhost:8787
PORT=8787 node server/server.js
```

The server is dependency-free (Node 18+) and only does two things: serve this
directory over http:// and, optionally, proxy keyed market-data providers so no API
secret reaches the browser (see `server/.env.example`).

## How a visitor moves through it

1. **Preloader** — animated candle bars while the app opens the Deriv socket and
   restores any stored session.
2. **Landing** — particle/candle hero canvas, gradient orbs, scroll reveals, animated
   counters, live market marquee, feature grid, FAQ.
3. **Sign up / log in** — `Sign up with Deriv` and `Log in` both open Deriv's own
   OAuth screen (`oauth.deriv.com`). The modal also accepts a pasted API token
   (Read + Trade scope) for fast local testing.
4. **Workspace** — dashboard first, and the **Bot Builder** reproduces the reference
   layout: AI Bot Generator, Blocks menu, icon rail, block canvas
   (1. Trade parameters → 6. Run once at start) and the Run panel with
   Summary / Transactions / Journal.
5. **Start trading** — press **Run** and the engine subscribes to the symbol, evaluates
   the purchase rules, proposes, buys and tracks each contract to settlement, applying
   the restart (martingale) rules. DTrader is the manual equivalent.

## Live vs paper mode

| Mode | When | What happens |
| --- | --- | --- |
| **Live** | Deriv's WebSocket is reachable and you are authorised | Real prices and real orders on your Deriv account (real or virtual balance) |
| **Paper** | Deriv is unreachable/blocked, or you press *Skip login* | `feed.js` runs a local simulator: synthetic ticks per index, payouts priced from each contract's true win probability, outcome decided by the next tick, paper balance persisted in `localStorage` |

The strip under the red welcome banner always states which mode you are in, and the
status bar shows the socket state. `Retry live feed` re-attempts the connection;
after eight failed attempts the client stops retrying on its own.

## Configuration

Everything Deriv-specific sits in `assets/js/config.js`, or in **Settings** (account
menu → Settings) which writes to `localStorage`:

- **App ID** — `1089` is Deriv's public test id and is fine for local use. Register
  your own at <https://api.deriv.com> and whitelist your redirect URI for production.
- **Proxy** — optional base URL of `server/server.js` when you want keyed providers.

## Layout of the code

```
index.html            landing + app shell (icon sprite, preloader, views, modals)
assets/css/landing.css  landing page + preloader
assets/css/app.css      top bar, welcome banner, nav, cards, tables, toasts, dark theme
assets/css/builder.css  bot builder workspace
assets/js/config.js     app_id, endpoints, localStorage helpers, formatters
assets/js/deriv.js      WebSocket v3 client: req_id correlation, subscriptions, OAuth, reconnect
assets/js/feed.js       live/paper feed facade + the simulator
assets/js/market.js     symbol catalogue, market tree, canvas candlestick chart
assets/js/bot-engine.js block library, bot JSON model, rules engine (real orders)
assets/js/builder.js    palette, block canvas, run panel, CSV export, AI generator UI
assets/js/ui.js         toasts and modals
assets/js/app.js        boot, router, auth, dashboard, charts, DTrader, reports, risk
assets/js/landing.js    hero canvas, counters, reveals, marquee
server/server.js        static host + optional market-data proxy
```

A bot is portable JSON (`{ name, params, setups, analysis, purchase, sell, restart }`),
so it can be exported, imported, and stored with the save icon in the canvas toolbar.

## Notes

- The engine buys one contract at a time and never places an order without a settled
  proposal; `restartOnError` / `restartLastTradeOnError` and the sell rules are
  honoured exactly as configured on the canvas.
- Every proposal, buy, settlement and rule decision is written to the run journal,
  and the transactions table can be exported as CSV (Download).
- Trading is risky. Synthetic indices are volatile and martingale ladders can exhaust
  a balance quickly — the Risk Calculator exists to show that before you press Run.
