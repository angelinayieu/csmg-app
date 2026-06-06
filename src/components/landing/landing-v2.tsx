"use client";

// ── Landing V2 ──
//
// The akiboe marketing surface: a centred hero (wordmark + glass pill nav,
// "from idea → to value asap", start CTA) with a SWARM of real template cards
// floating around it — each drifts on its own keyframe, tilts, and flips on
// hover to reveal what it generates. Modelled on the user's reference: cards
// scattered in the left/right gutters (never the protected centre column),
// one card sitting BEHIND another for depth, and rich accent "mesh" banners.
//
// It reuses real data + flows:
//   • the cards ARE the live TEMPLATE_LIST entries (name, tagline, accent,
//     category) passed in from the server page,
//   • clicking a card stashes a { kind:"template" } pending-intake and opens
//     the signup modal (#signup); after auth /app's PendingIntakeRunner
//     resumes the exact same intake,
//   • "start" just opens signup.

import dynamic from "next/dynamic";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { stashPendingIntake } from "@/components/landing/pending-intake";
import { AuthModal } from "@/components/auth/auth-modal";
import { StarburstSVG } from "@/components/landing/starburst-svg";
import { CardIcon } from "@/components/landing/card-icon";
import { TEMPLATE_META } from "@/components/landing/template-meta";
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
  /** Drives the card's monochrome ink (title, chips, "Generates"). */
  accent: string;
  /** Real per-template colour — drives the banner mesh + category label.
   *  Falls back to `accent`. */
  bannerAccent?: string;
}

const NAV = ["Plans", "About"];

const INK = "#0B0B0C"; // cold near-black — landing is monochrome, do NOT warm

// ── Floating-card anchors ── positions for the 7-card swarm, expressed as
// percentages of a CENTRED max-width band (not the raw viewport) so the cards
// hug the hero on ultrawide screens instead of flinging to a lonely moat.
//
// Index maps 1:1 to the server's CAROUSEL_IDS order. The composition mirrors
// the reference: lead cards top-left/right, an overlapping pair mid-left (a
// faded "depth" card BEHIND the research card), and a lower row.
//
// Design rules: every card lives in the LEFT/RIGHT gutter (never the centre
// column where the hero lives); a per-card base `rot` tilt + slight edge-bleed
// make it read as dropped-on-a-canvas; one card is `depth` (faded, scaled
// back, lower z) so the stack has real dimension.
type Anchor = {
  top: string;
  left?: string;
  right?: string;
  rot: number;
  z: number;
  drift: number;
  /** Faded card that sits behind its neighbour for depth. */
  depth?: boolean;
};
const FLOATING_ANCHORS: Anchor[] = [
  { top: "12%", left: "-1%", rot: -4, z: 2, drift: 1 }, // 0 · L top   — Self-Discovery
  { top: "13%", right: "-1%", rot: 4, z: 2, drift: 2 }, // 1 · R top   — Startup Strategy
  { top: "37%", left: "8%", rot: -6, z: 1, drift: 6, depth: true }, // 2 · L mid (BEHIND) — Relationship Dynamics
  { top: "43%", left: "-1%", rot: 3, z: 3, drift: 3 }, // 3 · L mid (FRONT) — Research Project
  { top: "40%", right: "0%", rot: -3, z: 2, drift: 4 }, // 4 · R mid   — Reading Notes
  { top: "69%", left: "2%", rot: 4, z: 2, drift: 5 }, // 5 · L bottom — Team Retrospective
  { top: "69%", right: "1%", rot: -5, z: 2, drift: 7 }, // 6 · R bottom — Career Pivot
];

/** Open the hash-driven AuthModal (mounted below) on signup. */
function openSignup() {
  if (typeof window !== "undefined") window.location.hash = "signup";
}

/** Inline panel/sidebar glyph for the glass nav (matches the app toolbar). */
function PanelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6.4" y1="3.4" x2="6.4" y2="12.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Inline search glyph for the glass nav. */
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.1" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10.1" y1="10.1" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** A single floating, flippable template card. */
function SwarmCard({
  card,
  anchor,
  onPick,
}: {
  card: LandingCard;
  anchor: Anchor;
  onPick: (id: string) => void;
}) {
  const banner = card.bannerAccent ?? card.accent;
  const meta = TEMPLATE_META[card.id];

  // Accent "mesh" banner — layered radial blobs in the template colour over a
  // soft white base. Reads as rich/photographic texture with zero photo assets.
  const meshBanner =
    `radial-gradient(120% 130% at 0% 0%, ${banner}40 0%, transparent 55%),` +
    `radial-gradient(120% 120% at 100% 8%, ${banner}2e 0%, transparent 52%),` +
    `radial-gradient(130% 150% at 82% 130%, ${banner}1f 0%, transparent 58%),` +
    `linear-gradient(160deg, #ffffff 0%, #f6f7f9 100%)`;

  return (
    <button
      type="button"
      onClick={() => onPick(card.id)}
      className={`group pointer-events-auto absolute w-[224px] text-left focus:outline-none ${
        anchor.depth ? "swarm-depth" : ""
      }`}
      style={{
        top: anchor.top,
        left: anchor.left,
        right: anchor.right,
        transform: `rotate(${anchor.rot}deg)${anchor.depth ? " scale(0.92)" : ""}`,
        zIndex: anchor.z,
      }}
    >
      {/* Drift wrapper — `immersive-card-drift-*` keyframes (globals.css).
          Pauses on hover so the flip isn't fighting a moving target. */}
      <div className={`immersive-card-drift-${anchor.drift} group-hover:[animation-play-state:paused]`}>
        {/* Lift + perspective wrapper, kept separate from the rotate so the
            transforms don't fight inside one matrix. */}
        <div className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-3 group-hover:scale-[1.05] [perspective:1200px]">
          {/* Flip inner — rotates 180° on hover; fixed height, both faces fill it. */}
          <div className="relative h-[212px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
            {/* ── Front — mesh banner + name + tagline + category ── */}
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_3px_rgba(11,18,40,0.05),0_22px_42px_-20px_rgba(11,18,40,0.32)] ring-1 ring-black/[0.05] [backface-visibility:hidden] [-webkit-backface-visibility:hidden]">
              <div className="relative h-[94px] w-full shrink-0 overflow-hidden" style={{ background: meshBanner }}>
                {/* soft top highlight */}
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(120% 90% at 78% -10%, rgba(255,255,255,0.75), rgba(255,255,255,0) 60%)",
                  }}
                />
                {/* large ghost glyph bleeding from the corner — identity texture */}
                <div aria-hidden className="absolute -bottom-3 -right-2 h-[82px] w-[82px] opacity-[0.12]">
                  <CardIcon templateId={card.id} accent={banner} />
                </div>
                {/* crisp icon tile — the "logo" */}
                <div className="absolute left-3 top-3 flex items-center justify-center rounded-xl bg-white p-1.5 shadow-[0_3px_10px_-3px_rgba(11,18,40,0.22)] ring-1 ring-black/[0.06] transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:-rotate-[5deg] group-hover:scale-105">
                  <div className="h-7 w-7">
                    <CardIcon templateId={card.id} accent={banner} />
                  </div>
                </div>
              </div>

              <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-2.5">
                <div className="text-[14px] font-semibold leading-tight" style={{ color: appleVibe.text.primary }}>
                  {card.name}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-snug" style={{ color: appleVibe.text.tertiary }}>
                  {card.tagline}
                </div>
                {/* Slim footer — just the category in coloured caps (reference). */}
                <div className="mt-auto pt-2.5">
                  <span
                    className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: banner, fontFamily: appleVibe.font.display }}
                  >
                    {card.category}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Back — what the template generates ── */}
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_4px_10px_-4px_rgba(11,18,40,0.08),0_24px_48px_-20px_rgba(11,18,40,0.3)] ring-1 ring-black/[0.05] [backface-visibility:hidden] [-webkit-backface-visibility:hidden] [transform:rotateY(180deg)]">
              <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
                {meta && (
                  <>
                    <div className="text-[12px] font-semibold tracking-[-0.01em] text-[#0B0B0C]">Generates</div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {meta.outputs.map((it, oi) => {
                        const Icon = it.icon;
                        return (
                          <div
                            key={it.label}
                            className={`oc-float-${(oi % 4) + 1} flex flex-1 min-w-0 items-center gap-2 rounded-lg border border-black/[0.05] bg-white/70 px-2 text-[10.5px] font-medium leading-tight text-[#1A1F2B] shadow-[0_4px_10px_-6px_rgba(11,18,40,0.2),inset_0_1px_0_rgba(255,255,255,0.7)]`}
                            style={{ willChange: "transform" }}
                          >
                            <span
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                              style={{ background: `${card.accent}15` }}
                            >
                              <Icon className="h-2.5 w-2.5" style={{ color: card.accent }} strokeWidth={2.2} />
                            </span>
                            <span className="truncate">{it.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <div
                  className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5"
                  style={{ borderColor: appleVibe.stroke.hairline }}
                >
                  <span
                    className="text-[9.5px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: banner, fontFamily: appleVibe.font.display }}
                  >
                    {card.category}
                  </span>
                  <span className="whitespace-nowrap text-[10.5px] font-semibold tracking-[0.01em]" style={{ color: banner }}>
                    Use template →
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

export function LandingV2({
  cards,
  surface = "flat",
}: {
  cards: LandingCard[];
  /** "flat" = solid #F7F8FA. "whiteboard" = adds the faint tldraw dot grid. */
  surface?: "flat" | "whiteboard";
}) {
  function pickTemplate(id: string) {
    stashPendingIntake({ kind: "template", templateId: id });
    openSignup();
  }

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{
        background: "#F7F8FA",
        // Soft white radial glow lifting the centre hero, over a FAINT dot grid
        // (lightened so the cards + hero are the focus, not the texture).
        backgroundImage:
          surface === "whiteboard"
            ? "radial-gradient(56% 48% at 50% 42%, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0) 72%), radial-gradient(circle, rgba(15,23,42,0.06) 1.1px, transparent 1.5px)"
            : "radial-gradient(56% 48% at 50% 42%, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0) 72%)",
        backgroundSize: surface === "whiteboard" ? "100% 100%, 26px 26px" : "100% 100%",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Scoped hover keyframes + the depth-card behaviour. */}
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
            .start-cta:active { transform: scale(0.97); }
            /* Depth card: faded + behind at rest, pops forward on hover. */
            .swarm-depth { opacity: 0.58; transition: opacity 0.3s ease; }
            .swarm-depth:hover { opacity: 1; z-index: 40 !important; }
            /* Back-face output chips: a few-px ambient float. */
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

      {/* ── Header — centred wordmark + glass pill nav (z-30, above the swarm) ── */}
      <header className="relative z-30 flex flex-col items-center gap-3 px-6 pt-6">
        <InterAxisLogo variant="lockup" theme="light" size={24} />
        <nav className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/70 p-1 pl-1.5 shadow-[0_10px_30px_-14px_rgba(11,18,40,0.28),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ color: appleVibe.text.faint }}
          >
            <PanelIcon />
          </span>
          {NAV.map((item, i) => {
            const isPlans = item === "Plans";
            return (
              <a
                key={item}
                href={isPlans ? "/pricing" : "#"}
                onClick={isPlans ? undefined : (e) => e.preventDefault()}
                className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
                style={{ color: INK, background: i === 0 ? "rgba(15,23,42,0.05)" : undefined }}
              >
                {item}
              </a>
            );
          })}
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ color: appleVibe.text.faint }}
          >
            <SearchIcon />
          </span>
        </nav>
      </header>

      {/* ── Hero (z-10, protected centre column) ── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-2">
        <h1
          className="text-center text-[clamp(34px,4.8vw,54px)] font-extrabold leading-[1.02]"
          style={{ fontFamily: appleVibe.font.display, letterSpacing: "-0.025em" }}
        >
          <span style={{ color: appleVibe.text.faint }}>From</span> <span style={{ color: INK }}>idea</span>
        </h1>

        {/* Negative margin pulls the headings toward the mark (4:3 box slack). */}
        <div className="mx-auto -my-5 w-full max-w-[372px]">
          <Starburst3D />
        </div>

        <h1
          className="text-center text-[clamp(34px,4.8vw,54px)] font-extrabold leading-[1.02]"
          style={{ color: INK, fontFamily: appleVibe.font.display, letterSpacing: "-0.025em" }}
        >
          <span style={{ color: appleVibe.text.faint }}>to</span> <span style={{ color: INK }}>value asap</span>
          <span style={{ color: "#C2593B" }}>.</span>
        </h1>

        <button
          type="button"
          onClick={openSignup}
          className="start-cta mt-7 inline-flex items-center gap-2.5 rounded-full px-10 py-3 text-[16px] font-semibold text-white"
        >
          start
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="mt-3.5 text-[12.5px] tracking-[0.06em]" style={{ color: appleVibe.text.faint }}>
          <span className="font-normal">sync</span>{" "}
          <span className="font-bold" style={{ color: appleVibe.text.tertiary }}>tabs</span>{" "}
          <span className="font-normal">and</span>{" "}
          <span className="font-bold" style={{ color: appleVibe.text.tertiary }}>google drive</span>
        </div>
      </main>

      {/* ── Floating template swarm ──
          z-20 (above the hero) so each card actually receives :hover — that's
          what drives the flip. The layer is pointer-events-none and only the
          cards opt back in, so the centred CTA stays clickable straight through.
          Cards live inside a centred max-width band so they hug the hero on
          wide monitors instead of drifting to the edges. */}
      <div className="pointer-events-none absolute inset-0 z-20 flex justify-center px-4">
        <div className="relative h-full w-full max-w-[1200px]">
          {cards.map((card, i) => (
            <SwarmCard
              key={card.id}
              card={card}
              anchor={FLOATING_ANCHORS[i] ?? FLOATING_ANCHORS[i % FLOATING_ANCHORS.length]}
              onPick={pickTemplate}
            />
          ))}
        </div>
      </div>

      {/* Hash-driven signup/login popover — #signup / #signin open it. */}
      <AuthModal />
    </div>
  );
}
