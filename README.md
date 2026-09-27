# Binary Signal Flow

**Build powerful automated trading bots without coding.** An animated landing
page that leads into a full Deriv trading workspace: a block-based Bot Builder,
live charts, DTrader-style order tickets, reports and a risk calculator.

No framework, no build tooling, no dependencies — plain HTML, CSS and ES
modules that talk to Deriv's public API straight from the browser.

```
Animated preloader → landing page → Deriv OAuth sign-up/sign-in → dashboard
                                   ↘ "Skip login" → paper-trading workspace
```

## Features

- **Landing page** — particle/candle hero canvas, gradient orbs, scroll
  reveals, animated counters, live ticker marquee, FAQ.
- **Auth** — Deriv OAuth (popup), an "Authorize application" API-token
  fallback, and a clearly-labelled paper mode that needs no credentials.
- **Dashboard** — animated stat cards, live market watch, open positions.
- **Bot Builder** — drag-and-drop block menu (Analysis Logics 🔥, Market
  Structure, Trade parameters, Purchase/Sell conditions, Restart conditions,
  Analysis, Utility, Binary Signal Flow Tools), numbered canvas blocks with a
  Market → submarket → Volatility 100 cascade, martingale/stake ladders,
  stop-loss / take-profit / max-trade rules, plus a Run panel with
  **Summary / Transactions / Journal** tabs, live stats and CSV journal export.
- **Bot engine** — subscribes to ticks, seeds digit history, evaluates purchase
  rules, proposes → buys → tracks each contract to settlement, and journals
  every decision.
- **More views** — Charts, DTrader, Reports, Risk Calculator, Bulk Trader,
  Signals, Copy Trading, Quote Builder and more.

## Run it locally

```bash
npm run dev        # → http://localhost:8787/
```

A tiny Node static server (`market-terminal/server/server.js`) with zero
dependencies. `PORT` overrides the port.

## Deploy

Static hosting only — see **[DEPLOY.md](DEPLOY.md)** for the one-click Vercel
import.

```bash
npm run build      # assembles market-terminal/ into public/
```

## Layout

```
market-terminal/
  index.html                 app shell + SVG icon sprite
  assets/css/                landing.css · app.css · builder.css
  assets/js/
    config.js                app id, endpoints, formatting helpers
    deriv.js                 WebSocket v3 transport + OAuth
    feed.js                  live/simulated market-data facade
    market.js                symbol catalogue + canvas chart renderer
    bot-engine.js            block-tree interpreter
    builder.js               Bot Builder UI
    app.js                   router, auth flow, all views
    landing.js               landing animations
  server/server.js           optional local host
scripts/build-static.mjs     static build for Vercel
```

## Market data

The live path uses Deriv's `wss://ws.derivws.com/websockets/v3`. Where that
socket is unreachable (corporate/geo restrictions), the app switches to a
labelled paper-trading simulator: synthetic ticks per index, payouts priced
from each contract's real win probability, and a paper balance kept in
`localStorage`. The status strip under the banner always states which mode is
active.

## Disclaimer

Independent client for Deriv's public API — not affiliated with or endorsed by
Deriv. Automated trading carries real financial risk; the paper mode exists so
you can test a strategy before risking anything.

## License

MIT
