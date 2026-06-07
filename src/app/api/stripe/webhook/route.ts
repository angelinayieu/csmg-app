import { NextResponse } from "next/server";
import { getStripe, planForPriceId, FREE_WEEKLY_ROUNDS } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { addCredits, setUserPlan } from "@/lib/credits";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const s = getStripe();
  if (!s) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = s.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Stripe Webhook] Signature verification failed:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const credits = parseInt(session.metadata?.credits ?? "0", 10);
    const packId = session.metadata?.packId ?? "unknown";

    if (!userId) {
      console.error("[Stripe Webhook] Missing userId metadata:", session.metadata);
      return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Persist the Stripe customer id on the profile so the billing portal +
    // future subscriptions reuse the same customer. Works for BOTH one-time
    // pack checkouts (mode=payment) and subscription checkouts (mode=subscription).
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    if (customerId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId)
        .then(() => {}, (err: unknown) => {
          console.warn("[Stripe Webhook] Failed to persist stripe_customer_id:", err);
        });
    }

    // Credit grant only fires when this session bought a credit pack — the
    // subscription path has credits === 0 and is handled by the subscription
    // lifecycle events below.
    if (credits > 0) {
      try {
        const newBalance = await addCredits(supabase, userId, credits, `purchase_${packId}`);
        console.info(`[Stripe Webhook] Added ${credits} credits to user ${userId}. New balance: ${newBalance}`);
      } catch (err) {
        console.error("[Stripe Webhook] Failed to add credits:", err);
        return NextResponse.json({ error: "Failed to add credits" }, { status: 500 });
      }
    }
  }

  // ── Subscription lifecycle → plan + weekly allowance (Phase 3) ──
  // Requires: (1) recurring prices created in Stripe, their ids set in
  // STRIPE_PRICE_STANDARD / STRIPE_PRICE_PRO; (2) the subscription carrying
  // metadata.userId (set it when you create the subscription checkout).
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.userId;
    const priceId = sub.items?.data?.[0]?.price?.id;
    const resolved = planForPriceId(priceId);
    const active = sub.status === "active" || sub.status === "trialing";

    if (userId && resolved && active) {
      try {
        const supabase = createServiceClient();
        await setUserPlan(supabase, userId, resolved.plan, resolved.weekly);
        // Stamp the subscription + customer ids so the portal route can find
        // them and the credits page can show "Manage subscription".
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("profiles")
          .update({
            stripe_subscription_id: sub.id,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
          })
          .eq("id", userId)
          .then(() => {}, (err: unknown) => {
            console.warn("[Stripe Webhook] Failed to persist subscription id:", err);
          });
        console.info(
          `[Stripe Webhook] Set ${userId} → plan ${resolved.plan} (${resolved.weekly} rounds/wk)`,
        );
      } catch (err) {
        console.error("[Stripe Webhook] Failed to set plan:", err);
        return NextResponse.json({ error: "Failed to set plan" }, { status: 500 });
      }
    }
  }

  // Cancellation / lapse → downgrade to free.
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.userId;
    if (userId) {
      try {
        const supabase = createServiceClient();
        await setUserPlan(supabase, userId, "free", FREE_WEEKLY_ROUNDS);
        // Clear the subscription id but keep the customer id so the portal
        // still resolves (lets ex-subscribers download invoices, resubscribe).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("profiles")
          .update({ stripe_subscription_id: null })
          .eq("id", userId)
          .then(() => {}, () => {});
        console.info(`[Stripe Webhook] Downgraded ${userId} → free`);
      } catch (err) {
        console.error("[Stripe Webhook] Failed to downgrade plan:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
