-- Users sign in with an emailed magic link; Stripe owns billing state, mirrored here by webhooks.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,               -- Stripe subscription id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  price_id TEXT,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL        -- Stripe event time; older events never overwrite newer state
);
CREATE INDEX subscriptions_user ON subscriptions(user_id);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE TABLE saved_seeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  version TEXT NOT NULL,
  label TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, seed, version)
);

CREATE TABLE search_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,               -- JSON SearchRequest
  start_seed TEXT NOT NULL,          -- random origin of the candidate stream
  cursor INTEGER NOT NULL DEFAULT 0, -- candidates scanned so far
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX search_jobs_user ON search_jobs(user_id, created_at);

CREATE TABLE search_results (
  job_id TEXT NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  match TEXT NOT NULL,               -- JSON SearchMatch
  PRIMARY KEY (job_id, seed)
);
