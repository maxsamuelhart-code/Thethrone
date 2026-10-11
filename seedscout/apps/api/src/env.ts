export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SEARCH_QUEUE: Queue<SearchMessage>;
  LOGIN_LIMITER: RateLimit;
  API_LIMITER: RateLimit;
  SITE_URL: string;
  EMAIL_FROM: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_MONTH: string;
  STRIPE_PRICE_YEAR: string;
  RESEND_API_KEY?: string;
  LOOT_ALLOW_UNVERIFIED: string;
  DEV: string;
}

/** Hono environment shared by all handlers. `user` is set by requireUser. */
export type AppEnv = { Bindings: Env; Variables: { user: import("./auth").User } };

export interface SearchMessage {
  jobId: string;
}
