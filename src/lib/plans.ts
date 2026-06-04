// ── Subscription plans ──────────────────────────────────────────────
// Monthly billing, weekly usage limits. Single source of truth for the
// pricing page and (future) recurring checkout. Mirrors CREDIT_PACKS in
// stripe.ts so plans + one-time top-up packs read from one place.
//
// Unit: a "round" = one diverge → converge loop on the canvas.
// 1 round = 1 credit (top-up packs are denominated in credits). Heavier
// moves draw more — see ROUND_COSTS. Weekly rounds refill every 7 days
// and do NOT roll over; purchased credits never expire.

export type PlanId = "free" | "standard" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number; // monthly, in cents (0 = free)
  priceLabel: string;
  period: string; // "free forever" | "/ month"
  weeklyRounds: number; // refills every 7 days, no rollover
  boardsPerWeek: string; // ≈ board explorations that buys
  tagline: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceCents: 0,
    priceLabel: "$0",
    period: "free forever",
    weeklyRounds: 10,
    boardsPerWeek: "≈ 1 board / week",
    tagline: "Think out loud and see where it goes.",
    features: [
      "Diverge, converge & decompose",
      "Image & voice capture",
      "1 active board",
      "Refills every Monday",
    ],
    cta: "Start free",
  },
  {
    id: "standard",
    name: "Standard",
    priceCents: 2400,
    priceLabel: "$24",
    period: "/ month",
    weeklyRounds: 50,
    boardsPerWeek: "≈ 3–5 boards / week",
    tagline: "A steady pace for daily thinking.",
    features: [
      "Everything in Free",
      "Web-search grounding",
      "Make-technical specs",
      "Unlimited boards",
      "Top up any time",
    ],
    cta: "Choose Standard",
    popular: true,
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 5900,
    priceLabel: "$59",
    period: "/ month",
    weeklyRounds: 150,
    boardsPerWeek: "all-day exploration",
    tagline: "Heavy lifting, all day, no thinking about it.",
    features: [
      "Everything in Standard",
      "Deep synthesize + web research",
      "Priority generation",
      "Early access to new tools",
    ],
    cta: "Choose Pro",
  },
];

export interface RoundCost {
  label: string;
  cost: string;
}

// What a single AI move costs, in rounds. Keeps the pricing page honest
// about the heavier ops without introducing a second unit.
export const ROUND_COSTS: RoundCost[] = [
  { label: "Diverge → converge", cost: "1 round" },
  { label: "Decompose · plan · questions", cost: "1 round" },
  { label: "Web-search grounding", cost: "+1 round" },
  { label: "Make technical", cost: "2 rounds" },
  { label: "Deep synthesize", cost: "3 rounds" },
];

export function getPlan(id: PlanId): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

// ── One-time top-up packs ───────────────────────────────────────────
// Client-safe display data for the credit packs. The canonical,
// server-validated source is CREDIT_PACKS in stripe.ts (which imports
// the Stripe SDK and so cannot be pulled into client bundles) — the ids
// here MUST stay in sync with it. Shared by the pricing page, the
// /app/credits page, and the in-app BuyCreditsModal so pack data lives
// in exactly one client-importable place.
export interface TopupPack {
  id: string; // matches CREDIT_PACKS in stripe.ts (validated server-side)
  name: string;
  credits: number;
  priceLabel: string;
  perCredit: string;
  popular?: boolean;
}

export const TOPUP_PACKS: TopupPack[] = [
  { id: "pack_10", name: "Starter", credits: 10, priceLabel: "$5", perCredit: "$0.50" },
  { id: "pack_30", name: "Explorer", credits: 30, priceLabel: "$12", perCredit: "$0.40", popular: true },
  { id: "pack_100", name: "Pro", credits: 100, priceLabel: "$35", perCredit: "$0.35" },
];
