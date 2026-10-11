/**
 * Stripe subscriptions on the web: Checkout to subscribe, the Customer Portal to
 * manage or cancel, webhooks as the only writer of subscription state.
 */
import Stripe from "stripe";
import type { Env } from "./env";
import type { User } from "./auth";
import { now } from "./util";

const stripeClient = (env: Env) => new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function ensureCustomer(env: Env, stripe: Stripe, user: User): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
  // Another tab may have raced us; keep whichever id landed first.
  await env.DB.prepare("UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?")
    .bind(customer.id, user.id)
    .run();
  const row = await env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").bind(user.id).first<{ stripe_customer_id: string }>();
  return row!.stripe_customer_id;
}

export async function createCheckout(env: Env, user: User, interval: "month" | "year"): Promise<string> {
  const stripe = stripeClient(env);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: await ensureCustomer(env, stripe, user),
    client_reference_id: user.id,
    line_items: [{ price: interval === "year" ? env.STRIPE_PRICE_YEAR : env.STRIPE_PRICE_MONTH, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    success_url: `${env.SITE_URL}/?upgraded=1`,
    cancel_url: `${env.SITE_URL}/?upgrade_cancelled=1`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

export async function createPortal(env: Env, user: User): Promise<string> {
  const stripe = stripeClient(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: await ensureCustomer(env, stripe, user),
    return_url: env.SITE_URL,
  });
  return session.url;
}

async function upsertSubscription(env: Env, sub: Stripe.Subscription, eventTime: number): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user =
    (await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id = ?").bind(customerId).first<{ id: string }>()) ??
    (sub.metadata.user_id
      ? await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(sub.metadata.user_id).first<{ id: string }>()
      : null);
  if (!user) {
    console.error("subscription for unknown customer", sub.id, customerId);
    return;
  }
  const item = sub.items.data[0];
  // Newer API versions moved the billing period onto subscription items.
  const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, status, price_id, current_period_end, cancel_at_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, price_id = excluded.price_id,
       current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= subscriptions.updated_at`,
  )
    .bind(sub.id, user.id, sub.status, item?.price.id ?? null, periodEnd ? periodEnd * 1000 : null, sub.cancel_at_period_end ? 1 : 0, eventTime)
    .run();
}

export async function handleWebhook(env: Env, request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });
  const payload = await request.text(); // raw body required for signature verification
  const stripe = stripeClient(env);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const fresh = await env.DB.prepare("INSERT INTO stripe_events (id, received_at) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .bind(event.id, now())
    .run();
  if (!fresh.meta.changes) return new Response("duplicate", { status: 200 });

  const eventTime = event.created * 1000;
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await upsertSubscription(env, event.data.object, eventTime);
        break;
      case "checkout.session.completed": {
        // Subscription events may arrive first or not at all in edge cases; fetch the current state.
        const s = event.data.object;
        if (s.mode === "subscription" && s.subscription) {
          const id = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
          // Retrieved state is current as of now, not as of the event.
          await upsertSubscription(env, await stripe.subscriptions.retrieve(id), now());
        }
        break;
      }
    }
  } catch (err) {
    // Let Stripe retry: forget the event so the retry isn't treated as a duplicate.
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(event.id).run();
    throw err;
  }
  return new Response("ok", { status: 200 });
}
