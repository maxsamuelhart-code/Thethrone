export interface Env {
  DB: D1Database;
  CHECKOUT_LIMITER?: RateLimit;

  // Plain vars (wrangler.jsonc "vars")
  SITE_URL: string;
  CONTACT_EMAIL: string;
  EMAIL_FROM: string;

  // Secrets (`wrangler secret put` / .dev.vars)
  ANTHROPIC_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ADMIN_PASSWORD: string;
}
