# Deploying to Vercel

The app is a **dependency-free static site** — plain HTML/CSS/ES modules, no
framework, no `npm install`, no runtime server. `scripts/build-static.mjs`
copies `market-terminal/index.html` + `market-terminal/assets/` into `public/`,
and `vercel.json` tells Vercel to serve that directory.

There is **nothing to configure**: no environment variables, no secrets, no
database.

---

## 1. Import the repo (one click, once)

1. Sign in at <https://vercel.com> (GitHub sign-in is easiest).
2. Open <https://vercel.com/new>.
3. Under **Import Git Repository**, pick `justcallmedavy-art/binary-signal-flow`
   (it's public, so it may need a click on *Adjust GitHub App Permissions* to
   appear in the list).
4. Vercel should auto-fill the settings. Confirm they read:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | **Other** |
   | Root Directory | `./` (leave as-is) |
   | Build Command | `node scripts/build-static.mjs` |
   | Output Directory | `public` |
   | Install Command | *(whatever Vercel picks — a no-op)* |

   These come from `vercel.json`, so if Vercel shows them already, don't touch
   them.
5. Press **Deploy**. The first build takes well under a minute because there is
   nothing to compile or install.

You'll get a URL like `https://binary-signal-flow.vercel.app`.

Every later `git push` to `main` redeploys automatically; pull requests get
their own preview URLs.

---

## 2. Custom domain (optional)

Project → **Settings → Domains → Add**, then point your DNS at Vercel. If you
use the `binarysignalflow.site` domain, add both the apex and `www`.

---

## 3. Deriv login on the deployed domain

The landing page, dashboard and Bot Builder all work immediately — including
the labelled paper-trading simulator, which needs no credentials at all.

For **real** Deriv sign-in from your Vercel URL, the OAuth handshake has to
redirect back to a URI Deriv has whitelisted for your app id:

- The app sends `redirect_uri = <origin>/` (i.e. `https://your-domain.vercel.app/`).
- Register your own app id at <https://api.deriv.com>, then set its
  **Redirect URI** to exactly your deployed URL (scheme, host and trailing
  slash must match).
- Point the build at it: the app id is read from `localStorage` key
  `bsf.app_id` (set it in **Settings → API** inside the app) and falls back to
  `CONFIG.appId` in `market-terminal/assets/js/config.js`. Change that constant
  and commit if you want it baked in for everyone.

The public test id `1089` will not accept arbitrary redirect URIs, so logins
from a brand-new domain should use your own app id. Trading with a real token
also requires the Deriv account's API token (Account → API token), which the
app never stores anywhere except your own browser's `localStorage`.

---

## 4. What is *not* deployed

`market-terminal/server/` is a small local convenience host (static files plus
an optional keyed-data proxy). It is intentionally **not** part of the Vercel
deployment — the browser talks to Deriv directly over WebSocket. To remove that
limitation entirely, `market-terminal/assets/js/config.js` exposes a
`proxyBase` setting if you later add a serverless function.

---

## Local commands

```bash
npm run dev     # serve locally on http://localhost:8787/
npm run build   # assemble public/ exactly as Vercel does
```
