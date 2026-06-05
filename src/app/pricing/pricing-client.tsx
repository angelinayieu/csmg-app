"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { AkiboeLogo } from "@/components/brand/akiboe-logo";
import { PLANS, ROUND_COSTS, TOPUP_PACKS, type PlanId } from "@/lib/plans";

// ── akiboe brand tokens (warm "sun" palette) ──────────────────────────
// The page used to borrow the cold apple-vibe slate ramp + system-blue
// (#0A84FF) — completely off-brand. akiboe is a warm terracotta sun: the
// accent + ink below are the canonical logo values (see PALETTE in
// src/components/brand/akiboe-logo.tsx, light variant), extended into the
// warm-taupe text ramp + cream paper this page needs. Kept local to the
// page so it stays self-contained, not a parallel token system.
const sun = {
  clay: "#C2593B", // terracotta — the brand accent (the logo's sun ray)
  clayDeep: "#A8472E", // pressed / hover
  coral: "#E07A5F", // soft coral — gradient partner for the CTA + sun glow
  amber: "#E8A13C", // sun gold — the warmest glow note
  ocean: "#13A2B0", // tropical teal — the "sea" note (sun + sea = tropical)
  oceanLight: "#56C7D0", // aqua highlight for the waves + ambient sea glow

  ink: "#23201C", // warm near-black — headings + strong text
  body: "#5A5147", // warm taupe — secondary body copy
  muted: "#8C8378", // warm taupe-500 — meta / counts
  faint: "#B4A99B", // warm taupe-400 — quietest hints

  paper: "#FBF6EE", // warm cream base
  card: "#FFFFFF",
  hairline: "rgba(35,32,28,0.07)",
  border: "rgba(35,32,28,0.11)",

  // Warm-tinted soft shadows — sun-warmed, not the old cold-slate drop.
  shadowCard:
    "0 1px 0 rgba(255,255,255,0.9) inset, 0 22px 48px -28px rgba(120,64,32,0.30)",
  shadowChip:
    "0 1px 0 rgba(255,255,255,0.8) inset, 0 12px 26px -16px rgba(120,64,32,0.22)",
} as const;

// Whole-page warm display/body stack, led by the now-loaded Plus Jakarta
// Sans (rounded + friendly — the right voice for the warm brand).
const FONT =
  "var(--font-jakarta), -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif";

// Annual billing = pay for 10 months, get 2 free (≈17% off) — a standard,
// honest discount. The page favors annual (a cheat-sheet rule); retune the
// deal by changing this one number. Until recurring checkout is wired, the
// chosen period rides along as `?billing=` intent on the signup link.
const ANNUAL_MONTHS_CHARGED = 10;
const ANNUAL_SAVE_LABEL = "Save 17%";

// profiles.tier is free|pro|team; plan ids are free|standard|pro. Light
// mapping so "Current plan" highlights sensibly until recurring billing
// is wired and the tier values are reconciled.
const TIER_TO_PLAN: Record<string, PlanId> = {
  free: "free",
  pro: "standard",
  team: "pro",
};

// Sun rising over the sea — the hero mark. The akiboe sun (coral→amber)
// above two teal waves, on a soft sand tile (the tropical-reference look).
function SunSea({ size = 84 }: { size?: number }) {
  return (
    <div
      className="mx-auto flex items-center justify-center rounded-[24px]"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(180deg,#FFFDFA 0%,#FBF1E4 100%)",
        border: `1px solid ${sun.hairline}`,
        boxShadow: sun.shadowChip,
      }}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="akb-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F2A64C" />
            <stop offset="1" stopColor={sun.clay} />
          </linearGradient>
          <linearGradient id="akb-sea" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={sun.ocean} />
            <stop offset="1" stopColor={sun.oceanLight} />
          </linearGradient>
        </defs>
        {/* rays */}
        <g stroke="#EBA13E" strokeWidth="4.6" strokeLinecap="round">
          <line x1="50" y1="13" x2="50" y2="5" />
          <line x1="31" y1="21" x2="26" y2="16" />
          <line x1="69" y1="21" x2="74" y2="16" />
          <line x1="23" y1="39" x2="15" y2="39" />
          <line x1="77" y1="39" x2="85" y2="39" />
        </g>
        {/* sun */}
        <circle cx="50" cy="39" r="12.5" fill="url(#akb-sun)" />
        {/* sea */}
        <g stroke="url(#akb-sea)" strokeWidth="5" strokeLinecap="round">
          <path d="M15 63 q 8.75 -7 17.5 0 t 17.5 0 t 17.5 0 t 17.5 0" />
          <path d="M15 77 q 8.75 -7 17.5 0 t 17.5 0 t 17.5 0 t 17.5 0" />
        </g>
      </svg>
    </div>
  );
}

// Evolving sun-over-sea mark — the tropical take on the cheat-sheet's
// "evolving illustrations": each tier's scene grows richer (more rays +
// more waves), echoing the hero SunSea so the three cards read as a set.
function PlanMark({ level }: { level: 0 | 1 | 2 }) {
  const RAYS = [
    "M50 27 L50 19", // top
    "M59 30 L64 24", // upper-right
    "M41 30 L36 24", // upper-left
    "M66 42 L74 42", // right
    "M34 42 L26 42", // left
    "M59 54 L64 60", // lower-right
    "M41 54 L36 60", // lower-left
  ];
  const rayCount = level === 0 ? 3 : level === 1 ? 5 : 7;
  const waveYs = level === 0 ? [76] : level === 1 ? [68, 80] : [60, 72, 84];
  const gid = `akb-pm-${level}`;
  return (
    <svg width={46} height={46} viewBox="0 0 100 100" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F2A64C" />
          <stop offset="1" stopColor={sun.clay} />
        </linearGradient>
      </defs>
      <g stroke="#EBA13E" strokeWidth="4.2" strokeLinecap="round">
        {RAYS.slice(0, rayCount).map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle cx="50" cy="42" r="11.5" fill={`url(#${gid})`} />
      <g stroke={sun.ocean} strokeWidth="4.4" strokeLinecap="round">
        {waveYs.map((y) => (
          <path key={y} d={`M18 ${y} q 8 -5 16 0 t 16 0 t 16 0 t 16 0`} />
        ))}
      </g>
    </svg>
  );
}

export function PricingClient({
  isLoggedIn,
  currentPlan,
}: {
  isLoggedIn: boolean;
  currentPlan: string | null;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  // Favor annual: default the toggle to annual so the lower per-month price
  // is the first number shown (the anchor the cheat-sheet calls for).
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");
  const activePlan = currentPlan ? TIER_TO_PLAN[currentPlan] ?? null : null;

  function choosePlan(id: PlanId) {
    if (id === "free") {
      window.location.href = isLoggedIn ? "/app" : "/auth/signup";
      return;
    }
    if (!isLoggedIn) {
      window.location.href = `/auth/signup?plan=${id}&billing=${billing}`;
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
      className="relative min-h-screen overflow-hidden"
      style={{
        fontFamily: FONT,
        color: sun.ink,
        // Tropical sun-over-sea wash: warm peach/amber sky up top, settling
        // through cream sand, cooling to the faintest aqua at the horizon.
        background:
          "linear-gradient(180deg,#FCEEDC 0%,#FBF3E8 12%,#FBF6EE 32%,#FAF6EE 60%,#EEF5F2 100%)",
      }}
    >
      {/* Soft sun glow behind the hero — warm amber→coral, the sun up top.
          Big, blurred, low-opacity; never a hard tinted rect. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-180px] -translate-x-1/2"
        style={{
          width: 980,
          height: 560,
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(232,161,60,0.22) 0%, rgba(224,122,95,0.12) 40%, rgba(251,246,238,0) 72%)",
        }}
      />

      {/* Cool ocean glow pooling low on the page — the sea light beneath the
          sun, so the page reads warm-sky → cool-water top to bottom. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[20px] left-1/2 -translate-x-1/2"
        style={{
          width: 1120,
          height: 620,
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(19,162,176,0.13) 0%, rgba(86,199,208,0.07) 42%, rgba(238,245,242,0) 72%)",
        }}
      />

      <div className="relative">
        {/* ── Header ── */}
        <header className="mx-auto flex max-w-[1080px] items-center justify-between px-6 py-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <AkiboeLogo variant="lockup" theme="light" size={21} />
          </Link>
          <Link
            href={isLoggedIn ? "/app" : "/auth/login"}
            className="text-[13.5px] font-medium transition-opacity hover:opacity-70"
            style={{ color: sun.body }}
          >
            {isLoggedIn ? "Open app" : "Sign in"}
          </Link>
        </header>

        {/* ── Hero ── short + punchy: a sun-over-sea mark, one word, one line. */}
        <section className="mx-auto max-w-[720px] px-6 pb-12 pt-6 text-center">
          <SunSea size={84} />
          <h1
            className="mt-6 text-[46px] font-extrabold leading-[1.0] sm:text-[56px]"
            style={{ letterSpacing: "-0.035em" }}
          >
            Pricing
          </h1>
          <p
            className="mx-auto mt-3.5 text-[16px] font-medium"
            style={{ color: sun.body }}
          >
            Plans that refill every week.
          </p>
        </section>

        {/* ── Billing toggle ── favor annual (cheat-sheet rule); the teal
            "save" chip puts the ocean accent on a functional element. */}
        <div className="mb-9 flex items-center justify-center gap-3 px-6">
          <div
            className="inline-flex items-center rounded-full p-1"
            style={{ background: "rgba(35,32,28,0.06)" }}
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
                  className="rounded-full px-4 py-1.5 text-[13px] font-bold transition-all"
                  style={
                    active
                      ? {
                          background: sun.card,
                          color: sun.ink,
                          boxShadow: sun.shadowChip,
                        }
                      : { color: sun.muted, background: "transparent" }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
            style={{ background: "rgba(19,162,176,0.13)", color: sun.ocean }}
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
              const level = idx as 0 | 1 | 2;
              return (
                <div
                  key={plan.id}
                  className="relative flex h-full flex-col rounded-[24px] p-6"
                  style={
                    popular
                      ? {
                          // Oceanic gradient frame (sunset → sea) via the
                          // padding-box/border-box trick — clean, no nesting.
                          border: "2.5px solid transparent",
                          background:
                            "linear-gradient(180deg,#FFF9F3 0%,#FFFFFF 30%) padding-box, linear-gradient(135deg,#E07A5F 0%,#E8A13C 44%,#13A2B0 100%) border-box",
                          boxShadow:
                            "0 1px 0 rgba(255,255,255,0.9) inset, 0 34px 82px -38px rgba(60,104,116,0.34)",
                        }
                      : {
                          background: sun.card,
                          border: `1px solid ${sun.hairline}`,
                          boxShadow: sun.shadowCard,
                        }
                  }
                >
                  {popular && (
                    <div
                      className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.09em] text-white"
                      style={{
                        background:
                          "linear-gradient(135deg,#E07A5F 0%,#E8A13C 44%,#13A2B0 100%)",
                        boxShadow: "0 8px 20px -10px rgba(60,104,116,0.6)",
                      }}
                    >
                      Most popular
                    </div>
                  )}
                  {/* Editorial header row: the evolving sun-sea mark + a
                      small index number (or the "current plan" chip). */}
                  <div className="mb-5 flex items-center justify-between">
                    <PlanMark level={level} />
                    {isCurrent ? (
                      <span
                        className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={{
                          background: "rgba(19,162,176,0.12)",
                          color: sun.ocean,
                        }}
                      >
                        Current
                      </span>
                    ) : (
                      <span
                        className="text-[13px] font-bold tabular-nums"
                        style={{ color: sun.faint, letterSpacing: "0.06em" }}
                      >
                        0{idx + 1}
                      </span>
                    )}
                  </div>
                  <div className="text-[18px] font-bold tracking-tight">
                    {plan.name}
                  </div>
                  <div
                    className="mt-1 min-h-[34px] text-[12.5px] font-medium leading-snug"
                    style={{ color: sun.muted }}
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
                      style={{ color: sun.faint }}
                    >
                      {paid ? (showAnnual ? "/ mo" : "/ month") : plan.period}
                    </span>
                  </div>
                  {/* Annual savings note — teal (ocean) ties the accent in.
                      Height reserved so cards don't jump when toggling. */}
                  <div
                    className="mt-1 h-[16px] text-[12px] font-semibold"
                    style={{ color: sun.ocean }}
                  >
                    {showAnnual ? `billed annually · $${annualTotal}/yr` : ""}
                  </div>

                  {/* Lead with the value: rounds/week as a warm pill. */}
                  <div
                    className="mt-4 inline-flex w-fit items-baseline gap-1.5 rounded-full px-3 py-1.5"
                    style={{ background: "rgba(194,89,59,0.09)" }}
                  >
                    <span
                      className="text-[15px] font-extrabold"
                      style={{ color: sun.clay }}
                    >
                      {plan.weeklyRounds}
                    </span>
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color: sun.clayDeep }}
                    >
                      rounds / week
                    </span>
                  </div>
                  <div
                    className="mt-2 text-[12px] font-medium"
                    style={{ color: sun.faint }}
                  >
                    {plan.boardsPerWeek}
                  </div>

                  <div
                    className="my-5 h-px w-full"
                    style={{ background: sun.hairline }}
                  />

                  <ul className="flex flex-1 flex-col gap-2.5">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2.5 text-[13px] font-medium"
                      >
                        <span
                          className="mt-[1px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: "rgba(194,89,59,0.12)" }}
                        >
                          <Check
                            className="h-[11px] w-[11px]"
                            strokeWidth={3}
                            style={{ color: sun.clay }}
                          />
                        </span>
                        <span style={{ color: sun.body }}>{f}</span>
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
                            background: "rgba(35,32,28,0.05)",
                            color: sun.muted,
                          }
                        : popular
                          ? {
                              background: `linear-gradient(180deg,${sun.coral},${sun.clay})`,
                              color: "white",
                              boxShadow:
                                "0 10px 24px -10px rgba(194,89,59,0.55)",
                            }
                          : {
                              background: "#ffffff",
                              color: sun.ink,
                              border: `1px solid ${sun.border}`,
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

        {/* ── Round legend (quiet, centered, clearly subordinate) ── */}
        <section className="mx-auto max-w-[720px] px-6 pt-14 text-center">
          <h2 className="text-[15px] font-bold tracking-tight">
            What a round costs
          </h2>
          <p
            className="mx-auto mt-1.5 max-w-[440px] text-[13px] font-medium leading-snug"
            style={{ color: sun.muted }}
          >
            One diverge&nbsp;→&nbsp;converge loop is a round. Heavier moves draw
            a little more.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {ROUND_COSTS.map((r) => (
              <span
                key={r.label}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
                style={{
                  background: sun.card,
                  border: `1px solid ${sun.hairline}`,
                  boxShadow: sun.shadowChip,
                }}
              >
                <span style={{ color: sun.body }}>{r.label}</span>
                <span className="font-bold" style={{ color: sun.clay }}>
                  {r.cost}
                </span>
              </span>
            ))}
          </div>

          <div
            className="mx-auto mt-5 max-w-[520px] text-[11.5px] font-medium leading-relaxed"
            style={{ color: sun.faint }}
          >
            1 round = 1 credit · weekly rounds reset every Monday and
            don&apos;t roll over · purchased credits never expire.
          </div>
        </section>

        {/* ── Top-up packs (secondary) ── */}
        <section id="topup" className="mx-auto max-w-[1080px] px-6 pb-24 pt-16">
          <div className="mx-auto mb-7 max-w-[520px] text-center">
            <h2
              className="text-[26px] font-extrabold tracking-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Need more before Monday?
            </h2>
            <p
              className="mx-auto mt-2.5 max-w-[420px] text-[14px] font-medium leading-relaxed"
              style={{ color: sun.body }}
            >
              Top up any time. Credits never expire and stack on top of your
              weekly rounds.
            </p>
          </div>

          <div className="mx-auto grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-3">
            {TOPUP_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="relative flex flex-col rounded-[20px] p-5"
                style={{
                  background: sun.card,
                  border: pack.popular
                    ? `1px solid rgba(194,89,59,0.26)`
                    : `1px solid ${sun.hairline}`,
                  boxShadow: pack.popular ? sun.shadowCard : sun.shadowChip,
                }}
              >
                {pack.popular && (
                  <div
                    className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.07em] text-white"
                    style={{
                      background: `linear-gradient(180deg,${sun.coral},${sun.clay})`,
                      boxShadow: "0 6px 16px -6px rgba(194,89,59,0.6)",
                    }}
                  >
                    Best value
                  </div>
                )}
                <div className="text-[14px] font-bold">{pack.name}</div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-[25px] font-extrabold tracking-tight">
                    {pack.priceLabel}
                  </span>
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: sun.faint }}
                  >
                    / {pack.credits} credits
                  </span>
                </div>
                <div
                  className="mt-1 text-[11px] font-medium"
                  style={{ color: sun.faint }}
                >
                  {pack.perCredit} per credit
                </div>

                <button
                  onClick={() => buyPack(pack.id)}
                  disabled={buying !== null}
                  className="mt-4 w-full rounded-full py-2 text-[13px] font-bold transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                  style={
                    pack.popular
                      ? {
                          background: `linear-gradient(180deg,${sun.coral},${sun.clay})`,
                          color: "white",
                          boxShadow: "0 8px 20px -10px rgba(194,89,59,0.55)",
                        }
                      : {
                          background: "#ffffff",
                          color: sun.ink,
                          border: `1px solid ${sun.border}`,
                        }
                  }
                >
                  {buying === pack.id ? "Redirecting…" : `Buy ${pack.credits}`}
                </button>
              </div>
            ))}
          </div>

          <p
            className="mt-10 text-center text-[12px] font-medium"
            style={{ color: sun.faint }}
          >
            Prices in USD. Cancel anytime. Questions? Reach us from inside the
            app.
          </p>
        </section>
      </div>
    </main>
  );
}
