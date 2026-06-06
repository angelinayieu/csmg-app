"use client";

// ── Pricing page ──
//
// Lives on the SAME visual base as the landing surface (`/`): cold near-black
// ink, Apple-Vibe font stack, dot-grid background, glass pill nav persistent
// across both pages via <LandingHeader>. Terracotta is kept ONLY as the
// accent (popular badge frame, primary CTA, savings chip) — never as page
// chrome. This makes the front door and the pricing door feel like the same
// product.
//
// Below the plans the page offers a CREDIT PICKER instead of three named
// top-up packs. Bigger bundles get a stepped per-credit discount (read from
// TOPUP_PACKS); the picker shows the live total + savings vs the 10-credit
// baseline. The round-cost legend ("what a round costs") is intentionally
// gone — users care about features and price, not the internal unit math.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { LandingHeader } from "@/components/landing/landing-header";
import { PLANS, TOPUP_PACKS, type PlanId } from "@/lib/plans";

// Match landing's cold near-black ink + a tiny terracotta accent reserved
// for the popular CTA + savings chip — the same role terracotta plays as
// the "asap" underline on the landing headline.
const INK = "#0B0B0C";
const CLAY = "#C2593B";
const CLAY_DEEP = "#A8472E";

// Annual billing = pay for 10 months, get 2 free (≈17% off).
const ANNUAL_MONTHS_CHARGED = 10;
const ANNUAL_SAVE_LABEL = "Save 17%";

// profiles.tier is free|pro|team; plan ids are free|standard|pro.
const TIER_TO_PLAN: Record<string, PlanId> = {
  free: "free",
  pro: "standard",
  team: "pro",
};

// Baseline per-credit price = the 10-credit pack ($0.50). Used to compute
// the savings % shown next to the picker.
const BASELINE_PER_CREDIT = 0.5;

export function PricingClient({
  isLoggedIn,
  currentPlan,
}: {
  isLoggedIn: boolean;
  currentPlan: string | null;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  // Credit picker selection — defaults to the marked-popular tier so the
  // primary CTA reads as the recommended choice.
  const [selectedPack, setSelectedPack] = useState<string>(
    TOPUP_PACKS.find((p) => p.popular)?.id ?? TOPUP_PACKS[0].id,
  );
  const activePlan = currentPlan ? TIER_TO_PLAN[currentPlan] ?? null : null;

  const pack = useMemo(
    () => TOPUP_PACKS.find((p) => p.id === selectedPack) ?? TOPUP_PACKS[0],
    [selectedPack],
  );
  const perCreditNum = parseFloat(pack.perCredit.replace("$", ""));
  const savePct = Math.max(
    0,
    Math.round((1 - perCreditNum / BASELINE_PER_CREDIT) * 100),
  );

  function choosePlan(id: PlanId) {
    if (id === "free") {
      window.location.href = isLoggedIn ? "/app" : "/auth/signup";
      return;
    }
    if (!isLoggedIn) {
      window.location.href = `/auth/signup?plan=${id}&billing=${billing}`;
      return;
    }
    document.getElementById("topup")?.scrollIntoView({ behavior: "smooth" });
  }

  async function buyPack(packId: string) {
    setBuying(packId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBuying(null);
    } catch {
      setBuying(null);
    }
  }

  return (
    <main
      className="relative min-h-screen overflow-hidden"
      style={{
        fontFamily: appleVibe.font.stack,
        color: INK,
        background: "#ffffff",
        // Same whiteboard dot-grid as the landing surface — what ties the
        // two pages together visually.
        backgroundImage:
          "radial-gradient(circle, rgba(15,23,42,0.06) 1.1px, transparent 1.5px)",
        backgroundSize: "26px 26px",
      }}
    >
      {/* Soft white spotlight behind the hero — mirrors the landing's centered
          radial wash so the hero floats off the dot-grid the same way. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
        style={{
          width: 1280,
          height: 720,
          background:
            "radial-gradient(56% 48% at 50% 36%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0) 72%)",
        }}
      />

      <div className="relative">
        <LandingHeader active="Plans" />

        {/* ── Hero ── monochrome, matches the landing voice. */}
        <section className="mx-auto max-w-[720px] px-6 pb-10 pt-10 text-center">
          <h1
            className="text-[clamp(40px,5vw,56px)] font-extrabold leading-[1.02]"
            style={{
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.03em",
            }}
          >
            Pricing
          </h1>
          <p
            className="mx-auto mt-3 text-[15px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            Plans that refill every week.
          </p>
        </section>

        {/* ── Billing toggle ── favor annual (cheat-sheet rule); the savings
            chip wears the terracotta accent (small dose). */}
        <div className="mb-9 flex items-center justify-center gap-3 px-6">
          <div
            className="inline-flex items-center rounded-full p-1"
            style={{ background: "rgba(15,23,42,0.06)" }}
          >
            {(
              [
                ["monthly", "Monthly"],
                ["annual", "Annual"],
              ] as const
            ).map(([key, label]) => {
              const active = billing === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBilling(key)}
                  className="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all"
                  style={
                    active
                      ? {
                          background: "#ffffff",
                          color: INK,
                          boxShadow: appleVibe.shadow.chip,
                        }
                      : {
                          color: appleVibe.text.tertiary,
                          background: "transparent",
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
            style={{ background: "rgba(194,89,59,0.10)", color: CLAY }}
          >
            {ANNUAL_SAVE_LABEL}
          </span>
        </div>

        {/* ── Plans ── */}
        <section className="mx-auto max-w-[1080px] px-6">
          <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
            {PLANS.map((plan, idx) => {
              const popular = !!plan.popular;
              const isCurrent = activePlan === plan.id;
              const paid = plan.priceCents > 0;
              const annualTotal = Math.round(
                (plan.priceCents / 100) * ANNUAL_MONTHS_CHARGED,
              );
              const annualMo = Math.round(annualTotal / 12);
              const showAnnual = billing === "annual" && paid;
              return (
                <div
                  key={plan.id}
                  className="relative flex h-full flex-col rounded-[24px] p-6"
                  style={
                    popular
                      ? {
                          // Subtle terracotta frame on a clean white card —
                          // a tiny dose of brand color, not a whole gradient.
                          border: `2px solid ${CLAY}`,
                          background: "#ffffff",
                          boxShadow:
                            "0 1px 0 rgba(255,255,255,0.9) inset, 0 28px 64px -28px rgba(194,89,59,0.30)",
                        }
                      : {
                          background: "#ffffff",
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                          boxShadow: appleVibe.shadow.card,
                        }
                  }
                >
                  {popular && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.09em] text-white"
                      style={{
                        background: CLAY,
                        boxShadow: "0 8px 20px -10px rgba(194,89,59,0.55)",
                      }}
                    >
                      Most popular
                    </div>
                  )}
                  <div className="mb-5 flex items-center justify-between">
                    <span
                      className="text-[13px] font-bold tabular-nums"
                      style={{
                        color: appleVibe.text.faint,
                        letterSpacing: "0.06em",
                      }}
                    >
                      0{idx + 1}
                    </span>
                    {isCurrent && (
                      <span
                        className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={{
                          background: "rgba(15,23,42,0.06)",
                          color: appleVibe.text.secondary,
                        }}
                      >
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-[18px] font-bold tracking-tight">
                    {plan.name}
                  </div>
                  <div
                    className="mt-1 min-h-[34px] text-[12.5px] font-medium leading-snug"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {plan.tagline}
                  </div>

                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span
                      className="text-[40px] font-extrabold tracking-tight"
                      style={{ letterSpacing: "-0.03em" }}
                    >
                      {showAnnual ? `$${annualMo}` : plan.priceLabel}
                    </span>
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: appleVibe.text.faint }}
                    >
                      {paid ? (showAnnual ? "/ mo" : "/ month") : plan.period}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-[16px] text-[12px] font-semibold"
                    style={{ color: CLAY }}
                  >
                    {showAnnual ? `billed annually · $${annualTotal}/yr` : ""}
                  </div>

                  <div
                    className="my-5 h-px w-full"
                    style={{ background: appleVibe.stroke.hairline }}
                  />

                  <ul className="flex flex-1 flex-col gap-2.5">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2.5 text-[13px] font-medium"
                      >
                        <span
                          className="mt-[1px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: "rgba(15,23,42,0.06)" }}
                        >
                          <Check
                            className="h-[11px] w-[11px]"
                            strokeWidth={3}
                            style={{ color: INK }}
                          />
                        </span>
                        <span style={{ color: appleVibe.text.secondary }}>
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => choosePlan(plan.id)}
                    disabled={isCurrent}
                    className="mt-6 w-full rounded-full py-2.5 text-[14px] font-bold transition-all hover:opacity-95 active:scale-[0.99] disabled:cursor-default disabled:opacity-100"
                    style={
                      isCurrent
                        ? {
                            background: "rgba(15,23,42,0.05)",
                            color: appleVibe.text.tertiary,
                          }
                        : popular
                          ? {
                              background: CLAY,
                              color: "white",
                              boxShadow:
                                "0 10px 24px -10px rgba(194,89,59,0.55)",
                            }
                          : {
                              background: INK,
                              color: "white",
                              boxShadow:
                                "0 10px 24px -10px rgba(11,18,40,0.45)",
                            }
                    }
                  >
                    {isCurrent ? "Your plan" : plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Credit picker (the new top-up surface) ──
            Replaces the three named packs + round-cost legend. Pick any
            tier; the per-credit price drops with size and the savings vs.
            the 10-credit baseline reads inline so the value is obvious. */}
        <section id="topup" className="mx-auto max-w-[820px] px-6 pb-24 pt-20">
          <div className="mx-auto mb-7 max-w-[520px] text-center">
            <h2
              className="text-[28px] font-extrabold tracking-tight"
              style={{
                letterSpacing: "-0.025em",
                fontFamily: appleVibe.font.display,
              }}
            >
              More credits
            </h2>
            <p
              className="mx-auto mt-2.5 max-w-[460px] text-[14px] font-medium leading-relaxed"
              style={{ color: appleVibe.text.tertiary }}
            >
              Pick a bundle. The bigger the bundle, the less you pay per credit.
              Credits never expire.
            </p>
          </div>

          {/* Chip picker — six tiers laid out as pill buttons. Selected tier
              gets the terracotta border + soft glow; the others stay calm
              hairlines. Mobile-friendly: wraps to two rows on narrow screens. */}
          <div className="flex flex-wrap justify-center gap-2.5">
            {TOPUP_PACKS.map((p) => {
              const active = p.id === selectedPack;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPack(p.id)}
                  className="rounded-full px-4 py-2 text-[13.5px] font-semibold transition-all active:scale-[0.98]"
                  style={
                    active
                      ? {
                          background: "#ffffff",
                          color: INK,
                          border: `2px solid ${CLAY}`,
                          boxShadow:
                            "0 1px 0 rgba(255,255,255,0.9) inset, 0 14px 28px -14px rgba(194,89,59,0.40)",
                        }
                      : {
                          background: "#ffffff",
                          color: appleVibe.text.secondary,
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                          boxShadow: appleVibe.shadow.chip,
                        }
                  }
                >
                  {p.credits} credits
                </button>
              );
            })}
          </div>

          {/* Live readout for the selected tier — total price, per-credit,
              savings chip. The number is the lede; everything else recedes. */}
          <div
            className="mx-auto mt-8 flex max-w-[520px] flex-col items-center rounded-[24px] p-7 text-center"
            style={{
              background: "#ffffff",
              border: `1px solid ${appleVibe.stroke.hairline}`,
              boxShadow: appleVibe.shadow.card,
            }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="text-[48px] font-extrabold tracking-tight"
                style={{ letterSpacing: "-0.03em" }}
              >
                {pack.priceLabel}
              </span>
              <span
                className="text-[14px] font-medium"
                style={{ color: appleVibe.text.faint }}
              >
                for {pack.credits} credits
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="text-[12.5px] font-semibold"
                style={{ color: appleVibe.text.tertiary }}
              >
                {pack.perCredit} per credit
              </span>
              {savePct > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{
                    background: "rgba(194,89,59,0.10)",
                    color: CLAY,
                  }}
                >
                  Save {savePct}%
                </span>
              )}
            </div>

            <button
              onClick={() => buyPack(pack.id)}
              disabled={buying !== null}
              className="mt-6 w-full max-w-[280px] rounded-full py-3 text-[14px] font-bold transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
              style={{
                background: CLAY,
                color: "white",
                boxShadow: "0 12px 28px -12px rgba(194,89,59,0.55)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = CLAY_DEEP;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = CLAY;
              }}
            >
              {buying === pack.id
                ? "Redirecting…"
                : `Buy ${pack.credits} credits`}
            </button>
          </div>

          <p
            className="mt-10 text-center text-[12px] font-medium"
            style={{ color: appleVibe.text.faint }}
          >
            Prices in USD. Cancel anytime.{" "}
            <Link href={isLoggedIn ? "/app" : "/auth/login"} className="underline">
              Open the app
            </Link>{" "}
            for questions.
          </p>
        </section>
      </div>
    </main>
  );
}
