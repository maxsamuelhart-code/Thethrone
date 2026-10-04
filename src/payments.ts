import Stripe from "stripe";
import type { Env } from "./env";
import type { Entry } from "./validate";
import { crown, type CrownOutcome } from "./db";

export const PRICE_PENCE = 200;

const stripeClient = (env: Env) =>
  new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

export async function createCheckout(env: Env, entry: Entry): Promise<string> {
  const stripe = stripeClient(env);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: entry.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: PRICE_PENCE,
          product_data: { name: "Take the throne", description: `Crown "${entry.name}" on The Throne` },
        },
      },
    ],
    // The moderated text travels with the session, so the webhook crowns exactly what was approved.
    metadata: { name: entry.name, message: entry.message, email: entry.email },
    success_url: `${env.SITE_URL}/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL}/?cancelled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

const cryptoProvider = Stripe.createSubtleCryptoProvider();

export type WebhookResult =
  | { ok: false; status: number; error: string }
  | { ok: true; outcome: CrownOutcome | null };

/** Verifies the Stripe signature, then crowns the payer if the event is a confirmed payment. */
export async function handleStripeWebhook(env: Env, request: Request): Promise<WebhookResult> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return { ok: false, status: 400, error: "missing signature" };

  const payload = await request.text(); // must be the raw body for signature verification
  let event: Stripe.Event;
  try {
    event = await stripeClient(env).webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.warn("bad stripe signature", err);
    return { ok: false, status: 400, error: "invalid signature" };
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return { ok: true, outcome: null };
  }

  const session = event.data.object;
  if (session.payment_status !== "paid") return { ok: true, outcome: null }; // async methods confirm later
  if (session.amount_total !== PRICE_PENCE || session.currency !== "gbp") {
    console.error("unexpected amount on session", session.id, session.amount_total, session.currency);
    return { ok: true, outcome: null };
  }

  const { name, message, email } = session.metadata ?? {};
  if (!name || message === undefined || !email) {
    console.error("session missing metadata", session.id);
    return { ok: true, outcome: null };
  }

  // event.created is when Stripe recorded the payment, so it defines payment order
  // even if webhooks arrive out of order or are retried.
  const outcome = await crown(env, {
    name,
    message,
    email,
    paidAt: event.created * 1000,
    sessionId: session.id,
  });
  return { ok: true, outcome };
}
