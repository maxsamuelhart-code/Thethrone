import { Hono, type Context, type Next } from "hono";
import { isVersion, LootUnavailableError, predictStructureLoot } from "@seedscout/engine";
import {
  can,
  CheckoutSchema,
  LIMITS,
  LoginSchema,
  LootRequestSchema,
  SaveSeedSchema,
  SearchRequestSchema,
  type Feature,
  type LootResponse,
  type SavedSeed,
} from "@seedscout/shared";
import type { z } from "zod";
import type { AppEnv, Env, SearchMessage } from "./env";
import { currentUser, logout, me, planFor, sendLoginLink, verifyLogin } from "./auth";
import { createCheckout, createPortal, handleWebhook } from "./billing";
import { cancelJob, createJob, failJob, getJob, runBatch, SearchLimitError } from "./search";
import { getEngine } from "./engine";
import { buildExport, toCsv } from "./export";
import { newId, now } from "./util";

const app = new Hono<AppEnv>().basePath("/api");

app.use(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
});

// CSRF: the session cookie is SameSite=Lax, and state-changing JSON endpoints
// insist on a JSON content type, which cross-site forms cannot send.
app.use(async (c, next) => {
  const exempt = c.req.path === "/api/stripe/webhook" || c.req.path === "/api/auth/verify";
  if (c.req.method !== "GET" && !exempt && !c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "expected application/json" }, 415);
  }
  await next();
});

async function parse<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  const body = await c.req.json().catch(() => undefined);
  const r = schema.safeParse(body);
  return r.success ? r.data : c.json({ error: "invalid request", issues: r.error.issues }, 400);
}

const requireUser = async (c: Context<AppEnv>, next: Next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "sign in required" }, 401);
  c.set("user", user);
  await next();
};

const requireFeature = (f: Feature) => async (c: Context<AppEnv>, next: Next) => {
  const { plan } = await planFor(c.env, c.get("user"));
  if (!can(plan, f)) return c.json({ error: "pro required", feature: f }, 402);
  const { success } = await c.env.API_LIMITER.limit({ key: c.get("user").id });
  if (!success) return c.json({ error: "slow down" }, 429);
  await next();
};

// ---------- auth ----------
app.get("/me", async (c) => c.json(await me(c)));

app.post("/auth/login", async (c) => {
  const body = await parse(c, LoginSchema);
  if (body instanceof Response) return body;
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!(await c.env.LOGIN_LIMITER.limit({ key: ip })).success) return c.json({ error: "too many attempts" }, 429);
  const devLink = await sendLoginLink(c.env, body.email);
  return c.json({ ok: true, ...(devLink && { devLink }) });
});

app.get("/auth/callback", (c) => {
  const token = c.req.query("token") ?? "";
  const esc = token.replace(/[^A-Za-z0-9_-]/g, "");
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${esc}">
<button style="font-size:18px;padding:16px 32px;border-radius:12px;border:0;background:#5bbd4f;color:#111;font-weight:700">Sign in to SeedScout</button></form>`);
});

app.post("/auth/verify", async (c) => {
  const form = await c.req.formData();
  const ok = await verifyLogin(c, String(form.get("token") ?? ""));
  return c.redirect(ok ? "/?signed_in=1" : "/?login_error=1", 303);
});

app.post("/auth/logout", async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

// ---------- billing ----------
app.post("/billing/checkout", requireUser, async (c) => {
  const body = await parse(c, CheckoutSchema);
  if (body instanceof Response) return body;
  return c.json({ url: await createCheckout(c.env, c.get("user"), body.interval) });
});

app.post("/billing/portal", requireUser, async (c) => c.json({ url: await createPortal(c.env, c.get("user")) }));

app.post("/stripe/webhook", (c) => handleWebhook(c.env, c.req.raw));

// ---------- pro: loot ----------
app.post("/loot", requireUser, requireFeature("loot"), async (c) => {
  const body = await parse(c, LootRequestSchema);
  if (body instanceof Response) return body;
  try {
    const chests = predictStructureLoot(body.version, BigInt(body.seed), body.structure, body.x, body.z, {
      allowUnverified: c.env.LOOT_ALLOW_UNVERIFIED === "1",
    });
    return c.json<LootResponse>({ chests });
  } catch (err) {
    if (err instanceof LootUnavailableError) return c.json<LootResponse>({ unavailable: err.message });
    throw err;
  }
});

// ---------- pro: saved seeds ----------
app.get("/saved", requireUser, requireFeature("saved"), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, seed, version, label, notes, created_at AS createdAt FROM saved_seeds WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(c.get("user").id)
    .all<SavedSeed>();
  return c.json(results);
});

app.post("/saved", requireUser, requireFeature("saved"), async (c) => {
  const body = await parse(c, SaveSeedSchema);
  if (body instanceof Response) return body;
  const user = c.get("user");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM saved_seeds WHERE user_id = ?").bind(user.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= LIMITS.pro.savedSeeds) return c.json({ error: "saved seed limit reached" }, 409);
  await c.env.DB.prepare(
    `INSERT INTO saved_seeds (id, user_id, seed, version, label, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, seed, version) DO UPDATE SET label = excluded.label, notes = excluded.notes`,
  )
    .bind(newId(), user.id, body.seed, body.version, body.label ?? null, body.notes ?? null, now())
    .run();
  return c.json({ ok: true });
});

app.delete("/saved/:id", requireUser, requireFeature("saved"), async (c) => {
  await c.env.DB.prepare("DELETE FROM saved_seeds WHERE id = ? AND user_id = ?").bind(c.req.param("id") ?? "", c.get("user").id).run();
  return c.json({ ok: true });
});

// ---------- pro: search ----------
app.post("/search", requireUser, requireFeature("search"), async (c) => {
  const body = await parse(c, SearchRequestSchema);
  if (body instanceof Response) return body;
  try {
    return c.json({ id: await createJob(c.env, c.get("user").id, body) }, 202);
  } catch (err) {
    if (err instanceof SearchLimitError) return c.json({ error: err.message }, 429);
    throw err;
  }
});

app.get("/search/:id", requireUser, async (c) => {
  const job = await getJob(c.env, c.get("user").id, c.req.param("id") ?? "");
  return job ? c.json(job) : c.json({ error: "not found" }, 404);
});

app.post("/search/:id/cancel", requireUser, async (c) => {
  await cancelJob(c.env, c.get("user").id, c.req.param("id") ?? "");
  return c.json({ ok: true });
});

// ---------- pro: export ----------
app.get("/export", requireUser, requireFeature("export"), async (c) => {
  const { seed, version, format = "json" } = c.req.query();
  const radius = Math.min(Math.max(Number(c.req.query("radius") ?? 2000) || 2000, 100), 5000);
  if (!seed || !/^-?\d{1,20}$/.test(seed) || !isVersion(version)) return c.json({ error: "seed and version required" }, 400);
  const data = buildExport(await getEngine(), BigInt(seed), version, radius);
  const name = `seed-${seed}-${version}`;
  if (format === "csv") {
    return c.body(toCsv(data.structures), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
    });
  }
  return c.body(JSON.stringify(data, null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="${name}.json"`,
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<SearchMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        await runBatch(env, msg.body.jobId);
        msg.ack();
      } catch (err) {
        console.error("search batch failed", msg.body.jobId, err);
        if (msg.attempts >= 3) {
          await failJob(env, msg.body.jobId, String(err));
          msg.ack();
        } else msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, SearchMessage>;
