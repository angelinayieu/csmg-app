import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { addCredits } from "@/lib/credits";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
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

  return NextResponse.json({ received: true });
}
