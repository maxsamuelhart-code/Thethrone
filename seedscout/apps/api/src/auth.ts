/**
 * Passwordless auth: an emailed one-time link. The link opens a confirm page that
 * POSTs the token, so email scanners that pre-fetch links can't burn it.
 * Only SHA-256 hashes of tokens and session ids are stored.
 */
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Env } from "./env";
import { newId, now, randomToken, sha256 } from "./util";
import { ENTITLED_STATUSES, PLAN_FEATURES, type Me, type Plan } from "@seedscout/shared";

const COOKIE = "ss_session";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const LINK_MS = 15 * 60 * 1000;

export interface User {
  id: string;
  email: string;
  stripe_customer_id: string | null;
}

export async function sendLoginLink(env: Env, email: string): Promise<string | null> {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), email.toLowerCase(), now() + LINK_MS)
    .run();
  const link = `${env.SITE_URL}/api/auth/callback?token=${token}`;

  if (!env.RESEND_API_KEY) {
    if (env.DEV !== "1") throw new Error("RESEND_API_KEY is not configured");
    console.log(`[dev] login link for ${email}: ${link}`);
    return link; // surfaced to the dev UI only
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: "Your SeedScout sign-in link",
      text: `Tap to sign in to SeedScout:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
  return null;
}

/** Consumes a login token and starts a session. Returns false if the token is invalid, used or expired. */
export async function verifyLogin(c: Context<AppEnv>, token: string): Promise<boolean> {
  const env = c.env;
  const hash = await sha256(token);
  // Single statement marks the token used, so concurrent submits can't both succeed.
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email",
  )
    .bind(now(), hash, now())
    .first<{ email: string }>();
  if (!row) return false;

  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(newId(), row.email, now())
    .run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(row.email).first<{ id: string }>();
  if (!user) return false;

  const sid = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(sid), user.id, now() + SESSION_MS, now())
    .run();
  setCookie(c, COOKIE, sid, {
    httpOnly: true,
    secure: env.SITE_URL.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return true;
}

export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  const sid = getCookie(c, COOKIE);
  if (!sid) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.email, u.stripe_customer_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(sid), now())
    .first<User>();
}

export async function logout(c: Context<AppEnv>): Promise<void> {
  const sid = getCookie(c, COOKIE);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(sid)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function planFor(env: Env, user: User | null): Promise<{ plan: Plan; subscription: Me["subscription"] }> {
  if (!user) return { plan: "free", subscription: null };
  const sub = await env.DB.prepare(
    "SELECT status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(user.id)
    .first<{ status: string; current_period_end: number | null; cancel_at_period_end: number }>();
  if (!sub) return { plan: "free", subscription: null };
  return {
    plan: ENTITLED_STATUSES.has(sub.status) ? "pro" : "free",
    subscription: {
      status: sub.status,
      currentPeriodEnd: sub.current_period_end ?? 0,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    },
  };
}

export async function me(c: Context<AppEnv>): Promise<Me> {
  const user = await currentUser(c);
  const { plan, subscription } = await planFor(c.env, user);
  return {
    user: user && { id: user.id, email: user.email },
    plan,
    features: [...PLAN_FEATURES[plan]],
    subscription,
  };
}
