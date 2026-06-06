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

// Volume tiers — per-credit price drops as the bundle grows. Pack ids stay
// stable: pack_10/30/100 are referenced by the in-app credits dashboard,
// strategy-lab, and intake-bootstrap surfaces; the new tiers extend the
// ladder so the pricing page can offer a richer pick without forking ids.
export const CREDIT_PACKS = [
  {
    id: "pack_10",
    name: "10 credits",
    credits: 10,
    price: 500, // cents — $0.50/credit
    priceLabel: "$5",
    popular: false,
  },
  {
    id: "pack_25",
    name: "25 credits",
    credits: 25,
    price: 1125, // $0.45/credit (10% off)
    priceLabel: "$11.25",
    popular: false,
  },
  {
    id: "pack_30",
    name: "30 credits",
    credits: 30,
    price: 1200, // $0.40/credit
    priceLabel: "$12",
    popular: false,
  },
  {
    id: "pack_50",
    name: "50 credits",
    credits: 50,
    price: 2000, // $0.40/credit (20% off)
    priceLabel: "$20",
    popular: false,
  },
  {
    id: "pack_100",
    name: "100 credits",
    credits: 100,
    price: 3500, // $0.35/credit (30% off)
    priceLabel: "$35",
    popular: true,
  },
  {
    id: "pack_250",
    name: "250 credits",
    credits: 250,
    price: 7500, // $0.30/credit (40% off)
    priceLabel: "$75",
    popular: false,
  },
  {
    id: "pack_500",
    name: "500 credits",
    credits: 500,
    price: 12500, // $0.25/credit (50% off)
    priceLabel: "$125",
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
