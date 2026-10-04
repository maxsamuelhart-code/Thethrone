import type { Env } from "./env";
import { currentKing, deleteMessage, isCrowned, leaderboard, recentReigns } from "./db";
import { sendDethronedEmail } from "./email";
import { adminPage, homePage, privacyPage, termsPage } from "./html";
import { moderate, ModerationUnavailableError } from "./moderation";
import { createCheckout, handleStripeWebhook } from "./payments";
import { validateEntry } from "./validate";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function html(body: string, nonce: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'self'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join("; "),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false; // never open the admin page by accident
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(":") + 1); // any username
  return timingSafeEqual(password, env.ADMIN_PASSWORD);
}

const unauthorized = () =>
  new Response("Admin password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="The Throne admin", charset="UTF-8"' },
  });

/** Blocks cross-site form posts to state-changing endpoints. */
const sameOrigin = (request: Request) => request.headers.get("Origin") === new URL(request.url).origin;

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Bad origin." }, 403);

  if (env.CHECKOUT_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.CHECKOUT_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "Slow down, your majesty. Try again in a minute." }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const v = validateEntry(body);
  if (!v.ok) return json({ error: v.error }, 400);

  // Moderation happens BEFORE we create a Stripe session, so rejected text never reaches payment.
  try {
    const verdict = await moderate(env, v.entry.name, v.entry.message);
    if (!verdict.allowed) return json({ error: verdict.reason }, 422);
  } catch (err) {
    if (err instanceof ModerationUnavailableError) {
      return json({ error: "Our royal censor is napping. Please try again shortly." }, 503);
    }
    throw err;
  }

  try {
    const url = await createCheckout(env, v.entry);
    return json({ url });
  } catch (err) {
    console.error("stripe checkout failed", err);
    return json({ error: "Couldn't start payment. Please try again." }, 502);
  }
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const result = await handleStripeWebhook(env, request);
  if (!result.ok) return new Response(result.error, { status: result.status });

  const outcome = result.outcome;
  const notify = (to: string, by: string) =>
    ctx.waitUntil(sendDethronedEmail(env, to, by).catch((err) => console.error("dethroned email failed", err)));

  if (outcome?.status === "crowned" && outcome.dethroned && outcome.dethroned.email !== outcome.reign.email) {
    notify(outcome.dethroned.email, outcome.reign.name);
  } else if (outcome?.status === "historic" && outcome.successor.email !== outcome.reign.email) {
    // This payment was made before the current king's but confirmed later: in payment order it
    // was immediately succeeded, so its owner is the one who got dethroned.
    notify(outcome.reign.email, outcome.successor.name);
  }
  return json({ received: true });
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isAdmin(request, env))) return unauthorized();
  const nonce = newNonce();

  if (request.method === "POST" && url.pathname === "/admin/delete-message") {
    if (!sameOrigin(request)) return new Response("Bad origin", { status: 403 });
    const form = await request.formData();
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return new Response("Bad id", { status: 400 });
    await deleteMessage(env, id);
    return Response.redirect(`${url.origin}/admin?deleted=${id}`, 303);
  }
  if (request.method === "GET" && url.pathname === "/admin") {
    const deleted = url.searchParams.get("deleted");
    return html(adminPage(env, await recentReigns(env), nonce, deleted ? `Message #${deleted} deleted.` : undefined), nonce);
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (method === "GET" && pathname === "/") {
        const nonce = newNonce();
        const [king, board] = await Promise.all([currentKing(env), leaderboard(env)]);
        return html(homePage(env, king, board, nonce), nonce);
      }
      if (method === "GET" && pathname === "/api/state") {
        const [king, board] = await Promise.all([currentKing(env), leaderboard(env)]);
        return json({ king, board });
      }
      if (method === "GET" && pathname === "/api/session-status") {
        const id = url.searchParams.get("id") ?? "";
        if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ crowned: false });
        return json({ crowned: await isCrowned(env, id) });
      }
      if (method === "POST" && pathname === "/api/checkout") return await handleCheckout(request, env);
      if (method === "POST" && pathname === "/api/stripe-webhook") return await handleWebhook(request, env, ctx);
      if (pathname === "/admin" || pathname.startsWith("/admin/")) return await handleAdmin(request, env, url);
      if (method === "GET" && pathname === "/terms") {
        const nonce = newNonce();
        return html(termsPage(env, nonce), nonce);
      }
      if (method === "GET" && pathname === "/privacy") {
        const nonce = newNonce();
        return html(privacyPage(env, nonce), nonce);
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("unhandled error", pathname, err);
      // A 500 on the webhook makes Stripe retry, which is what we want for transient DB errors.
      return pathname.startsWith("/api/") ? json({ error: "Server error." }, 500) : new Response("Server error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
