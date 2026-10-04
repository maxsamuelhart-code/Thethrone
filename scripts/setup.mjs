#!/usr/bin/env node
// One-command deploy for The Throne. Safe to re-run.
//
// Does: create the D1 database, run migrations, deploy the Worker, upload all secrets,
// register the Stripe webhook (and store its signing secret), then smoke-test the live site.
//
// Usage:
//   npx wrangler login              # once
//   cp prod.vars.example prod.vars  # fill it in (git-ignored)
//   npm run setup
//
// Every value can also come from an environment variable of the same name.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG = "wrangler.jsonc";
const DB_NAME = "throne-db";
const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";
const WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];

const log = (msg) => console.log(`\n\x1b[1;33m👑 ${msg}\x1b[0m`);
const fail = (msg) => {
  console.error(`\n\x1b[1;31m✘ ${msg}\x1b[0m`);
  process.exit(1);
};

// ---- Inputs ---------------------------------------------------------------------------------

function loadVarsFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const fileVars = loadVarsFile("prod.vars");
const input = (name) => process.env[name] || fileVars[name] || "";

const cfg = {
  ANTHROPIC_API_KEY: input("ANTHROPIC_API_KEY"),
  STRIPE_SECRET_KEY: input("STRIPE_SECRET_KEY"),
  RESEND_API_KEY: input("RESEND_API_KEY"),
  ADMIN_PASSWORD: input("ADMIN_PASSWORD"),
  CONTACT_EMAIL: input("CONTACT_EMAIL"),
  EMAIL_FROM: input("EMAIL_FROM"),
  SITE_URL: input("SITE_URL").replace(/\/+$/, ""), // optional: custom domain; defaults to workers.dev URL
};

const missing = ["ANTHROPIC_API_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "CONTACT_EMAIL", "EMAIL_FROM"].filter(
  (k) => !cfg[k],
);
if (missing.length) fail(`Missing ${missing.join(", ")}. Fill them in prod.vars (see prod.vars.example).`);
if (!/^sk_(test|live)_/.test(cfg.STRIPE_SECRET_KEY)) fail("STRIPE_SECRET_KEY should start with sk_test_ or sk_live_.");
if (!cfg.ANTHROPIC_API_KEY.startsWith("sk-ant-")) fail("ANTHROPIC_API_KEY should start with sk-ant-.");
if (!cfg.RESEND_API_KEY.startsWith("re_")) fail("RESEND_API_KEY should start with re_.");

let generatedPassword = false;
if (!cfg.ADMIN_PASSWORD) {
  cfg.ADMIN_PASSWORD = randomBytes(18).toString("base64url");
  generatedPassword = true;
}

// ---- Helpers --------------------------------------------------------------------------------

function wrangler(args, { capture = false } = {}) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    return execFileSync(npx, ["wrangler", ...args], {
      encoding: "utf8",
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
      shell: process.platform === "win32",
    });
  } catch {
    fail(`wrangler ${args.join(" ")} failed (see output above).`);
  }
}

/** Runs wrangler with output shown live (so any prompt is visible) while also capturing it. */
function wranglerTee(args) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return new Promise((resolve) => {
    const child = spawn(npx, ["wrangler", ...args], {
      stdio: ["inherit", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.on("close", (code) => (code === 0 ? resolve(out) : fail(`wrangler ${args.join(" ")} failed (see output above).`)));
  });
}

function patchConfig(replacements) {
  let text = readFileSync(CONFIG, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
    if (!re.test(text)) fail(`Couldn't find "${key}" in ${CONFIG}.`);
    text = text.replace(re, `$1${JSON.stringify(value)}`);
  }
  writeFileSync(CONFIG, text);
}

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) fail(`Stripe ${method} ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

// ---- Steps ----------------------------------------------------------------------------------

log("Checking Cloudflare login");
wrangler(["whoami"]);

log(`Finding or creating D1 database "${DB_NAME}"`);
const findDb = () => JSON.parse(wrangler(["d1", "list", "--json"], { capture: true })).find((d) => d.name === DB_NAME);
let db = findDb();
if (!db) {
  wrangler(["d1", "create", DB_NAME]);
  db = findDb();
}
if (!db?.uuid) fail("Couldn't determine the D1 database id.");
patchConfig({ database_id: db.uuid, CONTACT_EMAIL: cfg.CONTACT_EMAIL, EMAIL_FROM: cfg.EMAIL_FROM });
console.log(`Database id ${db.uuid} written to ${CONFIG}`);

log("Applying database migrations");
wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]);

log("Deploying the Worker");
if (cfg.SITE_URL) patchConfig({ SITE_URL: cfg.SITE_URL });
const deployOut = await wranglerTee(["deploy"]);
const workersUrl = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
const configuredUrl = readFileSync(CONFIG, "utf8").match(/"SITE_URL"\s*:\s*"([^"]*)"/)?.[1];
if (!cfg.SITE_URL && configuredUrl === workersUrl) {
  cfg.SITE_URL = workersUrl; // already deployed with the right URL (re-run)
} else if (!cfg.SITE_URL) {
  if (!workersUrl) fail("Couldn't find the workers.dev URL in the deploy output. Set SITE_URL in prod.vars and re-run.");
  cfg.SITE_URL = workersUrl;
  patchConfig({ SITE_URL: cfg.SITE_URL });
  log(`Redeploying with SITE_URL=${cfg.SITE_URL}`);
  wrangler(["deploy"]);
}

log("Registering the Stripe webhook");
const webhookUrl = `${cfg.SITE_URL}/api/stripe-webhook`;
const existing = await stripe("GET", "webhook_endpoints?limit=100");
for (const ep of existing.data.filter((e) => e.url === webhookUrl)) {
  // A signing secret can only be read at creation, so replace any endpoint we made before.
  await stripe("DELETE", `webhook_endpoints/${ep.id}`);
  console.log(`Replaced previous endpoint ${ep.id}`);
}
const form = [["url", webhookUrl], ["description", "The Throne"], ...WEBHOOK_EVENTS.map((e) => ["enabled_events[]", e])];
const endpoint = await stripe("POST", "webhook_endpoints", form);
console.log(`Webhook ${endpoint.id} → ${webhookUrl} (${cfg.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "LIVE" : "test"} mode)`);

log("Uploading secrets");
const dir = mkdtempSync(join(tmpdir(), "throne-"));
const secretsFile = join(dir, "secrets.json");
try {
  writeFileSync(
    secretsFile,
    JSON.stringify({
      ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
      STRIPE_SECRET_KEY: cfg.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: endpoint.secret,
      RESEND_API_KEY: cfg.RESEND_API_KEY,
      ADMIN_PASSWORD: cfg.ADMIN_PASSWORD,
    }),
    { mode: 0o600 },
  );
  wrangler(["secret", "bulk", secretsFile]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

log("Smoke-testing the live site");
await new Promise((r) => setTimeout(r, 3000));
const checks = [
  ["/", 200],
  ["/api/state", 200],
  ["/terms", 200],
  ["/admin", 401],
];
let allOk = true;
for (const [path, want] of checks) {
  const res = await fetch(cfg.SITE_URL + path).catch(() => null);
  const ok = res?.status === want;
  allOk &&= ok;
  console.log(`${ok ? "✔" : "✘"} ${path} → ${res?.status ?? "no response"} (expected ${want})`);
}

log(allOk ? "The Throne is live!" : "Deployed, but some checks failed. Run `npx wrangler tail` to see logs.");
console.log(`
  Site:   ${cfg.SITE_URL}
  Admin:  ${cfg.SITE_URL}/admin
${generatedPassword ? `  Admin password (generated, shown once; save it now): ${cfg.ADMIN_PASSWORD}\n` : ""}
  Next: pay with test card 4242 4242 4242 4242 and check that the dethroned email arrives.
`);
