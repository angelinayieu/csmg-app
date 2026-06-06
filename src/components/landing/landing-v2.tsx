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

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { stashPendingIntake } from "@/components/landing/pending-intake";
import { AuthModal } from "@/components/auth/auth-modal";
import { StarburstSVG } from "@/components/landing/starburst-svg";
import { CardIcon } from "@/components/landing/card-icon";
import { TEMPLATE_META } from "@/components/landing/template-meta";
import { LandingHeader } from "@/components/landing/landing-header";
import {
  NotesIcon,
  VoiceIcon,
  PhotosIcon,
  PdfIcon,
  LinksIcon,
  DatasetsIcon,
  type LandingIcon,
} from "@/components/landing/landing-icons";
import { Mic, AppWindow, Users, type LucideIcon } from "lucide-react";

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

const INK = "#0B0B0C"; // cold near-black — landing is monochrome, do NOT warm

// Capability chips — grouped on a glass "tray" in the bring-data section, each
// with a soft accent spark (start-cta teal / product sky / brand terracotta).
const HERO_FEATURES: { label: string; color: string; Icon: LucideIcon }[] = [
  { label: "voice brainstorm", color: "#13A2B0", Icon: Mic },
  { label: "prototype on canvas", color: "#0EA5E9", Icon: AppWindow },
  { label: "team & friends", color: "#C2593B", Icon: Users },
];

// The headline's first noun cycles through the messy raw inputs you start with
// — "from <chaos> to value asap." Kept short + punchy; the rotator sizes to the
// active word (fluid) so the centred line just re-centres as it changes.
const HERO_WORDS = [
  "idea",
  "a hunch",
  "messy files",
  "100 tabs",
  "a voice note",
  "tangled thoughts",
];

/** Fluid word-rotator — swaps + animates the active word in (mount keyframe),
 *  sizing to that word so the headline breathes instead of reserving a slot. */
function HeroRotator({ words }: { words: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % words.length), 2400);
    return () => clearInterval(t);
  }, [words.length]);
  return (
    <span className="relative inline-block align-baseline" style={{ color: INK }} aria-live="polite">
      <span key={words[i]} className="inline-block" style={{ animation: "heroword 0.55s cubic-bezier(0.22,1,0.36,1)" }}>
        {words[i]}
      </span>
    </span>
  );
}

// ── Floating-card anchors ── positions for the 8-card swarm, expressed as
// percentages of a CENTRED max-width band (not the raw viewport) so the cards
// hug the hero on ultrawide screens instead of flinging to a lonely moat.
//
// Index maps 1:1 to the server's SWARM_ORDER. The composition is a balanced,
// MIRRORED scatter: lead cards top-L/R, a mid overlap PAIR on each side (a
// faded "depth" card behind a front card), and a bottom-L/R row.
//
// Design rules: every card lives in the LEFT/RIGHT gutter (never the centre
// column where the hero lives); a per-card base `rot` tilt + slight edge-bleed
// make it read as dropped-on-a-canvas; the `depth` cards (faded, scaled back,
// lower z) give the stacks real dimension.
type Anchor = {
  top: string;
  left?: string;
  right?: string;
  rot: number;
  z: number;
  drift: number;
  /** Base size multiplier — varies the cards so the swarm isn't uniform.
   *  Product Development is the largest (it's the emphasised card). */
  scale?: number;
  /** Faded card that sits behind its neighbour for depth. */
  depth?: boolean;
};
// A 3-band scatter (top corners · mid overlap-pairs · a lower row pulled IN
// toward the centre) so it reads less like two saturated side columns and the
// space BELOW the hero gets used. Sizes vary; Product Development is biggest.
const FLOATING_ANCHORS: Anchor[] = [
  { top: "10%", left: "12%", rot: -4, z: 2, drift: 1, scale: 0.88 }, // 0 · L top — Self-Discovery (pulled IN + smaller, like the lower row)
  { top: "9%", right: "12%", rot: 4, z: 2, drift: 2, scale: 0.88 }, // 1 · R top — Startup Strategy (pulled IN + smaller)
  { top: "36%", left: "7%", rot: -6, z: 1, drift: 6, scale: 0.82, depth: true }, // 2 · L mid BEHIND — Relationship Dynamics
  { top: "43%", left: "-3%", rot: 3, z: 3, drift: 3, scale: 1.0 }, // 3 · L mid FRONT — Research Project
  { top: "30%", right: "-3%", rot: 5, z: 3, drift: 7, scale: 1.2 }, // 4 · R mid FRONT — Product Development (BIG · emphasised)
  { top: "41%", right: "9%", rot: -4, z: 1, drift: 4, scale: 0.82, depth: true }, // 5 · R mid BEHIND — Reading Notes (depth)
  { top: "70%", left: "6%", rot: 4, z: 2, drift: 5, scale: 0.88 }, // 6 · lower-left — Team Retrospective (out + down to clear the centred chip row, still uncropped)
  { top: "71%", right: "5%", rot: -5, z: 2, drift: 1, scale: 0.86 }, // 7 · lower-right — Career Pivot
];

/** Open the hash-driven AuthModal (mounted below) on signup. */
function openSignup() {
  if (typeof window !== "undefined") window.location.hash = "signup";
}

/** Real Google Drive mark — the one live integration the hero touts, so the
 *  "bring data from anywhere" arc has a recognisable anchor among the
 *  content-type sources. */
function GoogleDriveMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 87.3 78" aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

// The input vocabulary surfaced in the bottom "bring data from anywhere" arc —
// the real content types you can feed in + the live Drive integration. Each
// gets a distinct colour so the fan reads as vivid as the reference (whose
// punch comes from varied brand logos) while staying honest to OUR inputs.
type Source =
  | { label: string; color: string; icon: LandingIcon }
  | { label: string; drive: true };
const SOURCES: Source[] = [
  { label: "Photos", color: "#db2777", icon: PhotosIcon },
  { label: "Voice", color: "#7c3aed", icon: VoiceIcon },
  { label: "Web", color: "#0891b2", icon: LinksIcon },
  { label: "Drive", drive: true }, // centre · real Google Drive logo
  { label: "PDFs", color: "#dc2626", icon: PdfIcon },
  { label: "Notes", color: "#d97706", icon: NotesIcon },
  { label: "Data", color: "#2563eb", icon: DatasetsIcon },
];

/** Bottom section — a fanned arc of input-source tiles over concentric ripple
 *  arcs, with a connector dropping from the swarm above. Communicates "feed it
 *  anything", echoing the reference's "connect data from anywhere" panel. */
function ConnectSources() {
  const mid = (SOURCES.length - 1) / 2;
  return (
    <section className="relative z-10 px-6 pb-20 pt-2">
      {/* Connector dropping in from the hero above, into the capability group. */}
      <div className="mx-auto h-6 w-px" style={{ background: "linear-gradient(to bottom, rgba(15,23,42,0) 0%, rgba(15,23,42,0.16) 100%)" }} />

      {/* Capability tray — a frosted glass pill GROUPING the three things
          akiboe does, so the dainty connector + ripples below read as flowing
          out of this group and down into the data sources. */}
      <div className="mx-auto w-fit max-w-[calc(100%-1rem)] rounded-full border border-white/70 bg-white/45 p-1.5 backdrop-blur-md shadow-[0_24px_46px_-22px_rgba(11,18,40,0.3),inset_0_1px_0_rgba(255,255,255,0.85)]">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {HERO_FEATURES.map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-medium ring-1 ring-black/[0.05] shadow-[0_2px_6px_-2px_rgba(11,18,40,0.18)]"
              style={{ color: appleVibe.text.secondary }}
            >
              <f.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: f.color }} strokeWidth={2} />
              {f.label}
            </span>
          ))}
        </div>
      </div>

      {/* Dainty connector from the group down into the source arc. */}
      <div className="mx-auto h-5 w-px" style={{ background: "rgba(15,23,42,0.16)" }} />
      <div className="mx-auto -mt-px mb-1 h-1.5 w-1.5 rounded-full" style={{ background: "rgba(15,23,42,0.4)" }} />

      {/* Arc of source tiles, sitting on faint concentric ripples that fan out
          from just under the capability group. */}
      <div className="relative mx-auto flex h-[150px] max-w-[680px] items-end justify-center">
        {/* Ripple arcs — concentric ellipses whose crests peek behind the fan. */}
        <svg
          aria-hidden
          viewBox="0 0 680 320"
          preserveAspectRatio="xMidYMax meet"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[300px] w-full"
        >
          {[120, 200, 280, 360].map((r, i) => (
            <ellipse
              key={r}
              cx={340}
              cy={330}
              rx={r}
              ry={r * 0.62}
              fill="none"
              stroke="rgba(15,23,42,0.12)"
              strokeWidth={1.2}
              style={{ opacity: 0.9 - i * 0.18 }}
            />
          ))}
        </svg>

        {/* The fan — each tile rides a dome (centre highest) + tilts outward. */}
        <div className="relative flex items-end gap-2.5 sm:gap-4">
          {SOURCES.map((s, i) => {
            const t = (i - mid) / mid; // -1 … 1
            const dome = -40 * (1 - t * t); // px, centre most-lifted
            const rot = t * 15;
            const isCentre = i === mid;
            return (
              <div
                key={s.label}
                className="flex flex-col items-center"
                style={{ transform: `translateY(${dome}px)` }}
              >
                <div
                  className="flex items-center justify-center rounded-[18px] bg-white ring-1 ring-black/[0.05] shadow-[0_8px_22px_-10px_rgba(11,18,40,0.3),inset_0_1px_0_rgba(255,255,255,0.9)]"
                  style={{
                    width: isCentre ? 64 : 56,
                    height: isCentre ? 64 : 56,
                    transform: `rotate(${rot}deg)`,
                  }}
                >
                  {"drive" in s ? (
                    <GoogleDriveMark />
                  ) : (
                    <s.icon className="h-7 w-7" style={{ color: s.color }} strokeWidth={2} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Copy. */}
      <div className="relative mx-auto mt-8 max-w-[560px] text-center">
        <h2
          className="text-[clamp(24px,3vw,34px)] font-extrabold leading-[1.06]"
          style={{ color: INK, fontFamily: appleVibe.font.display, letterSpacing: "-0.02em" }}
        >
          Bring data from anywhere
        </h2>
        <p className="mx-auto mt-2.5 max-w-[460px] text-[14.5px] leading-relaxed" style={{ color: appleVibe.text.tertiary }}>
          Notes, files, photos, voice, the web, and your Google&nbsp;Drive — drop it in and akiboe weaves it
          into one living map.
        </p>
      </div>
    </section>
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
        transform: `rotate(${anchor.rot}deg) scale(${anchor.scale ?? 1})`,
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
                {/* Slim footer — category as a tinted PILL in the regular sans
                    (not the display face). */}
                <div className="mt-auto pt-2.5">
                  <span
                    className="inline-flex w-fit items-center rounded-full px-2.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: banner, background: `${banner}1a` }}
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
                    className="inline-flex w-fit items-center rounded-full px-2.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: banner, background: `${banner}1a` }}
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
  // "start" drops you onto a whiteboard compose bar in place; typing + Enter
  // stashes a free-text "create" intake and opens signup — after auth /app
  // resumes it on a real board.
  const [composing, setComposing] = useState(false);
  const [prompt, setPrompt] = useState("");
  // Once they actually start typing, the hero morphs into a whiteboard the way
  // MinimalHome's objective chatbox does: the marketing copy + card swarm
  // recede and a dot-grid board surface rises, so it reads as "you're on the
  // board now." Enter → signup → /app resumes and the operations unfurl.
  const typing = composing && prompt.trim().length > 0;

  function pickTemplate(id: string) {
    if (id === "product_development") {
      // Synthetic card — no backing template, so seed a free-text intake.
      stashPendingIntake({
        kind: "create",
        prompt:
          "Help me develop my product: map the build from idea to shipped — discovery, design, engineering, release, and the feedback loops between them.",
        depth: "standard",
      });
    } else {
      stashPendingIntake({ kind: "template", templateId: id });
    }
    openSignup();
  }

  function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;
    stashPendingIntake({ kind: "create", prompt: text, depth: "standard" });
    openSignup();
  }

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-x-hidden"
      style={{
        background: "#F7F8FA",
        // Faint tldraw dot grid spanning the WHOLE page (the hero glow lives on
        // the hero stage below so it tracks the hero, not the taller page).
        backgroundImage:
          surface === "whiteboard"
            ? "radial-gradient(circle, rgba(15,23,42,0.06) 1.1px, transparent 1.5px)"
            : undefined,
        backgroundSize: surface === "whiteboard" ? "26px 26px" : undefined,
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
            /* Headline word swap — fades + lifts each new word in. */
            @keyframes heroword {
              from { opacity: 0; transform: translateY(0.32em); }
              to { opacity: 1; transform: translateY(0); }
            }
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

      {/* ── Hero stage ── holds the header + hero + swarm. Scoped (not the whole
          page) so the swarm's `inset-0` covers only this screen and the glow
          tracks the hero. Slightly under one viewport (88vh) so the "bring data"
          section peeks up sooner instead of sitting a full screen down. */}
      <div
        className="relative flex min-h-[88vh] flex-col overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(56% 48% at 50% 42%, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0) 72%)",
        }}
      >
      {/* Whiteboard surface — fades in the moment they start typing, turning
          the hero into the board they're composing on (mirrors MinimalHome's
          objective chatbox morph). Sits above the dimmed swarm, below the
          chatbox (main z-40). */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-[12] transition-opacity duration-500 ${
          typing ? "opacity-100" : "opacity-0"
        }`}
        style={{
          backgroundColor: "#F7F8FA",
          backgroundImage:
            "radial-gradient(circle, rgba(15,23,42,0.10) 1.2px, transparent 1.5px)",
          backgroundSize: "24px 24px",
        }}
      />
      <LandingHeader
        active="Home"
        subtitle="#1 AI whiteboard space to improve quality of thought"
      />

      {/* ── Hero (centre column). Rises ABOVE the swarm while composing so the
          whiteboard input is never occluded by the floating cards. ── */}
      <main
        className={`relative flex flex-1 flex-col items-center justify-center px-6 pb-2 ${
          composing ? "z-40" : "z-10"
        }`}
      >
        {/* Marketing headline — recedes once they start typing so the board
            (and their own words in the chatbox) become the whole focus. Kept
            in layout (opacity, not display) so the chatbox doesn't jump. */}
        <div
          className={`flex flex-col items-center transition-all duration-500 ${
            typing ? "pointer-events-none -translate-y-3 opacity-0" : "opacity-100"
          }`}
        >
          <h1
            className="text-center text-[clamp(34px,4.8vw,54px)] font-extrabold leading-[1.02]"
            style={{ fontFamily: appleVibe.font.display, letterSpacing: "-0.025em" }}
          >
            <span style={{ color: appleVibe.text.faint }}>From</span>{" "}
            <HeroRotator words={HERO_WORDS} />
          </h1>

          {/* Negative margin pulls the headings toward the mark (4:3 box slack). */}
          <div className="mx-auto -my-5 w-full max-w-[372px]">
            <Starburst3D />
          </div>

          <h1
            className="text-center text-[clamp(34px,4.8vw,54px)] font-extrabold leading-[1.02]"
            style={{ color: INK, fontFamily: appleVibe.font.display, letterSpacing: "-0.025em" }}
          >
            <span style={{ color: appleVibe.text.faint }}>to</span>{" "}
            <span style={{ color: INK }}>
              value{" "}
              <span
                className="underline decoration-[3px] underline-offset-[7px]"
                style={{ textDecorationColor: "#C2593B" }}
              >
                asap
              </span>
            </span>
            <span style={{ color: "#C2593B" }}>.</span>
          </h1>
        </div>

        {!composing ? (
          <>
            <button
              type="button"
              onClick={() => setComposing(true)}
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
          </>
        ) : (
          // Whiteboard compose bar — typing here + Enter stashes the idea and
          // opens signup (you "save your board" by signing in).
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPrompt();
            }}
            className="mt-7 w-full max-w-[520px]"
          >
            <div className="flex items-center gap-2 rounded-full border border-black/[0.07] bg-white px-2.5 py-2 shadow-[0_22px_50px_-24px_rgba(11,18,40,0.45),inset_0_1px_0_rgba(255,255,255,0.9)]">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ color: appleVibe.text.faint }}
              >
                <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M14.5 6.5 8.7 12.3a2 2 0 0 0 2.8 2.8l5.3-5.3a3.6 3.6 0 0 0-5-5l-6 6a5.2 5.2 0 0 0 7.4 7.4l4.3-4.3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <input
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Type an idea, question, or research goal…"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
                style={{ color: INK }}
              />
              <button
                type="submit"
                aria-label="Start"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
                style={{ background: INK }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="mt-3 text-center text-[12px]" style={{ color: appleVibe.text.faint }}>
              press <span className="font-semibold" style={{ color: appleVibe.text.tertiary }}>enter</span> — you&apos;ll sign in to save your board
            </div>
          </form>
        )}
      </main>

      {/* ── Floating template swarm ──
          z-20 (above the hero) so each card actually receives :hover — that's
          what drives the flip. The layer is pointer-events-none and only the
          cards opt back in, so the centred CTA stays clickable straight through.
          Cards live inside a centred max-width band so they hug the hero on
          wide monitors instead of drifting to the edges. */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 flex justify-center px-4 transition-opacity duration-500 ${
          typing ? "opacity-0" : composing ? "opacity-20" : "opacity-100"
        }`}
      >
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
      </div>
      {/* ── End hero stage ── */}

      {/* ── Bottom: bring data from anywhere (input sources) ── */}
      <ConnectSources />

      {/* Hash-driven signup/login popover — #signup / #signin open it. */}
      <AuthModal />
    </div>
  );
}
