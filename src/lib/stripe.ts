import Stripe from "stripe";

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
