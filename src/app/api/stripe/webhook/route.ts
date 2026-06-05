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

    if (!userId || credits <= 0) {
      console.error("[Stripe Webhook] Invalid metadata:", session.metadata);
      return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const supabase = createServiceClient();

    try {
      const newBalance = await addCredits(supabase, userId, credits, `purchase_${packId}`);
      console.info(`[Stripe Webhook] Added ${credits} credits to user ${userId}. New balance: ${newBalance}`);
    } catch (err) {
      console.error("[Stripe Webhook] Failed to add credits:", err);
      return NextResponse.json({ error: "Failed to add credits" }, { status: 500 });
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
        console.info(`[Stripe Webhook] Downgraded ${userId} → free`);
      } catch (err) {
        console.error("[Stripe Webhook] Failed to downgrade plan:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
