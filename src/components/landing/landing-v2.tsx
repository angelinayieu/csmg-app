"use client";

// ── Landing V2 (preview) ──
//
// A minimal "from idea → to value asap" marketing surface, gated behind
// /?v2=1 so it can be A/B'd against the current landing WITHOUT removing
// it — the same query-param variant pattern the app already uses for
// /app?legacy=1 and /app?studio=1.
//
// It reuses the real data + flows instead of forking them:
//   • the carousel cards ARE the live TEMPLATE_LIST entries (name,
//     tagline, accent, category) passed in from the server page,
//   • clicking a card stashes a { kind:"template" } pending-intake and
//     opens the signup modal (#signup); after auth, /app's
//     PendingIntakeRunner resumes the exact same intake,
//   • "Start" just opens signup.
//
// When this wins, flip the default in src/app/page.tsx (this becomes the
// bare "/", the current landing moves behind ?legacy=1) — the same
// one-line move that made MinimalHome the default /app surface.

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { stashPendingIntake } from "@/components/landing/pending-intake";
import { AuthModal } from "@/components/auth/auth-modal";
import { StarburstSVG } from "@/components/landing/starburst-svg";
import { CardIcon } from "@/components/landing/card-icon";
import { TEMPLATE_META, type TemplateMeta, type MetaItem } from "@/components/landing/template-meta";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

// 3D hero node — code-split off the initial bundle (three.js is heavy) and
// client-only. The flat SVG is the instant loading state + the graceful
// fallback for no-WebGL / reduced-motion.
const Starburst3D = dynamic(() => import("@/components/landing/starburst-3d"), {
  ssr: false,
  loading: () => <StarburstSVG />,
});

export interface LandingCard {
  id: string;
  name: string;
  tagline: string;
  category: string;
  /** Drives the card's monochrome ink (glyph, chips, pills, Generates, CTA).
   *  In the B&W scheme this is ink; everything but the banner reads from it. */
  accent: string;
  /** Real per-template color — used ONLY for the banner wash, so the banners
   *  carry color while the rest of the card stays black. Falls back to `accent`. */
  bannerAccent?: string;
}

const NAV = ["Plans", "About"];

const INK = "#0B0B0C"; // cold near-black — landing is monochrome, do NOT warm

// Master input vocabulary — every distinct kind of thing you can feed in,
// aggregated across all templates. Surfaced ONCE in the shared pill above
// the rail (which then connects via a single line to the glass tray), so
// each card's back face can focus on what it GENERATES instead of repeating
// the input list per template. Order is first-seen across TEMPLATE_META.
const ALL_INPUTS: MetaItem[] = (() => {
  const seen = new Set<string>();
  const out: MetaItem[] = [];
  for (const meta of Object.values(TEMPLATE_META) as TemplateMeta[]) {
    for (const it of meta.inputs) {
      if (!seen.has(it.label)) {
        seen.add(it.label);
        out.push(it);
      }
    }
  }
  return out;
})();

// Small monochrome "verified by akiboe" seal — drawn with the same pen
// as the hero starburst + card glyphs (round-cap ink), so it reads as the
// same hand, NOT a borrowed blue social-network check.
function VerifiedSeal() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 12 12"
      aria-label="Verified by akiboe"
      role="img"
      style={{ display: "block" }}
    >
      <circle cx={6} cy={6} r={6} fill={INK} />
      <path
        d="M3.5 6.2 L5.1 7.8 L8.5 4.2"
        fill="none"
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Open the hash-driven AuthModal (mounted below) on signup. */
function openSignup() {
  if (typeof window !== "undefined") window.location.hash = "signup";
}

export function LandingV2({
  cards,
  surface = "flat",
}: {
  cards: LandingCard[];
  /** "flat" = solid #F7F8FA (default, ships). "whiteboard" = the tldraw-style
   *  dot-grid surface, same pattern used by MinimalHome when composing — turns
   *  the whole landing into a whiteboard for preview. */
  surface?: "flat" | "whiteboard";
}) {
  function pickTemplate(id: string) {
    // Stash the intent, then open signup — /app resumes it after auth.
    stashPendingIntake({ kind: "template", templateId: id });
    openSignup();
  }

  // ── Gallery rail ── native scroll-snap strip. Cards lift on hover (pure
  // CSS); here we only center the middle card on open + drive the progress
  // bar. The hover-lift is unclipped because the grey tray is a separate
  // background layer the cards rise out of (see the section markup).
  const railRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef<Array<HTMLButtonElement | null>>([]);
  const midIndex = Math.floor(cards.length / 2);

  function updateProgress() {
    const rail = railRef.current;
    const bar = progressRef.current;
    if (!rail || !bar) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const ratio = max > 0 ? rail.scrollLeft / max : 0;
    bar.style.width = `${20 + ratio * 80}%`;
  }

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    // Open with the featured (middle) card centered — instant, no smooth.
    const midEl = cardEls.current[midIndex];
    if (midEl) {
      const prev = rail.style.scrollBehavior;
      rail.style.scrollBehavior = "auto";
      rail.scrollLeft =
        midEl.offsetLeft + midEl.offsetWidth / 2 - rail.clientWidth / 2;
      rail.style.scrollBehavior = prev;
    }
    updateProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{
        background: "#F7F8FA",
        // Whiteboard surface = tldraw-style dot grid. Cold slate dots (the
        // product's canvas). Landing is intentionally cold B&W — do NOT warm.
        backgroundImage:
          surface === "whiteboard"
            ? "radial-gradient(circle, rgba(15,23,42,0.18) 1.3px, transparent 1.6px)"
            : undefined,
        backgroundSize: surface === "whiteboard" ? "26px 26px" : undefined,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* ── Header ── */}
      <header className="flex items-start justify-between px-6 pt-7 sm:px-10">
        <div>
          {/* The real akiboe brand lockup — sun mark + "akiboe." wordmark.
              Do NOT revert this to the plain-text wordmark. */}
          <InterAxisLogo variant="lockup" theme="light" size={26} />
          <div
            className="mt-2 text-[12.5px] leading-none"
            style={{ color: appleVibe.text.tertiary }}
          >
            #1 AI whiteboard space to improve quality of thought
          </div>
        </div>

        <nav className="flex items-center gap-6 pt-1 sm:gap-7">
          {NAV.map((item) => {
            // "Plans" routes to the public pricing page; the rest stay
            // as stubs until their destinations exist.
            const isPlans = item === "Plans";
            return (
              <a
                key={item}
                href={isPlans ? "/pricing" : "#"}
                onClick={isPlans ? undefined : (e) => e.preventDefault()}
                className="text-[15px] font-medium underline decoration-1 underline-offset-[5px] transition-opacity hover:opacity-60"
                style={{ color: INK }}
              >
                {item}
              </a>
            );
          })}
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-2">
        <h1
          className="text-center text-[clamp(32px,4.6vw,46px)] font-extrabold leading-[1.04]"
          style={{
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: appleVibe.text.faint }}>From</span>{" "}
          <span style={{ color: INK }}>idea</span>
        </h1>

        {/* Tighter + smaller so "from idea → ✷ → to value asap." reads as ONE
            connected line, not three far-apart pieces. Negative margin pulls
            the two headings in toward the mark (the 4:3 box has slack). */}
        <div className="mx-auto -my-4 w-full max-w-[372px]">
          <Starburst3D />
        </div>

        <h1
          className="text-center text-[clamp(32px,4.6vw,46px)] font-semibold leading-[1.04]"
          style={{
            color: INK,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: appleVibe.text.faint }}>to</span>{" "}
          <span style={{ color: INK }}>value asap</span>
          <span style={{ color: "#C2593B" }}>.</span>
        </h1>

        {/* Hover = Alex K–style glowing 3D pill (teal, not blue). Resting =
            flat black. The inline <style> scopes the hover keyframes. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .start-cta {
                background: ${INK};
                box-shadow: 0 12px 28px -10px rgba(11,11,12,0.5);
                transition: all 0.45s cubic-bezier(0.22,1,0.36,1);
              }
              .start-cta:hover {
                background: linear-gradient(180deg, #1ABEC9 0%, #13A2B0 100%);
                box-shadow:
                  inset 0 1px 1px rgba(255,255,255,0.35),
                  0 0 0 4px rgba(19,162,176,0.22),
                  0 0 40px 6px rgba(19,162,176,0.30),
                  0 20px 50px -16px rgba(19,162,176,0.50);
                transform: scale(1.05);
              }
              .start-cta:active {
                transform: scale(0.97);
                box-shadow:
                  inset 0 2px 4px rgba(0,0,0,0.2),
                  0 0 0 3px rgba(19,162,176,0.18),
                  0 0 24px 4px rgba(19,162,176,0.20);
              }
              /* Subtle drift on the back-face output chips — the same
                 ambient idea as the old immersive home's floating cards,
                 dialed down for a few-pixel float so they read as
                 "loose / floating" without breaking the connector geometry. */
              @keyframes oc-float-1 { 0%,100% { transform: translate3d(0,0,0) rotate(-0.6deg); } 50% { transform: translate3d(2px,-3px,0) rotate(0.4deg); } }
              @keyframes oc-float-2 { 0%,100% { transform: translate3d(0,0,0) rotate(0.7deg); } 50% { transform: translate3d(-3px,2px,0) rotate(-0.5deg); } }
              @keyframes oc-float-3 { 0%,100% { transform: translate3d(0,0,0) rotate(-0.4deg); } 50% { transform: translate3d(3px,3px,0) rotate(0.6deg); } }
              @keyframes oc-float-4 { 0%,100% { transform: translate3d(0,0,0) rotate(0.5deg); } 50% { transform: translate3d(-2px,-2px,0) rotate(-0.7deg); } }
              .oc-float-1 { animation: oc-float-1 11s ease-in-out infinite; }
              .oc-float-2 { animation: oc-float-2 13s ease-in-out infinite; }
              .oc-float-3 { animation: oc-float-3 15s ease-in-out infinite; }
              .oc-float-4 { animation: oc-float-4 17s ease-in-out infinite; }
              @media (prefers-reduced-motion: reduce) {
                .oc-float-1, .oc-float-2, .oc-float-3, .oc-float-4 { animation: none; }
              }
            `,
          }}
        />
        <button
          type="button"
          onClick={openSignup}
          className="start-cta mt-7 inline-flex items-center gap-2.5 rounded-full px-10 py-3 text-[16px] font-semibold text-white"
        >
          start
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div
          className="mt-3.5 text-[12.5px] tracking-[0.06em]"
          style={{ color: appleVibe.text.faint }}
        >
          <span className="font-normal">sync</span>{" "}
          <span className="font-bold" style={{ color: appleVibe.text.tertiary }}>tabs</span>{" "}
          <span className="font-normal">and</span>{" "}
          <span className="font-bold" style={{ color: appleVibe.text.tertiary }}>google drive</span>
        </div>
      </main>

      {/* ── Template gallery (scroll-snap rail) ── */}
      <section className="relative w-full px-6 pb-3">
        <div className="mx-auto max-w-[1180px]">
          {/* Shared "Feed in" pill — ONE translucent glass pill listing every
              input the platform accepts, surfaced above the whole rail so the
              vocabulary doesn't repeat on every card. A single line drops
              from this pill into the glass tray below; each card's back face
              now focuses on what it GENERATES. */}
          <div className="flex justify-center pb-3 pt-1">
            <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-full border border-white/60 bg-white/55 px-5 py-2 backdrop-blur-md shadow-[0_20px_38px_-18px_rgba(11,18,40,0.25),inset_0_1px_0_rgba(255,255,255,0.75)]">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{
                  color: appleVibe.text.tertiary,
                  fontFamily: appleVibe.font.display,
                }}
              >
                Feed in
              </span>
              {ALL_INPUTS.map((it, i) => {
                const Icon = it.icon;
                return (
                  <span
                    key={it.label}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-medium leading-none text-[#0B0B0C]"
                  >
                    {i === 0 ? (
                      <span aria-hidden className="-ml-0.5 text-[10px] opacity-40">·</span>
                    ) : (
                      <span aria-hidden className="text-[10px] opacity-30">·</span>
                    )}
                    <Icon
                      className="h-3 w-3 shrink-0"
                      style={{ color: INK }}
                      strokeWidth={2.2}
                    />
                    {it.label}
                  </span>
                );
              })}
            </div>
          </div>

        <div className="relative pb-5">
          {/* Single connector — flow-builder wire from the master "Feed in"
              pill above into the glass tray below. Same language as the
              dark-connectors preflight (bezier path, gradient stroke,
              chunky circular ports, animated pulse on the source) but
              adapted to the landing's cold monochrome palette. */}
          <svg
            aria-hidden
            viewBox="0 0 18 52"
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute left-1/2 z-10 h-[52px] w-[18px] -translate-x-1/2"
            style={{ top: -10 }}
          >
            <defs>
              <linearGradient
                id="lp-wire"
                gradientUnits="userSpaceOnUse"
                x1="9"
                y1="0"
                x2="9"
                y2="52"
              >
                <stop offset="0%" stopColor="#1A1A1C" stopOpacity="0.5" />
                <stop offset="55%" stopColor="#1A1A1C" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#1A1A1C" stopOpacity="0.95" />
              </linearGradient>
            </defs>

            {/* Bezier wire — gentle S so it reads as a routed flow-builder
                connection, not a flat hairline. Round caps + 2.5px so it
                holds visual weight at this size. */}
            <path
              d="M 9 6 C 12 18, 6 32, 9 46"
              fill="none"
              stroke="url(#lp-wire)"
              strokeWidth={2.5}
              strokeLinecap="round"
            />

            {/* Source port — solid ink with a soft white ring (separates
                it from the glass pill) and an animated halo. Sits clearly
                BELOW the pill bottom (the parent flex container's pb-3
                gives a 12px gap above this SVG). */}
            <circle
              cx={9}
              cy={6}
              r={3.4}
              fill="#1A1A1C"
              stroke="#FFFFFF"
              strokeWidth={1.2}
            />
            <circle cx={9} cy={6} r={3.4} fill="none" stroke="#1A1A1C" strokeWidth={1} opacity={0.45}>
              <animate
                attributeName="r"
                values="3.4;6.6;3.4"
                dur="2.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.45;0;0.45"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </circle>

            {/* Target port — lands on the glass tray's top edge. */}
            <circle
              cx={9}
              cy={46}
              r={3.4}
              fill="#1A1A1C"
              stroke="#FFFFFF"
              strokeWidth={1.2}
            />
          </svg>

          {/* Glassmorphism tray — replaces the solid grey base. Same dot
              grid (the product's canvas pattern) but rendered on a
              translucent white surface with a hairline border + backdrop
              blur, so it reads as the same material as the master pill. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 rounded-[32px] border border-white/55 backdrop-blur-md"
            style={{
              top: 40,
              backgroundColor: "rgba(255,255,255,0.42)",
              backgroundImage:
                "radial-gradient(rgba(15,23,42,0.075) 1.1px, transparent 1.1px)",
              backgroundSize: "22px 22px",
              boxShadow:
                "0 28px 60px -32px rgba(11,18,40,0.22), inset 0 1px 0 rgba(255,255,255,0.7)",
            }}
          />

          {/* Edge-fade mask so cards dissolve into the tray at both ends. */}
          <div
            className="relative"
            style={{
              WebkitMaskImage:
                "linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)",
              maskImage:
                "linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)",
            }}
          >
            {/* pt-12 gives the hover-lift headroom inside the scroller so the
                lifted card is never clipped. */}
            <div
              ref={railRef}
              onScroll={updateProgress}
              className="flex items-start gap-6 overflow-x-auto overscroll-x-contain px-[calc(50%-130px)] pb-7 pt-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{ scrollSnapType: "x mandatory" }}
            >
              {cards.map((card, i) => {
                const banner = card.bannerAccent ?? card.accent;
                return (
                  <button
                    key={card.id}
                    ref={(el) => {
                      cardEls.current[i] = el;
                    }}
                    type="button"
                    onClick={() => pickTemplate(card.id)}
                    className="group relative z-0 w-[260px] shrink-0 text-left hover:z-20 focus:outline-none"
                    style={{ scrollSnapAlign: "center" }}
                  >
                    {/* Lift wrapper — rises out of the grey tray on hover and
                        provides the 3D perspective for the flip below. The
                        lift stays separated from the rotate so the two
                        transforms don't fight inside one matrix. */}
                    <div className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-5 group-hover:scale-[1.045] [perspective:1200px]">
                      {/* Flip inner — rotates 180° on hover, swapping front for
                          back. Fixed height so the rail never reflows mid-flip;
                          both faces fill the same box. */}
                      <div className="relative h-[228px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
                        {/* ── Front face — banner + name + tagline + footer ── */}
                        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(11,18,40,0.04),0_16px_36px_-18px_rgba(11,18,40,0.22)] ring-1 ring-black/[0.04] [backface-visibility:hidden] [-webkit-backface-visibility:hidden]">
                          <div
                            className="relative h-[76px] w-full shrink-0"
                            style={{
                              background: `linear-gradient(155deg, ${banner}26 0%, ${banner}0d 55%, #ffffff 100%)`,
                            }}
                          >
                            <div
                              aria-hidden
                              className="absolute inset-0 opacity-60"
                              style={{
                                background:
                                  "radial-gradient(120% 80% at 80% 0%, rgba(255,255,255,0.7), rgba(255,255,255,0) 60%)",
                              }}
                            />
                            <div className="absolute left-3.5 top-3 flex items-center justify-center rounded-xl bg-white p-2 shadow-[0_2px_8px_-3px_rgba(11,18,40,0.18)] ring-1 ring-black/[0.06] transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:-rotate-[4deg] group-hover:scale-105">
                              <div className="h-9 w-9">
                                <CardIcon
                                  templateId={card.id}
                                  accent={banner}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                            <div
                              className="text-[14.5px] font-semibold leading-tight"
                              style={{ color: appleVibe.text.primary }}
                            >
                              {card.name}
                            </div>
                            <div
                              className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug"
                              style={{ color: appleVibe.text.tertiary }}
                            >
                              {card.tagline}
                            </div>

                            {/* Verified footer — pinned to the bottom of the
                                fixed-height face. The category pill stays put
                                now: the front-to-back cross-fade is replaced
                                by the flip itself. */}
                            <div
                              className="mt-auto flex items-center justify-between gap-3 border-t pt-3"
                              style={{ borderColor: appleVibe.stroke.hairline }}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <InterAxisLogo
                                  className="h-[18px] w-[18px] shrink-0"
                                  size={36}
                                  style={{ borderRadius: 5 }}
                                />
                                <span
                                  className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em]"
                                  style={{ color: appleVibe.text.secondary }}
                                >
                                  akiboe team
                                </span>
                                <VerifiedSeal />
                              </div>

                              <span
                                className="block shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]"
                                style={{
                                  color: banner,
                                  background: `${banner}1a`,
                                  fontFamily: appleVibe.font.display,
                                }}
                              >
                                {card.category}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* ── Back face — what the template generates ── */}
                        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_4px_10px_-4px_rgba(11,18,40,0.08),0_24px_48px_-20px_rgba(11,18,40,0.25)] ring-1 ring-black/[0.04] [backface-visibility:hidden] [-webkit-backface-visibility:hidden] [transform:rotateY(180deg)]">
                          <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
                            {(() => {
                              const meta = TEMPLATE_META[card.id];
                              if (!meta) return null;
                              const outs = meta.outputs;
                              return (
                                <>
                                  {/* Generates — black, left-aligned, the
                                      original CardDecomposition treatment.
                                      Inputs aren't repeated here because they
                                      live in the shared pill above the rail. */}
                                  <div className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">
                                    Generates
                                  </div>

                                  {/* Single-column floating glass output
                                      chips — full card width so longer labels
                                      never crop. FIXED height (not flex-1)
                                      so 3-output and 4-output cards share the
                                      same chip rhythm; any leftover space
                                      goes to a comfortable gap above the
                                      footer, NOT into stretched chips. Drift
                                      keyframes oc-float-1..4 keep the group
                                      gently floating. */}
                                  <div className="mt-2 flex flex-col gap-1.5">
                                    {outs.map((it, i) => {
                                      const Icon = it.icon;
                                      return (
                                        <div
                                          key={it.label}
                                          className={`oc-float-${(i % 4) + 1} flex h-[28px] min-w-0 items-center gap-2 rounded-xl border border-white/60 bg-white/55 px-2 text-[11px] font-medium leading-tight text-[#1A1F2B] backdrop-blur-md shadow-[0_6px_14px_-8px_rgba(11,18,40,0.22),inset_0_1px_0_rgba(255,255,255,0.75)]`}
                                          style={{ willChange: "transform" }}
                                        >
                                          <span
                                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                                            style={{ background: `${card.accent}15` }}
                                          >
                                            <Icon
                                              className="h-3 w-3"
                                              style={{ color: card.accent }}
                                              strokeWidth={2.2}
                                            />
                                          </span>
                                          <span className="truncate">{it.label}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              );
                            })()}

                            <div
                              className="mt-auto flex items-center justify-between gap-3 border-t pt-2.5"
                              style={{ borderColor: appleVibe.stroke.hairline }}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <InterAxisLogo
                                  className="h-[18px] w-[18px] shrink-0"
                                  size={36}
                                  style={{ borderRadius: 5 }}
                                />
                                <span
                                  className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em]"
                                  style={{ color: appleVibe.text.secondary }}
                                >
                                  akiboe team
                                </span>
                                <VerifiedSeal />
                              </div>
                              <span
                                className="whitespace-nowrap text-[10.5px] font-semibold tracking-[0.01em]"
                                style={{ color: banner }}
                              >
                                Use template →
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live scroll-progress bar (sits on the glass tray). */}
          <div
            className="relative mx-auto mt-4 h-[4px] w-20 overflow-hidden rounded-full"
            style={{ background: "rgba(15,23,42,0.1)" }}
          >
            <div
              ref={progressRef}
              className="h-full rounded-full"
              style={{ width: "33%", background: "#1A1A1C" }}
            />
          </div>
        </div>
        </div>
      </section>

      {/* Hash-driven signup/login popover — #signup / #signin open it. */}
      <AuthModal />
    </div>
  );
}
