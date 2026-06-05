import Stripe from "stripe";
import { getPlan, type PlanId } from "./plans";

/**
 * Stripe client — lazy-initialized so the app doesn't crash at build/startup
 * if STRIPE_SECRET_KEY isn't set yet. Routes that need Stripe should call
 * getStripe() and handle the null case.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_YOUR") || key === "") return null;
  _stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
  return _stripe;
}

/** @deprecated Use getStripe() instead — this throws if key is missing */
export const stripe = null as unknown as Stripe;

export const CREDIT_PACKS = [
  {
    id: "pack_10",
    name: "Starter",
    credits: 10,
    price: 500, // cents
    priceLabel: "$5",
    popular: false,
  },
  {
    id: "pack_30",
    name: "Explorer",
    credits: 30,
    price: 1200,
    priceLabel: "$12",
    popular: true,
  },
  {
    id: "pack_100",
    name: "Pro",
    credits: 100,
    price: 3500,
    priceLabel: "$35",
    popular: false,
  },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

export function getPackById(id: string) {
  return CREDIT_PACKS.find((p) => p.id === id);
}

// ── Subscription plans → Stripe price mapping (Phase 3) ──────────────
// Maps a Stripe recurring price id (from your Stripe dashboard) to a PlanId.
// Set STRIPE_PRICE_STANDARD / STRIPE_PRICE_PRO in env once the products exist.
// The webhook uses planForPriceId() to resolve a subscription event → the plan
// + weekly allowance to seed via setUserPlan().
export const PLAN_PRICE_IDS: Record<string, PlanId> = {
  ...(process.env.STRIPE_PRICE_STANDARD
    ? { [process.env.STRIPE_PRICE_STANDARD]: "standard" as PlanId }
    : {}),
  ...(process.env.STRIPE_PRICE_PRO
    ? { [process.env.STRIPE_PRICE_PRO]: "pro" as PlanId }
    : {}),
};

/** The weekly round quota the free plan grants — the downgrade target when a
 *  subscription is cancelled. */
export const FREE_WEEKLY_ROUNDS = getPlan("free")?.weeklyRounds ?? 10;

/** Resolve a Stripe price id to its plan + weekly allowance, or null if the
 *  price isn't a known plan price (e.g. a one-time pack). */
export function planForPriceId(
  priceId: string | null | undefined,
): { plan: PlanId; weekly: number } | null {
  if (!priceId) return null;
  const plan = PLAN_PRICE_IDS[priceId];
  if (!plan) return null;
  return { plan, weekly: getPlan(plan)?.weeklyRounds ?? 0 };
}
