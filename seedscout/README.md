# SeedScout

Mobile-first Minecraft seed tool: seed-accurate biome & structure map, seed scores,
chest-loot prediction and advanced seed search, with a Stripe-billed Pro tier.

> Working name. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack, design and roadmap.

```
packages/engine   cubiomes → WASM, plus TS: map/structures, scoring, search, RNGs, loot
packages/shared   plans & entitlements, API contracts (zod)
apps/web          React + Vite + Leaflet PWA (free features run client-side)
apps/api          Cloudflare Worker (Hono, D1, Queues, Stripe): auth + Pro features
docs/             ARCHITECTURE.md, LOOT.md
```

## Run it

```bash
cd seedscout
npm install
npm test                 # engine tests: WASM matches native cubiomes, RNG vectors, search, loot
npm run dev              # web app on http://localhost:5173 (map + score work with no backend)
```

Backend (sign-in, Pro features), in a second terminal:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars   # Stripe test keys; leave RESEND empty in dev
npm run db:migrate:local -w @seedscout/api
npm run dev:api          # Worker on :8787, proxied by Vite at /api
```

In dev, sign-in links are shown in the UI instead of emailed. To test Pro without
Stripe, insert a row into `subscriptions` with `status = 'active'`. To test real
billing: `stripe listen --forward-to localhost:8787/api/stripe/webhook`.

## Rebuild the WASM

`packages/engine/wasm/cubiomes.wasm` is committed so nobody needs a C toolchain.
To rebuild (for example after bumping `native/CUBIOMES_COMMIT` for a new game version):

```bash
npm run build:wasm       # needs clang with the wasm32 target + wasm-ld; fetches wasi-sysroot
```

## Deploy (Cloudflare)

```bash
npx wrangler d1 create seedscout-db           # paste the id into apps/api/wrangler.jsonc
npx wrangler queues create seedscout-search
npm run db:migrate:remote -w @seedscout/api
cd apps/api && for s in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY; do npx wrangler secret put $s; done
cd ../.. && npm run deploy
```

Set `SITE_URL`, `EMAIL_FROM` and `STRIPE_PRICE_MONTH/YEAR` in `wrangler.jsonc`, then
add a Stripe webhook to `<SITE_URL>/api/stripe/webhook` for `checkout.session.completed`
and `customer.subscription.*`. Search batches use `limits.cpu_ms`, which requires the Workers Paid plan.

## Status

| Feature | State |
|---|---|
| Biome map, structures, spawn, strongholds (Java 1.16–1.21) | Working, seed-accurate |
| Seed score & verdict | Working. Grade thresholds need calibrating |
| Advanced search (jobs, resumable batches) | Working. Seed index planned for rare queries |
| Saved seeds, export JSON/CSV | Working |
| Auth, Stripe subscriptions, entitlements | Working (tested locally with signed webhooks) |
| Loot prediction | Table roller done. Per-structure seed recipes need verifying ([docs/LOOT.md](docs/LOOT.md)) |
