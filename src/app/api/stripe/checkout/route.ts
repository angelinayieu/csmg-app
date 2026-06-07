import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, getPackById } from "@/lib/stripe";
import { safeJsonParse } from "@/lib/api-helpers";

export async function POST(request: Request) {
  const s = getStripe();
  if (!s) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local" },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const { packId } = body;
  const pack = getPackById(packId);

  if (!pack) {
    return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
  }

  // Reuse the Stripe customer if we already have one so packs + subscriptions
  // share a single customer record (one payment history, one portal session).
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
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${pack.name} — ${pack.credits} Credits`,
            description: `${pack.credits} analysis credits for akiboe`,
          },
          unit_amount: pack.price,
        },
        quantity: 1,
      },
    ],
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : { customer_email: user.email ?? undefined, customer_creation: "always" as const }),
    metadata: {
      userId: user.id,
      packId: pack.id,
      credits: String(pack.credits),
    },
    success_url: `${origin}/app/credits/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/credits/cancel`,
  });

  return NextResponse.json({ url: session.url });
}
