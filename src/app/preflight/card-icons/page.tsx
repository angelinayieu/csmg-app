// Preview of the new card marks (CardIcon) on the REAL landing card chrome.
//
// This reproduces the live landing-v2 card faithfully — same font, real
// taglines, the "akiboe team ✓" footer, the category pill — and changes ONLY
// the icon, so the icons can be judged exactly as they'll ship. The category
// pill is shown colored (the proposed change), tinted by each template accent.
//
// SAFE TO DELETE — exploration. Route: /preflight/card-icons

"use client";

import { appleVibe } from "@/lib/apple-vibe-tokens";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { CardIcon } from "@/components/landing/card-icon";

const INK = "#0B0B0C";

// The live carousel (page.tsx V2_CAROUSEL_IDS) + the 2 registry-only templates.
// name/tagline/category/accent are the REAL values from the template library.
const CARDS = [
  { id: "journal_self_discovery", name: "Self-Discovery Journal", tagline: "Daily journaling that asks better questions over time", category: "personal", accent: "#d97706" },
  { id: "reading_synthesis", name: "Reading Notes", tagline: "Turn scattered reading into cross-book insight", category: "research", accent: "#0891b2" },
  { id: "research_project", name: "Research Project", tagline: "Map your hypothesis, evidence, and next experiments", category: "research", accent: "#5856d6" },
  { id: "team_retro", name: "Retrospective", tagline: "Decompose what happened and what to do differently", category: "professional", accent: "#ea580c" },
  { id: "career_pivot", name: "Career Pivot", tagline: "Decompose the jump from where you are to where you want to be", category: "personal", accent: "#16a34a" },
  { id: "startup_strategy", name: "Startup Strategy", tagline: "Map the structural forces shaping your company", category: "professional", accent: "#0051ff" },
  { id: "relationship_dynamics", name: "Relationship Dynamics", tagline: "Understand a specific relationship more clearly", category: "relational", accent: "#db2777" },
];

/** Same monochrome seal as landing-v2. */
function VerifiedSeal() {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden style={{ display: "block" }}>
      <circle cx={6} cy={6} r={6} fill={INK} />
      <path d="M3.5 6.2 L5.1 7.8 L8.5 4.2" fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A faithful copy of the landing-v2 card (collapsed, no hover decomposition). */
function RealCard({ card }: { card: (typeof CARDS)[number] }) {
  return (
    <div className="w-[260px] overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(11,18,40,0.04),0_16px_36px_-18px_rgba(11,18,40,0.22)] ring-1 ring-black/[0.04]">
      {/* Banner — real per-template color wash */}
      <div
        className="relative h-[76px] w-full"
        style={{ background: `linear-gradient(155deg, ${card.accent}26 0%, ${card.accent}0d 55%, #ffffff 100%)` }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{ background: "radial-gradient(120% 80% at 80% 0%, rgba(255,255,255,0.7), rgba(255,255,255,0) 60%)" }}
        />
        <div className="absolute left-3.5 top-3 flex items-center justify-center rounded-xl bg-white p-2 shadow-[0_2px_8px_-3px_rgba(11,18,40,0.18)] ring-1 ring-black/[0.06]">
          <div className="h-9 w-9">
            <CardIcon templateId={card.id} accent={card.accent} />
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="text-[14.5px] font-semibold leading-tight" style={{ color: appleVibe.text.primary }}>
          {card.name}
        </div>
        <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug" style={{ color: appleVibe.text.tertiary }}>
          {card.tagline}
        </div>

        {/* Verified footer — identical to landing-v2, with a COLORED pill */}
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: appleVibe.stroke.hairline }}>
          <div className="flex min-w-0 items-center gap-1.5">
            <InterAxisLogo className="h-[18px] w-[18px] shrink-0" size={36} style={{ borderRadius: 5 }} />
            <span className="whitespace-nowrap text-[11px] font-semibold tracking-[-0.01em]" style={{ color: appleVibe.text.secondary }}>
              akiboe team
            </span>
            <VerifiedSeal />
          </div>
          <span
            className="block shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: card.accent, background: `${card.accent}1a`, fontFamily: appleVibe.font.display }}
          >
            {card.category}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CardIconsPreflight() {
  return (
    <div className="min-h-screen px-10 py-12" style={{ background: "#F7F8FA", fontFamily: appleVibe.font.stack }}>
      <header className="mb-8">
        <h1 className="text-[24px] font-bold tracking-tight" style={{ color: INK }}>
          Card icons — clean set
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: appleVibe.text.tertiary }}>
          The real landing card, unchanged except the icon: one bold monoline mark + a single accent
          &ldquo;spark&rdquo; in the template color. Category pill shown colored.
        </p>
      </header>

      <div className="flex flex-wrap gap-6">
        {CARDS.map((c) => (
          <RealCard key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}
