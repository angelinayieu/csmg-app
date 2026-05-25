// ── Annotation glyphs ──
//
// 12 small abstract SVGs that visually encode the structural shape
// of a concept. The LLM picks the one whose mental model best
// matches the annotated phrase. Rendered at 14-20px next to the
// phrase / inside the popover.
//
// Why glyphs over icons: icons label the literal thing ("a brain"
// for cognition). Glyphs label the STRUCTURE ("a loop" for any
// self-reinforcing system). After ~30 minutes on the canvas the
// user's eye learns "↻ = loop pattern", and the visual becomes
// faster than re-reading the prose.

import * as React from "react";

export type GlyphKind =
  | "loop"
  | "ladder"
  | "wedge"
  | "fan"
  | "well"
  | "bridge"
  | "net"
  | "funnel"
  | "spiral"
  | "mirror"
  | "wave"
  | "tree";

export const GLYPH_KINDS: GlyphKind[] = [
  "loop",
  "ladder",
  "wedge",
  "fan",
  "well",
  "bridge",
  "net",
  "funnel",
  "spiral",
  "mirror",
  "wave",
  "tree",
];

export const GLYPH_MEANINGS: Record<GlyphKind, string> = {
  loop: "Self-reinforcing cycle (habits, network effects, feedback)",
  ladder: "Discrete progression (levels, milestones, mastery)",
  wedge: "Compounding accumulation (growth, leverage, snowball)",
  fan: "One-to-many distribution (personalization, broadcasting)",
  well: "Going deep on one thing (depth, expertise, focus)",
  bridge: "Connecting two domains (translation, integration)",
  net: "Decentralized weave (community, peer learning)",
  funnel: "Conversion / narrowing (onboarding, filtering)",
  spiral: "Self-amplifying growth (learning curves, retention)",
  mirror: "Reflection / self-similarity (introspection, audit)",
  wave: "Cyclical / rhythmic (sleep, attention, mood)",
  tree: "Hierarchical branching (taxonomy, decomposition)",
};

interface Props {
  kind: GlyphKind;
  className?: string;
  size?: number;
  color?: string;
}

/**
 * Pure-SVG glyph. Stroke-based so it inherits color cleanly and
 * stays crisp at small sizes. ViewBox is 24×24 across all glyphs
 * for consistent baseline alignment.
 */
export function AnnotationGlyph({
  kind,
  className,
  size,
  color = "currentColor",
}: Props) {
  const w = size ?? 16;
  const common = {
    width: w,
    height: w,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  switch (kind) {
    case "loop":
      return (
        <svg {...common}>
          <path d="M7 12c0-3 2-5 5-5s5 2 5 5-2 5-5 5" />
          <path d="M14 14l3 3 0-3" />
        </svg>
      );
    case "ladder":
      return (
        <svg {...common}>
          <line x1="7" y1="4" x2="7" y2="20" />
          <line x1="17" y1="4" x2="17" y2="20" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="7" y1="16" x2="17" y2="16" />
        </svg>
      );
    case "wedge":
      return (
        <svg {...common}>
          <path d="M4 19 L14 19 L20 5 Z" />
        </svg>
      );
    case "fan":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.4" fill={color} />
          <line x1="7.4" y1="12" x2="18" y2="6" />
          <line x1="7.4" y1="12" x2="18" y2="12" />
          <line x1="7.4" y1="12" x2="18" y2="18" />
        </svg>
      );
    case "well":
      return (
        <svg {...common}>
          <line x1="6" y1="5" x2="6" y2="20" />
          <line x1="18" y1="5" x2="18" y2="20" />
          <path d="M6 5 Q12 9 18 5" />
          <line x1="9" y1="18" x2="15" y2="18" />
        </svg>
      );
    case "bridge":
      return (
        <svg {...common}>
          <circle cx="5" cy="14" r="2" />
          <circle cx="19" cy="14" r="2" />
          <path d="M5 14 Q12 4 19 14" />
        </svg>
      );
    case "net":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="1.2" fill={color} />
          <circle cx="18" cy="6" r="1.2" fill={color} />
          <circle cx="12" cy="12" r="1.2" fill={color} />
          <circle cx="6" cy="18" r="1.2" fill={color} />
          <circle cx="18" cy="18" r="1.2" fill={color} />
          <line x1="6" y1="6" x2="12" y2="12" />
          <line x1="18" y1="6" x2="12" y2="12" />
          <line x1="6" y1="18" x2="12" y2="12" />
          <line x1="18" y1="18" x2="12" y2="12" />
          <line x1="6" y1="6" x2="18" y2="6" />
          <line x1="6" y1="18" x2="18" y2="18" />
        </svg>
      );
    case "funnel":
      return (
        <svg {...common}>
          <path d="M4 5 H20 L14 13 V20 L10 20 V13 Z" />
        </svg>
      );
    case "spiral":
      return (
        <svg {...common}>
          <path d="M12 12 m0 0 a3 3 0 0 1 -3 -3 a5 5 0 0 1 5 -5 a7 7 0 0 1 7 7" />
        </svg>
      );
    case "mirror":
      return (
        <svg {...common}>
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
          <path d="M4 8 L9 12 L4 16" />
          <path d="M20 8 L15 12 L20 16" />
        </svg>
      );
    case "wave":
      return (
        <svg {...common}>
          <path d="M3 12 Q6 7 9 12 T15 12 T21 12" />
        </svg>
      );
    case "tree":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="1.5" fill={color} />
          <line x1="12" y1="6.5" x2="12" y2="11" />
          <line x1="12" y1="11" x2="6" y2="16" />
          <line x1="12" y1="11" x2="18" y2="16" />
          <circle cx="6" cy="17.5" r="1.5" fill={color} />
          <circle cx="18" cy="17.5" r="1.5" fill={color} />
        </svg>
      );
  }
}

/** Type guard usable when validating LLM output. */
export function isGlyphKind(v: unknown): v is GlyphKind {
  return typeof v === "string" && (GLYPH_KINDS as string[]).includes(v);
}
