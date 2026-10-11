# SeedScout: tech stack & architecture

## Goals that drive the design

1. **Seed-accurate.** Every biome, structure and spawn must match the real game.
2. **Mobile-first.** The map is the product. It has to pan and pinch smoothly on a mid-range phone.
3. **Clear free/paid line** that can't be bypassed: map + score free; loot, search, saved seeds and export paid.
4. **Cheap to run.** The free tier should cost us ~nothing per user.

## Stack

| Layer | Choice | Why |
|---|---|---|
| World generation | **cubiomes** (C, MIT) compiled to **WebAssembly** | The reference open-source port of Minecraft's worldgen (Java 1.0 to 1.21). One binary runs in the browser and on the server. Tests prove the WASM build matches native output bit for bit. |
| Engine API | TypeScript package `@seedscout/engine` | Wraps the WASM. Also holds the scoring, the search evaluator, Minecraft's RNGs and the loot roller. Shared by web and API. |
| Web app | **React 19 + Vite**, **Leaflet** map, Web Worker pool | Leaflet has the best-tested touch support (pinch, inertia, tap tolerance) for a custom-CRS tile map. Tiles are rendered off the main thread. |
| API | **Cloudflare Workers + Hono** | Same platform as The Throne. Workers run WASM natively. One deploy serves the static app and `/api/*` from one origin, so cookies need no CORS. |
| Database | **Cloudflare D1** (SQLite) | Users, sessions, subscriptions, saved seeds, search jobs. |
| Background jobs | **Cloudflare Queues** | Seed search runs as resumable batches. |
| Payments | **Stripe Checkout + Customer Portal + webhooks** | Web billing only. No app-store IAP. |
| Auth | Email magic link (Resend) | No passwords to store. Fits a "save my seeds" use case. |

## System diagram

```
 Phone / desktop browser                                   Cloudflare
┌───────────────────────────────────────────┐      ┌──────────────────────────────────┐
│ React UI (bottom sheet, tabs, modals)     │      │ Worker (Hono)                    │
│   │                                       │ /api │  ├─ auth: magic link, sessions   │
│   ├─ Leaflet map ──┐                      │─────▶│  ├─ billing: Stripe checkout,    │
│   │                ▼                      │      │  │   portal, webhook ──▶ D1      │
│   │        Worker pool (N = cores-1)      │      │  ├─ PRO: loot, saved, export     │
│   │        cubiomes.wasm per worker       │      │  │   (engine WASM in-isolate)    │
│   │          tiles · structures · score   │      │  └─ PRO: search ──▶ Queue        │
│   │                                       │      │                       │          │
│   └─ FREE features run 100% client-side   │      │ Queue consumer: 3k seeds/batch,  │
└───────────────────────────────────────────┘      │ re-enqueue until done ──▶ D1     │
                                                   └──────────────────────────────────┘
```

**The gating rule.** Free features run in the browser, so they cost us nothing
and still work when the API is down. Paid features run on the server, behind
`requireFeature()`, so shipping code to the client never gives them away.
(Seed scoring runs client-side because it's a free feature.)

## Map rendering (mobile performance)

- Custom Leaflet CRS: 1 map unit = 1 block, with Z growing southward as in-game.
- Each 256-px tile costs **at most 64×64 biome samples**. The sampling scale (1:4, 1:16, 1:64, 1:256) is picked per zoom level, then upscaled with pixelated rendering. Measured: ~30 ms per tile per core.
- Tiles queue behind interactive requests and are cancelled when they scroll away, so fast panning doesn't build a backlog.
- Structure markers load only at zoom ≥ −3. They are diffed, not rebuilt. Hit targets are 44 px.
- A centre crosshair + coordinate pill replace hover, which doesn't exist on touch screens.
- Bottom sheet with peek/half/full positions and thumb-reachable zoom buttons that move up with the sheet. On ≥900 px it becomes a side panel.
- Payload: ~120 KB gzipped JS + 216 KB gzipped WASM, cached after first load.

## Seed evaluation

`scoreSeed()` measures facts around spawn: distance to key structures (with a
falloff curve), rare biomes within 512 blocks, biome variety, and land vs ocean.
It weighs them by a **profile** (`survival`, `speedrun`) and returns 0–100, a
grade (S–D), a one-line verdict, highlights and a full breakdown. ~30 ms per seed.
Weights are data, so tuning them needs no code changes. Before launch, calibrate
grade cut-offs against a few thousand random seeds so that "S" stays rare.

## Advanced search

A query is a list of clauses (`structure` within N of spawn, optionally *next to biome B*;
`biome` within N; `spawnBiome`; `minScore`). The evaluator runs the cheapest
clauses first and stops at the first failure. Biome-adjacency clauses get a coarse
1:64 prefilter.

Jobs scan a deterministic SplitMix64 stream of candidates from a random origin,
so any batch can resume from a cursor. Each queue message scans up to 3,000 seeds
(stopping early once it has enough matches), then re-enqueues the job. Measured
cost is ~7 ms per seed for structure + biome queries, about 140 seeds/s per core.

**Product caveat.** Some queries are genuinely rare. The brief's example,
"village next to a mushroom biome", almost never happens in 1.18+ because
mushroom fields generate as deep-ocean islands. 3,000 random seeds gave zero
hits within 500 blocks. Brute force is fine for common queries but won't do for
rare ones. The planned fix is a **seed index**: background workers keep scanning
seeds and store per-seed features (nearest structures, rare biomes near spawn,
score) in a table. Common and rare queries then become instant SQL lookups, with
brute-force jobs as the fallback. This index is also the moat: it gets better
the longer it runs.

## Loot prediction

See [LOOT.md](LOOT.md). The loot-table roller is implemented and tested against
`java.util.Random`. Per-structure loot-seed derivation is scaffolded. Every recipe
stays unverified until it matches chests dumped from a real server. The UI and
API label unverified output "experimental" and never present it as exact.

## Payments

- `POST /api/billing/checkout` creates a Stripe Checkout session in subscription mode (monthly/yearly price IDs come from env).
- `POST /api/billing/portal` opens Stripe's Customer Portal for upgrades, cancellations and card changes. We build no billing UI.
- **Only the webhook writes subscription state.** It verifies the signature, dedupes on event id, and orders writes by Stripe's event time so a late event can't undo a newer one. `checkout.session.completed` re-fetches the subscription so we don't depend on event order. Tested locally with signed test events: grant, duplicate, revoke, out-of-order and bad-signature cases.
- `active`, `trialing` and `past_due` grant Pro (`packages/shared/src/plans.ts`).
- **Apple.** This is a web app/PWA with Stripe billing, so Apple's in-app purchase rules don't apply. If it's ever wrapped as a native iOS app, digital subscriptions sold inside it fall under App Store rules. The usual approach is to keep purchase on the web; check Apple's current external-purchase rules for the target storefronts at that point.

## Auth & security

- Magic link: the token is stored hashed with a 15-minute TTL and is single-use (an atomic `UPDATE … RETURNING`). The link opens a confirmation page that POSTs, so email scanners that pre-fetch links can't burn the token.
- Session: random id, stored hashed, HttpOnly + SameSite=Lax cookie, 30 days.
- CSRF: mutations must be `application/json`, which cross-site forms can't send.
- Rate limits: login per IP, paid API per user, plus daily and concurrent search caps.

## Data model

`users`, `login_tokens`, `sessions`, `subscriptions`, `stripe_events`,
`saved_seeds`, `search_jobs`, `search_results`. See `apps/api/migrations/0001_init.sql`.

## Roadmap

1. **Loot ground-truth harness** → verify buried treasure / desert pyramid / shipwreck for 1.21 (the headline differentiator).
2. **Seed index** for instant search, plus a public "best seeds" gallery for SEO.
3. Shareable seed pages with OG images (`/s/<seed>`): free growth loop.
4. Nether/End maps (engine already supports them), slime chunks, Bedrock structure parity.
5. Offline PWA (service worker caching the WASM).
6. Swap React for Preact if JS size matters on low-end Android.

## Risks

- **Trademarks.** Don't use "Minecraft" in the product name or logo. Add a "not affiliated with Mojang/Microsoft" notice.
- **Mojang data.** Loot tables come from the game jar. Get legal advice before redistributing them in the bundle.
- **Version drift.** Each new game version needs a cubiomes bump plus re-verified loot recipes. CI should block on the native-vs-WASM and loot fixtures.
