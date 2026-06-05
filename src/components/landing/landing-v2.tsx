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
  /** Drives the card's monochrome ink (glyph, chips, pills, Generates, CTA).
   *  In the B&W scheme this is ink; everything but the banner reads from it. */
  accent: string;
  /** Real per-template color — used ONLY for the banner wash, so the banners
   *  carry color while the rest of the card stays black. Falls back to `accent`. */
  bannerAccent?: string;
}

const NAV = ["Plans", "About"];

const INK = "#0B0B0C"; // cold near-black — landing is monochrome, do NOT warm

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
        <div className="relative mx-auto max-w-[1180px] pb-5">
          {/* Whiteboard base — a dot-grid surface (matches the app's tldraw
              canvas) that starts below the rail's top, so a hovered card lifts
              up out of it instead of being clipped by the scroller's overflow. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 rounded-[32px]"
            style={{
              top: 40,
              backgroundColor: "#F2F4F7",
              backgroundImage:
                "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
              backgroundSize: "22px 22px",
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
                        // Banner carries the real per-template color again;
                        // everything else on the card stays ink.
                        background: `linear-gradient(155deg, ${card.bannerAccent ?? card.accent}26 0%, ${card.bannerAccent ?? card.accent}0d 55%, #ffffff 100%)`,
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
                      {/* Meaning-first mark on a white rounded "icon tile" — a
                          square app-icon sitting on the colored banner. Tilts on
                          card hover (the akiboe tile lift). */}
                      <div className="absolute left-3.5 top-3 flex items-center justify-center rounded-xl bg-white p-2 shadow-[0_2px_8px_-3px_rgba(11,18,40,0.18)] ring-1 ring-black/[0.06] transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:-rotate-[4deg] group-hover:scale-105">
                        <div className="h-9 w-9">
                          <CardIcon
                            templateId={card.id}
                            accent={card.bannerAccent ?? card.accent}
                          />
                        </div>
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
                            akiboe team
                          </span>
                          <VerifiedSeal />
                        </div>

                        <div className="relative shrink-0">
                          <span
                            className="block rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] transition-opacity duration-200 group-hover:opacity-0"
                            style={{
                              // Colored category pill — tinted by the real
                              // per-template color (not the monochrome ink).
                              color: card.bannerAccent ?? card.accent,
                              background: `${card.bannerAccent ?? card.accent}1a`,
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
