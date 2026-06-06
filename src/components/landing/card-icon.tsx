// ── Card icon: a meaning-first mark for each template ──
//
// Replaces the node-link `CardGlyph` "maps" in the landing cards with a clean,
// modern icon system. One coherent idea across all seven: a single bold
// monoline symbol of what the board is *for*, plus ONE filled "spark" in the
// template's own accent color — the one lit, load-bearing thing (the same
// motif as the hero starburst's lit node). Ink does the drawing; the accent
// does the meaning.
//
// Built to read at ~36px in a white rounded tile on the colored banner:
// few elements, bold 2.4 stroke, round caps. 48×48 viewBox, sized by caller.

import type { CSSProperties, ReactNode } from "react";

const INK = "#1b1a18";
/** Accent fallback if the caller passes nothing (landing always passes one). */
const ACCENT_FALLBACK = "#5856d6";

/** Per-template marks. `acc` = the template accent (the single spark color). */
function marks(acc: string): Record<string, ReactNode> {
  const ink = {
    stroke: INK,
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return {
    // Journal · a fountain-pen nib — writing as the daily act; the accent
    // breather-hole is the lit point where reflection forms.
    journal_self_discovery: (
      <>
        <g {...ink}>
          <path d="M24 9 L31 28 L24 38 L17 28 Z" />
          <path d="M24 22 V33" />
        </g>
        <circle cx="24" cy="18" r="2.6" fill={acc} />
      </>
    ),

    // Reading · an open book with the accent idea rising above the spine —
    // many pages threaded into one cross-book insight.
    reading_synthesis: (
      <>
        <g {...ink}>
          <path d="M24 16 V37" />
          <path d="M24 16 C18 13 12 13 9 15 L9 34 C12 33 18 33 24 37" />
          <path d="M24 16 C30 13 36 13 39 15 L39 34 C36 33 30 33 24 37" />
        </g>
        <circle cx="24" cy="8.5" r="2.8" fill={acc} />
      </>
    ),

    // Research · a magnifier with the accent at the focal point — the
    // hypothesis brought into focus.
    research_project: (
      <>
        <g {...ink}>
          <circle cx="20" cy="20" r="9.5" />
          <path d="M27 27 L38 38" />
        </g>
        <circle cx="20" cy="20" r="3" fill={acc} />
      </>
    ),

    // Retro · a circular arrow looping back over the cycle; the accent at the
    // center is the one change to make next time.
    team_retro: (
      <>
        <g {...ink}>
          <path d="M35 24 A11 11 0 1 1 24 13" />
          <path d="M24 13 L28.5 11 M24 13 L26 17.5" />
        </g>
        <circle cx="24" cy="24" r="3" fill={acc} />
      </>
    ),

    // Career · a path forking; the accent marks the chosen new heading (the
    // pivot), the plain branch the road not taken.
    career_pivot: (
      <>
        <g {...ink}>
          <path d="M24 38 V27" />
          <path d="M24 27 L14 17" />
          <path d="M24 27 L33 15" />
        </g>
        <circle cx="33" cy="15" r="3" fill={acc} />
      </>
    ),

    // Startup · a rising trajectory off a baseline; the accent apex is the bet
    // — the structural forces resolved into one heading.
    startup_strategy: (
      <>
        <g {...ink}>
          <path d="M9 38 H15" />
          <path d="M11 35 C17 32 23 27 38 11" />
        </g>
        <circle cx="38" cy="11" r="3" fill={acc} />
      </>
    ),

    // Relationship · two interlocking circles; the accent at the overlap is
    // the shared dynamic — the one thing between you.
    relationship_dynamics: (
      <>
        <g {...ink}>
          <circle cx="19" cy="24" r="9" />
          <circle cx="29" cy="24" r="9" />
        </g>
        <circle cx="24" cy="24" r="2.8" fill={acc} />
      </>
    ),

    // Product development · blocks assembling into a product; the accent is the
    // keystone increment being shipped on top.
    product_development: (
      <>
        <g {...ink}>
          <rect x="10" y="26" width="11" height="11" rx="2.5" />
          <rect x="27" y="26" width="11" height="11" rx="2.5" />
          <rect x="18.5" y="11.5" width="11" height="11" rx="2.5" />
        </g>
        <circle cx="24" cy="17" r="2.6" fill={acc} />
      </>
    ),
  };
}

export function CardIcon({
  templateId,
  accent = ACCENT_FALLBACK,
  className,
  style,
}: {
  templateId: string;
  /** The template's accent color — drives the single "spark." */
  accent?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const set = marks(accent);
  const mark = set[templateId] ?? set.research_project;
  return (
    <svg
      viewBox="0 0 48 48"
      width="100%"
      height="100%"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      aria-hidden
    >
      {mark}
    </svg>
  );
}
