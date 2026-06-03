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

import { appleVibe } from "@/lib/apple-vibe-tokens";
import { stashPendingIntake } from "@/components/landing/pending-intake";
import { AuthModal } from "@/components/auth/auth-modal";

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

// Per-position fan layout for the 5-card carousel. Index 2 is the
// elevated "featured" card; the outer two sit lower + recede.
const FAN = [
  { ty: 18, scale: 0.92, z: 10, op: 0.9 },
  { ty: 2, scale: 0.98, z: 20, op: 1 },
  { ty: -26, scale: 1.07, z: 30, op: 1 },
  { ty: 2, scale: 0.98, z: 20, op: 1 },
  { ty: 18, scale: 0.92, z: 10, op: 0.9 },
];

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
          {NAV.map((item) => (
            <a
              key={item}
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-[15px] font-medium underline decoration-1 underline-offset-[5px] transition-opacity hover:opacity-60"
              style={{ color: INK }}
            >
              {item}
            </a>
          ))}
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-2">
        <h1
          className="text-center text-[clamp(38px,5.4vw,54px)] font-semibold leading-[1.04]"
          style={{
            color: INK,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.02em",
          }}
        >
          from <span className="font-extrabold">idea</span>
        </h1>

        <Starburst />

        <h1
          className="text-center text-[clamp(38px,5.4vw,54px)] font-semibold leading-[1.04]"
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
          className="mt-9 rounded-full px-12 py-3.5 text-[18px] font-medium text-white shadow-[0_8px_24px_-10px_rgba(11,11,12,0.5)] transition-transform hover:scale-[1.03] active:scale-95"
          style={{ background: INK }}
        >
          Start
        </button>

        <div
          className="mt-4 text-[14px]"
          style={{ color: appleVibe.text.tertiary }}
        >
          sync tabs and google drive
        </div>
      </main>

      {/* ── Template carousel ── */}
      <section className="relative w-full px-6 pb-6">
        <div
          className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[32px] px-10 pb-9 pt-14"
          style={{ background: "#EEF0F3" }}
        >
          <div className="flex items-end justify-center">
            {cards.map((card, i) => {
              const l = FAN[i] ?? FAN[1];
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => pickTemplate(card.id)}
                  className="group relative mx-[-30px] w-[210px] shrink-0 text-left focus:outline-none"
                  style={{
                    transform: `translateY(${l.ty}px) scale(${l.scale})`,
                    zIndex: l.z,
                    opacity: l.op,
                  }}
                >
                  <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(11,18,40,0.04),0_18px_40px_-18px_rgba(11,18,40,0.28)] ring-1 ring-black/[0.04] transition-shadow duration-300 group-hover:shadow-[0_2px_2px_rgba(11,18,40,0.05),0_26px_50px_-18px_rgba(11,18,40,0.36)]">
                    {/* Image wash — accent-tinted placeholder. Swap for a
                        real photo by dropping /public/landing/{id}.jpg and
                        rendering it here. */}
                    <div
                      className="relative h-[112px] w-full"
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
                    </div>

                    <div className="px-3.5 pb-4 pt-3">
                      <div
                        className="text-[14px] font-semibold leading-tight"
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
                      <div
                        className="mt-3 text-[10px] font-bold tracking-[0.09em]"
                        style={{ color: card.accent }}
                      >
                        {card.category.toUpperCase()}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drag handle */}
          <div
            aria-hidden
            className="absolute bottom-4 left-1/2 h-[4px] w-20 -translate-x-1/2 rounded-full"
            style={{ background: "#1A1A1C" }}
          />
        </div>
      </section>

      {/* Hash-driven signup/login popover — #signup / #signin open it. */}
      <AuthModal />
    </div>
  );
}

// ── Starburst ──
// The "idea" node: a single filled hub with rays radiating out, a few
// terminating in dots. Hand-placed (no randomness) so SSR + client agree.
function Starburst() {
  const C = { x: 170, y: 105 };
  const dotted = [
    { x: 162, y: 12 }, // top
    { x: 272, y: 48 }, // upper-right
    { x: 322, y: 116 }, // far-right
    { x: 176, y: 196 }, // bottom
    { x: 24, y: 92 }, // far-left
  ];
  const lines = [
    { x: 96, y: 26 }, // upper-left
    { x: 74, y: 168 }, // lower-left
    { x: 256, y: 176 }, // lower-right
    { x: 210, y: 36 }, // inner upper-right
  ];

  return (
    <svg
      width={340}
      height={210}
      viewBox="0 0 340 210"
      className="my-1"
      aria-hidden
    >
      {[...dotted, ...lines].map((p, i) => (
        <line
          key={i}
          x1={C.x}
          y1={C.y}
          x2={p.x}
          y2={p.y}
          stroke={INK}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ))}
      {dotted.map((p, i) => (
        <circle key={`d${i}`} cx={p.x} cy={p.y} r={5} fill={INK} />
      ))}
      <circle cx={C.x} cy={C.y} r={7} fill={INK} />
    </svg>
  );
}
