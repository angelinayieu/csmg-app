// ── POST /api/stripe/billing-portal ──
//
// Returns a Stripe Customer Portal URL so the user can manage their
// subscription (swap plan, update card, cancel, download invoices) without
// us reimplementing any of that UI. The portal is configured in the Stripe
// Dashboard → Settings → Billing → Customer Portal.
//
// Requires profiles.stripe_customer_id to be set — populated by the
// /subscribe + /checkout routes on first successful session and by the
// webhook on `checkout.session.completed`. If we have no customer id yet
// the route returns a clear 409 the UI can surface ("no subscription yet").

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: Request) {
  const s = getStripe();
  if (!s) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: prof } = await db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = prof?.stripe_customer_id as string | null;
  if (!customerId) {
    return NextResponse.json(
      { error: "No billing history yet. Subscribe or buy credits first." },
      { status: 409 },
    );
  }

  const origin = request.headers.get("origin") ?? "http://localhost:3000";

  const portal = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/app/credits`,
  });

  return NextResponse.json({ url: portal.url });
}
