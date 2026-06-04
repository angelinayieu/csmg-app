"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { appleVibe as av } from "@/lib/apple-vibe-tokens";
import { PLANS, ROUND_COSTS, TOPUP_PACKS, type PlanId } from "@/lib/plans";

const ACCENT = "#0A84FF";

// profiles.tier is free|pro|team; plan ids are free|standard|pro. Light
// mapping so "Current plan" highlights sensibly until recurring billing
// is wired and the tier values are reconciled.
const TIER_TO_PLAN: Record<string, PlanId> = {
  free: "free",
  pro: "standard",
  team: "pro",
};

export function PricingClient({
  isLoggedIn,
  currentPlan,
}: {
  isLoggedIn: boolean;
  currentPlan: string | null;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  const activePlan = currentPlan ? TIER_TO_PLAN[currentPlan] ?? null : null;

  function choosePlan(id: PlanId) {
    if (id === "free") {
      window.location.href = isLoggedIn ? "/app" : "/auth/signup";
      return;
    }
    if (!isLoggedIn) {
      window.location.href = `/auth/signup?plan=${id}`;
      return;
    }
    // Recurring checkout isn't wired yet — send signed-in users to the
    // working top-up packs so the page never dead-ends or fakes a charge.
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
      className="min-h-screen"
      style={{
        fontFamily: av.font.stack,
        background:
          "linear-gradient(180deg,#F5F5F7 0%,#FAFAFB 48%,#F5F5F7 100%)",
        color: av.text.primary,
      }}
    >
      {/* Header */}
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <InterAxisLogo className="h-8 w-8" size={32} style={{ borderRadius: 10 }} />
          <span className="text-[16px] font-semibold tracking-tight">Intersice</span>
        </Link>
        <Link
          href={isLoggedIn ? "/app" : "/auth/login"}
          className="text-[13px] font-medium transition-opacity hover:opacity-70"
          style={{ color: av.text.secondary }}
        >
          {isLoggedIn ? "Open app" : "Sign in"}
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[760px] px-6 pb-12 pt-8 text-center">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: av.text.faint }}
        >
          Pricing
        </div>
        <h1
          className="mx-auto mt-3 max-w-[520px] text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[46px]"
          style={{ fontFamily: av.font.display, letterSpacing: "-0.025em" }}
        >
          Plans that refill every week.
        </h1>
        <p
          className="mx-auto mt-4 max-w-[460px] text-[15px] leading-relaxed"
          style={{ color: av.text.secondary }}
        >
          One round is a single diverge&nbsp;→&nbsp;converge loop. Pick a weekly
          pace — and top up whenever you want more.
        </p>
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-[1080px] px-6">
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
          {PLANS.map((plan) => {
            const popular = !!plan.popular;
            const isCurrent = activePlan === plan.id;
            return (
              <div
                key={plan.id}
                className="relative flex h-full flex-col rounded-[24px] p-6"
                style={{
                  background: av.surface.card,
                  border: popular
                    ? "1px solid rgba(10,132,255,0.22)"
                    : `1px solid ${av.stroke.soft}`,
                  boxShadow: popular
                    ? "0 1px 0 rgba(255,255,255,0.9) inset, 0 0 0 1.5px rgba(10,132,255,0.45), 0 28px 64px -28px rgba(10,132,255,0.38)"
                    : av.shadow.card,
                }}
              >
                {popular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white"
                    style={{
                      background: ACCENT,
                      boxShadow: "0 8px 20px -8px rgba(10,132,255,0.6)",
                    }}
                  >
                    Most popular
                  </div>
                )}
                {isCurrent && (
                  <div
                    className="absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
                    style={{ background: av.surface.chip, color: av.text.tertiary }}
                  >
                    Current
                  </div>
                )}

                <div className="text-[17px] font-semibold">{plan.name}</div>
                <div
                  className="mt-1 min-h-[34px] text-[12.5px] leading-snug"
                  style={{ color: av.text.tertiary }}
                >
                  {plan.tagline}
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span
                    className="text-[34px] font-semibold tracking-tight"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {plan.priceLabel}
                  </span>
                  <span className="text-[13px]" style={{ color: av.text.faint }}>
                    {plan.period}
                  </span>
                </div>

                <div className="mt-3 text-[14px]">
                  <span className="font-semibold">{plan.weeklyRounds}</span>{" "}
                  <span style={{ color: av.text.tertiary }}>rounds / week</span>
                </div>
                <div className="mt-0.5 text-[12px]" style={{ color: av.text.faint }}>
                  {plan.boardsPerWeek}
                </div>

                <div
                  className="my-5 h-px w-full"
                  style={{ background: av.stroke.hairline }}
                />

                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px]">
                      <Check
                        className="mt-[1px] h-4 w-4 flex-shrink-0"
                        style={{ color: av.text.tertiary }}
                      />
                      <span style={{ color: av.text.secondary }}>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => choosePlan(plan.id)}
                  disabled={isCurrent}
                  className="mt-6 w-full rounded-full py-2.5 text-[14px] font-semibold transition-all hover:opacity-90 active:scale-[0.99] disabled:cursor-default disabled:opacity-100"
                  style={
                    isCurrent
                      ? { background: av.surface.chip, color: av.text.tertiary }
                      : popular
                        ? { background: ACCENT, color: "white" }
                        : {
                            background: "#ffffff",
                            color: av.text.primary,
                            border: `1px solid ${av.stroke.medium}`,
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

      {/* What's a round */}
      <section className="mx-auto max-w-[1080px] px-6 pt-12">
        <div
          className="rounded-[20px] p-5"
          style={{
            background: av.surface.card,
            border: `1px solid ${av.stroke.soft}`,
            boxShadow: av.shadow.chip,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <div className="text-[14px] font-semibold">What&apos;s a round?</div>
              <div
                className="mt-0.5 text-[12.5px] leading-snug"
                style={{ color: av.text.tertiary }}
              >
                One diverge&nbsp;→&nbsp;converge loop. Heavier moves draw a little
                more.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ROUND_COSTS.map((r) => (
                <span
                  key={r.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]"
                  style={{ background: av.surface.chip }}
                >
                  <span style={{ color: av.text.secondary }}>{r.label}</span>
                  <span className="font-semibold" style={{ color: av.text.primary }}>
                    {r.cost}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div
            className="mt-4 border-t pt-3 text-[11.5px]"
            style={{ borderColor: av.stroke.hairline, color: av.text.faint }}
          >
            1 round = 1 credit · weekly rounds reset every Monday and don&apos;t
            roll over · purchased credits never expire.
          </div>
        </div>
      </section>

      {/* Top-up packs */}
      <section id="topup" className="mx-auto max-w-[1080px] px-6 pb-24 pt-14">
        <div className="mx-auto mb-6 max-w-[520px] text-center">
          <h2
            className="text-[24px] font-semibold tracking-tight"
            style={{ fontFamily: av.font.display, letterSpacing: "-0.02em" }}
          >
            Need more before Monday?
          </h2>
          <p
            className="mx-auto mt-2 max-w-[420px] text-[14px] leading-relaxed"
            style={{ color: av.text.secondary }}
          >
            Top up any time. Credits never expire and stack on top of your weekly
            rounds.
          </p>
        </div>

        <div className="mx-auto grid max-w-[760px] grid-cols-1 gap-4 sm:grid-cols-3">
          {TOPUP_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="relative flex flex-col rounded-[20px] p-5"
              style={{
                background: av.surface.card,
                border: pack.popular
                  ? "1px solid rgba(15,23,42,0.14)"
                  : `1px solid ${av.stroke.soft}`,
                boxShadow: av.shadow.card,
              }}
            >
              {pack.popular && (
                <div
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white"
                  style={{ background: av.accent.primary }}
                >
                  Best value
                </div>
              )}
              <div className="text-[14px] font-semibold">{pack.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[24px] font-semibold tracking-tight">
                  {pack.priceLabel}
                </span>
                <span className="text-[12px]" style={{ color: av.text.faint }}>
                  / {pack.credits} credits
                </span>
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: av.text.faint }}>
                {pack.perCredit} per credit
              </div>

              <button
                onClick={() => buyPack(pack.id)}
                disabled={buying !== null}
                className="mt-4 w-full rounded-full py-2 text-[13px] font-semibold transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
                style={
                  pack.popular
                    ? { background: av.accent.primary, color: "white" }
                    : {
                        background: "#ffffff",
                        color: av.text.primary,
                        border: `1px solid ${av.stroke.medium}`,
                      }
                }
              >
                {buying === pack.id ? "Redirecting…" : `Buy ${pack.credits}`}
              </button>
            </div>
          ))}
        </div>

        <p
          className="mt-10 text-center text-[12px]"
          style={{ color: av.text.faint }}
        >
          Prices in USD. Cancel anytime. Questions? Reach us from inside the app.
        </p>
      </section>
    </main>
  );
}
