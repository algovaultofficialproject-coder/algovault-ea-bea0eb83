# Deploying AlgoVault to Cloudflare Pages

The Lovable deployment (https://algovault-ea.lovable.app) keeps working unchanged. Cloudflare is an extra copy.

## How it builds
- This is a server-rendered app with server functions and API routes, not a static site.
- On Cloudflare Pages the build automatically switches to the Pages target and writes
  `dist/` with a `_worker.js` server, static assets and `_routes.json`.
- Every page refresh / deep link is served by the server, so no `_redirects` SPA rule is needed
  (do not add one — it would bypass the server).

## Cloudflare Pages settings
| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `bun install --frozen-lockfile && bun run build` |
| Build output directory | `dist` |
| Root directory | (leave empty) |
| Env var `SKIP_DEPENDENCY_INSTALL` | `true` (Pages doesn't detect `bun.lock` and would use npm) |
| Env var `NODE_VERSION` | `22` (also pinned by `.node-version`) |

## Environment variables
Copy the three public `VITE_SUPABASE_*` values from the `.env` file in the synced GitHub repo;
set `SUPABASE_URL` = the `VITE_SUPABASE_URL` value and `SUPABASE_PUBLISHABLE_KEY` = the `VITE_SUPABASE_PUBLISHABLE_KEY` value.
Names are listed in `.dev.vars.example`. Public `VITE_*` values are safe in the browser.
Everything else is server-only: add it as an encrypted Secret in Cloudflare, never in code.

## Known limitation while the backend stays on Lovable Cloud (accepted: owner chose Option A)
`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY` and the scheduler secret are managed by Lovable
and cannot be exported. Server code that needs them (licences, EA configs, broker connections,
bridge keys, manual signals for EAs, app access, admin, payments, app file upload, AI scan/review,
emails, 24/7 guard) fails on Cloudflare until the backend moves to a database you control.

## After deploying
- Add `https://algovault-ea.com` (and the `*.pages.dev` URL) to the allowed redirect URLs in
  Lovable Cloud → Users → Auth settings → Advanced.

## Which site to use (Option A)
- Cloudflare copy (algovault-ea.com): landing page, mentor sign-up/sign-in, dashboard, promo sites,
  AutoTrader / Trade Log screens, signals and downloads.
- Lovable site (algovault-ea.lovable.app): everything, including licences, EA bots, broker links,
  robot signal pickup, payments, admin, emails, AI scan and the 24/7 guard. Keep desktop EAs,
  the bridge and the Android app pointed at the Lovable address.
