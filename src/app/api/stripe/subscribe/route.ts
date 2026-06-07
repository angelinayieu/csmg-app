// ── POST /api/stripe/subscribe ──
//
// Creates a Stripe Checkout Session in `subscription` mode for a monthly
// plan. Mirrors /api/stripe/checkout (which handles one-time credit packs)
// but routes price ids through the env-configured plan map so the webhook
// can resolve the resulting subscription event → PlanId via planForPriceId().
//
// Contract:
//   POST body: { planId: "standard" | "pro" }
//   Response:  { url: string } — Stripe-hosted checkout URL to redirect to
//
// Side effects on success: subscription.metadata.userId is set so the
// customer.subscription.created webhook can call setUserPlan(). The
// returned customer.id is persisted to profiles.stripe_customer_id (here +
// on the checkout route + on the webhook) so the billing-portal route can
// resolve user → Stripe customer without re-querying Stripe.

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPlan, type PlanId } from "@/lib/plans";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 15;

// Price ids live in env (created in the Stripe dashboard as recurring
// prices). Resolved lazily because the env can be set after build.
function priceIdFor(planId: PlanId): string | null {
  if (planId === "standard") return process.env.STRIPE_PRICE_STANDARD ?? null;
  if (planId === "pro") return process.env.STRIPE_PRICE_PRO ?? null;
  return null;
}

export async function POST(request: Request) {
  const s = getStripe();
  if (!s) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in env." },
      { status: 503 },
    );
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const planId = body?.planId as PlanId | undefined;
  if (!planId || planId === "free") {
    return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
  }
  const plan = getPlan(planId);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = priceIdFor(planId);
  if (!priceId) {
    // Surface a clear "you forgot to configure Stripe prices" error to the UI
    // rather than silently failing the redirect — easiest dev mistake to hit.
    return NextResponse.json(
      {
        error: `STRIPE_PRICE_${planId.toUpperCase()} is not set. Create a recurring price in Stripe and add the id to env.`,
      },
      { status: 503 },
    );
  }

  // Reuse the Stripe customer if we already have one for this auth user —
  // keeps billing history, payment methods, and the portal session unified.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: prof } = await db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const existingCustomerId = prof?.stripe_customer_id as string | null;

  const origin = request.headers.get("origin") ?? "http://localhost:3000";

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    // Either pass customer (reuse) or customer_email (Stripe creates one and
    // we'll persist it on webhook). Don't pass both — Stripe errors.
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : { customer_email: user.email ?? undefined }),
    // Critical: the webhook reads sub.metadata.userId to call setUserPlan().
    // subscription_data.metadata propagates to the Subscription object.
    subscription_data: {
      metadata: { userId: user.id, planId },
    },
    metadata: { userId: user.id, planId },
    success_url: `${origin}/app/credits?subscribed=1`,
    cancel_url: `${origin}/pricing?canceled=1`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
