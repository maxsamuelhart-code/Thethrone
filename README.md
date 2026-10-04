# 👑 The Throne

Pay £2, take the throne. Your name and message sit on the homepage, with a live timer, until someone pays to knock you off.

**Stack:** TypeScript on Cloudflare Workers, D1 (SQLite) database, Stripe Checkout, Claude Haiku 4.5 for moderation, Resend for email.

## How it works

1. A visitor clicks **Take the throne – £2** and enters a name (≤20 chars), a message (≤60 chars) and an email.
2. `POST /api/checkout` validates the input and runs a quick regex filter (links, emails, phone numbers). Then it asks **Claude Haiku 4.5** whether the text breaks the rules. If the text is rejected, the visitor sees why and is **never sent to Stripe**. If the moderation call fails, the request is refused too (fails closed).
3. If it passes, a Stripe Checkout session is created. The approved text travels in the session's metadata.
4. Stripe calls `POST /api/stripe-webhook`. The signature is verified, the amount (£2 GBP) is checked, and only then is the reign written to D1.
5. **Payment order:** reigns are ordered by Stripe's payment timestamp, not by when the webhook arrives. If two people pay at nearly the same time and the webhooks arrive out of order, both still go into the timeline in the order they paid. Webhook retries are ignored (`stripe_session_id` is `UNIQUE`).
6. The dethroned king gets an email via Resend: *"You've been dethroned by [name]. Take it back →"*.
7. `/admin` (password protected) lists every reign and can delete any message instantly.

```
src/
  index.ts       routes, admin auth, security headers
  moderation.ts  Claude Haiku 4.5 moderation (structured JSON output)
  payments.ts    Stripe Checkout + webhook signature verification
  db.ts          D1 queries: current king, leaderboard, crowning in payment order
  email.ts       Resend "dethroned" email
  html.ts        all pages (home, admin, terms, privacy)
  validate.ts    input validation + cheap pre-filters
migrations/0001_init.sql
```

---

## Setup and deployment, step by step

Takes about 45 minutes. You need **Node.js 20+** and a terminal. Set everything up in **test mode** first and switch to live payments at the end.

### Step 0: Get the code

```bash
git clone https://github.com/maxsamuelhart-code/thethrone.git
cd thethrone
npm install
```

### Step 1: Cloudflare account and database

1. Sign up at **https://dash.cloudflare.com/sign-up** (the free plan is enough).
2. Log the CLI in. This opens a browser window:
   ```bash
   npx wrangler login
   ```
3. Create the database:
   ```bash
   npx wrangler d1 create throne-db
   ```
   It prints a `database_id`. Paste it into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.
4. Create the tables:
   ```bash
   npm run db:migrate:remote
   ```
5. Deploy once to get your URL:
   ```bash
   npm run deploy
   ```
   Wrangler prints something like `https://the-throne.YOUR-SUBDOMAIN.workers.dev`. Keep this URL; you'll need it below. (The site will load, but checkout won't work until the secrets are set.)

### Step 2: Anthropic (Claude) for moderation

1. Sign up at **https://console.anthropic.com**.
2. **Settings → Billing**: add a payment method and buy a few dollars of credit. Each check costs a fraction of a penny.
3. **Settings → Limits**: set a monthly spend limit, e.g. $10, as a safety net.
4. **Settings → API Keys → Create Key**. Copy it (starts with `sk-ant-`), then:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste the key when prompted.

### Step 3: Stripe (start in test mode)

1. Sign up at **https://dashboard.stripe.com/register**.
2. Make sure the **Test mode** toggle (top right) is on.
3. **Developers → API keys**: reveal the **Secret key** (`sk_test_...`), then:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   ```
4. **Developers → Webhooks → Add endpoint**:
   - **Endpoint URL:** `https://the-throne.YOUR-SUBDOMAIN.workers.dev/api/stripe-webhook`
   - **Events:** `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Save, then click **Reveal** under *Signing secret* (`whsec_...`):
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

### Step 4: Resend for email

1. Sign up at **https://resend.com**.
2. **Domains → Add Domain**. Use a domain you own, e.g. `mail.yourdomain.com`. Resend shows a few DNS records (SPF/DKIM). Add them at your domain registrar. If the domain is on Cloudflare, Resend can add them for you. Wait until the domain shows **Verified**.
   *(No domain yet? Resend's `onboarding@resend.dev` sender only delivers to your own address. That's fine for testing, but you need a real domain before launch.)*
3. **API Keys → Create API Key** with *Sending access*:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

### Step 5: Admin password

Choose a long random password, e.g. the output of `openssl rand -base64 24`:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

At `/admin` the browser asks for a username and password. Any username works; only the password is checked.

### Step 6: Site settings, then redeploy

Edit the `vars` block in `wrangler.jsonc`. These aren't secrets.

```jsonc
"vars": {
  "SITE_URL": "https://the-throne.YOUR-SUBDOMAIN.workers.dev", // no trailing slash
  "CONTACT_EMAIL": "you@yourdomain.com",
  "EMAIL_FROM": "The Throne <throne@mail.yourdomain.com>"      // must be on your verified Resend domain
}
```

```bash
npm run deploy
```

Check that all five secrets are set:

```bash
npx wrangler secret list
# ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, ADMIN_PASSWORD
```

### Step 7: Test end to end (still test mode)

1. Open your site on your phone. Tap **Take the throne – £2**.
2. Try something that should be rejected, e.g. message `call me on 07700 900123`. You should see an error and **not** be sent to Stripe.
3. Enter a normal name and message with **your own email**. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry date, any CVC.
4. You should come back to "Payment received! Polishing your crown…" and then see yourself crowned.
5. Do it again with a different name and a second email address you can check. The first address should get the "dethroned" email.
6. Visit `/admin`, enter the password and delete a message. It disappears from the homepage straight away.
7. If something fails: **Stripe → Developers → Webhooks → your endpoint** shows each delivery and its response. `npx wrangler tail` streams the Worker's logs live.

### Step 8: Go live

1. In Stripe, click **Activate payments** and fill in your business and bank details.
2. Switch the dashboard **out of** Test mode, then repeat Step 3 with the **live** keys: a new `sk_live_...` secret key and a **new** live webhook endpoint (it has its own `whsec_...`). Run `wrangler secret put` again for both.
3. Optional: use your own domain. **Cloudflare dashboard → Workers & Pages → the-throne → Settings → Domains & Routes → Add custom domain.** Then update `SITE_URL`, run `npm run deploy`, and update the Stripe webhook URL to the new domain.
4. Make one real £2 payment to yourself to confirm it all works. You can refund it from the Stripe dashboard.
5. Before launch, review `/terms` and `/privacy` (in `src/html.ts`). They're starter templates, not legal advice. UK consumer rules generally require selling businesses to show a trading name and a geographic address.

---

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in TEST keys; add SITE_URL=http://localhost:8787
npm run db:migrate:local
npm run dev                            # http://localhost:8787
```

To receive Stripe webhooks locally, install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:8787/api/stripe-webhook
```

Put the `whsec_...` it prints into `.dev.vars` as `STRIPE_WEBHOOK_SECRET`.

`npm run typecheck` runs the TypeScript checker.

## Secrets and config

| Name | Type | Where to set it |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put` |
| `STRIPE_SECRET_KEY` | secret | `wrangler secret put` |
| `STRIPE_WEBHOOK_SECRET` | secret | `wrangler secret put` |
| `RESEND_API_KEY` | secret | `wrangler secret put` |
| `ADMIN_PASSWORD` | secret | `wrangler secret put` |
| `SITE_URL`, `CONTACT_EMAIL`, `EMAIL_FROM` | plain config | `vars` in `wrangler.jsonc` |

No secret is in the code or the repo. `.dev.vars` is git-ignored.

## Safety notes

- Checkout is rate-limited to 5 attempts per IP per minute, which keeps moderation costs down.
- Emails are never shown publicly or returned by any API.
- All user text is HTML-escaped. Pages send a strict Content-Security-Policy with per-request nonces.
- Admin actions require the password **and** a same-origin request, so other sites can't trigger deletes.
