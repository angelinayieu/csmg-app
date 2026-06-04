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
import { CardGlyph } from "@/components/landing/card-glyph";
import { CardDecomposition } from "@/components/landing/card-decomposition";
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
  /** Template accent_color — drives the colored category tag + image wash. */
  accent: string;
}

const NAV = ["Plans", "About", "Blog"];

const INK = "#0B0B0C";

// Small monochrome "verified by Intersice" seal — drawn with the same pen
// as the hero starburst + card glyphs (round-cap ink), so it reads as the
// same hand, NOT a borrowed blue social-network check.
function VerifiedSeal() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 12 12"
      aria-label="Verified by Intersice"
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

export function LandingV2({ cards }: { cards: LandingCard[] }) {
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
      className="flex min-h-screen flex-col overflow-hidden"
      style={{ background: "#F7F8FA", fontFamily: appleVibe.font.stack }}
    >
      {/* ── Header ── */}
      <header className="flex items-start justify-between px-6 pt-7 sm:px-10">
        <div>
          <div
            className="text-[22px] font-bold leading-none tracking-tight"
            style={{ color: INK }}
          >
            intersice
          </div>
          <div
            className="mt-1.5 text-[12.5px] leading-none"
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
          className="text-center text-[clamp(32px,4.6vw,46px)] font-semibold leading-[1.04]"
          style={{
            color: INK,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.02em",
          }}
        >
          from <span className="font-extrabold">idea</span>
        </h1>

        <div className="mx-auto my-0.5 w-full max-w-[480px]">
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
          to <span className="font-extrabold">value</span>{" "}
          <span className="underline decoration-2 underline-offset-[6px]">
            asap.
          </span>
        </h1>

        <button
          type="button"
          onClick={openSignup}
          className="mt-6 rounded-full px-11 py-3 text-[17px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(11,11,12,0.5)] transition-transform hover:scale-[1.03] active:scale-95"
          style={{ background: INK }}
        >
          Start
        </button>

        <div
          className="mt-3 text-[13.5px]"
          style={{ color: appleVibe.text.tertiary }}
        >
          sync tabs and google drive
        </div>
      </main>

      {/* ── Template gallery (scroll-snap rail) ── */}
      <section className="relative w-full px-6 pb-3">
        <div className="relative mx-auto max-w-[1180px] pb-5">
          {/* Grey tray — a BACKGROUND layer that starts below the rail's top,
              so a hovered card lifts up out of it instead of being clipped by
              the horizontal scroller's overflow. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 rounded-[32px]"
            style={{ top: 40, background: "#EEF0F3" }}
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
              {cards.map((card, i) => (
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
                  {/* Inner card does the lifting (CSS hover) — rises up and
                      grows out of the grey tray, fully visible. */}
                  <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(11,18,40,0.04),0_16px_36px_-18px_rgba(11,18,40,0.22)] ring-1 ring-black/[0.04] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-5 group-hover:scale-[1.045] group-hover:shadow-[0_2px_2px_rgba(11,18,40,0.05),0_38px_64px_-20px_rgba(11,18,40,0.45)]">
                    {/* Slim accent banner with the graph glyph shrunk to a
                        small icon in the top-left corner. */}
                    <div
                      className="relative h-[76px] w-full"
                      style={{
                        background: `linear-gradient(155deg, ${card.accent}26 0%, ${card.accent}0d 55%, #ffffff 100%)`,
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
                      <div className="absolute left-3.5 top-3 h-9 w-14">
                        <CardGlyph
                          templateId={card.id}
                          accent={card.accent}
                          animated
                        />
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-3">
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

                      {/* Hover reveal: what you can feed in + what it
                          generates. Hidden until you hover the card, then
                          it grows in place (items-start keeps siblings from
                          stretching). */}
                      <CardDecomposition
                        templateId={card.id}
                        accent={card.accent}
                      />

                      {/* Verified footer — roomier (wider card + bigger gap).
                          The pill cross-fades to "Use template →" on hover. */}
                      <div
                        className="mt-4 flex items-center justify-between gap-3 border-t pt-3"
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
                            Intersice Team
                          </span>
                          <VerifiedSeal />
                        </div>

                        <div className="relative shrink-0">
                          <span
                            className="block rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] transition-opacity duration-200 group-hover:opacity-0"
                            style={{
                              color: card.accent,
                              background: `${card.accent}1a`,
                              fontFamily: appleVibe.font.display,
                            }}
                          >
                            {card.category}
                          </span>
                          <span
                            className="absolute right-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold tracking-[0.01em] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                            style={{ color: card.accent }}
                          >
                            Use template →
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Live scroll-progress bar (sits on the grey tray). */}
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
      </section>

      {/* Hash-driven signup/login popover — #signup / #signin open it. */}
      <AuthModal />
    </div>
  );
}
