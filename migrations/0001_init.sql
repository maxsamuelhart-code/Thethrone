-- One row per paid reign. The current king is the latest row by payment time.
-- A reign ends when the next reign (in payment order) starts.
CREATE TABLE reigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  message           TEXT    NOT NULL CHECK (length(message) <= 60),
  email             TEXT    NOT NULL,
  paid_at           INTEGER NOT NULL,           -- ms epoch, from Stripe; defines payment order
  stripe_session_id TEXT    NOT NULL UNIQUE,    -- idempotency: each payment crowns once
  message_removed   INTEGER NOT NULL DEFAULT 0, -- set by admin
  created_at        INTEGER NOT NULL            -- ms epoch, when the webhook was processed
);

CREATE INDEX idx_reigns_order ON reigns (paid_at, id);
