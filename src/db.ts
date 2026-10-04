import type { Env } from "./env";

export interface Reign {
  id: number;
  name: string;
  message: string;
  email: string;
  paid_at: number;
  stripe_session_id: string;
  message_removed: number;
}

export interface PublicReign {
  id: number;
  name: string;
  message: string;
  since: number;
  duration?: number; // ms; present on leaderboard rows
  reigning?: boolean;
}

export const toPublic = (r: Pick<Reign, "id" | "name" | "message" | "message_removed" | "paid_at">): PublicReign => ({
  id: r.id,
  name: r.name,
  message: r.message_removed ? "" : r.message,
  since: r.paid_at,
});

// Payment order is (paid_at, id). Every query that needs "before"/"after" uses that same ordering.
const ORDER = "paid_at, id";

export async function currentKing(env: Env): Promise<PublicReign | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, message, message_removed, paid_at FROM reigns ORDER BY paid_at DESC, id DESC LIMIT 1`,
  ).first<Reign>();
  return row ? toPublic(row) : null;
}

export async function leaderboard(env: Env, now = Date.now()): Promise<PublicReign[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, message, message_removed, paid_at, ended_at IS NULL AS reigning,
            COALESCE(ended_at, ?1) - paid_at AS duration
       FROM (SELECT *, LEAD(paid_at) OVER (ORDER BY ${ORDER}) AS ended_at FROM reigns)
      ORDER BY duration DESC, paid_at ASC
      LIMIT 10`,
  )
    .bind(now)
    .all<Reign & { duration: number; reigning: number }>();
  return results.map((r) => ({ ...toPublic(r), duration: r.duration, reigning: !!r.reigning }));
}

export async function isCrowned(env: Env, sessionId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 FROM reigns WHERE stripe_session_id = ?`).bind(sessionId).first();
  return !!row;
}

export type CrownOutcome =
  | { status: "duplicate" }
  | { status: "crowned"; reign: Reign; dethroned: Reign | null }
  // A payment that confirmed late but was made before the current king's: it slots into
  // history in payment order, and was immediately succeeded by `successor`.
  | { status: "historic"; reign: Reign; successor: Reign };

/**
 * Inserts a paid reign. Idempotent on the Stripe session id, so webhook retries are harmless.
 * D1 serialises writes, so concurrent webhooks can't both claim the same slot; ordering is by
 * Stripe's payment timestamp, not by webhook arrival.
 */
export async function crown(
  env: Env,
  r: { name: string; message: string; email: string; paidAt: number; sessionId: string },
): Promise<CrownOutcome> {
  const inserted = await env.DB.prepare(
    `INSERT INTO reigns (name, message, email, paid_at, stripe_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING *`,
  )
    .bind(r.name, r.message, r.email, r.paidAt, r.sessionId, Date.now())
    .first<Reign>();
  if (!inserted) return { status: "duplicate" };

  const [prev, next] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM reigns WHERE (paid_at < ?1) OR (paid_at = ?1 AND id < ?2)
        ORDER BY paid_at DESC, id DESC LIMIT 1`,
    )
      .bind(inserted.paid_at, inserted.id)
      .first<Reign>(),
    env.DB.prepare(
      `SELECT * FROM reigns WHERE (paid_at > ?1) OR (paid_at = ?1 AND id > ?2)
        ORDER BY ${ORDER} LIMIT 1`,
    )
      .bind(inserted.paid_at, inserted.id)
      .first<Reign>(),
  ]);

  if (next) return { status: "historic", reign: inserted, successor: next };
  return { status: "crowned", reign: inserted, dethroned: prev };
}

export async function recentReigns(env: Env, limit = 200): Promise<Reign[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM reigns ORDER BY paid_at DESC, id DESC LIMIT ?`)
    .bind(limit)
    .all<Reign>();
  return results;
}

/** Permanently deletes the message text. The reign itself (name, time) stays in the timeline. */
export async function deleteMessage(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`UPDATE reigns SET message = '', message_removed = 1 WHERE id = ?`).bind(id).run();
}
