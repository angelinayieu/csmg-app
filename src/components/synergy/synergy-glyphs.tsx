// ── Synergy custom glyph library ──
//
// Thin-line SVG icons used across the Synergy strategy doc. These
// replace generic lucide icons (ArrowUp / ArrowDown / Target /
// Sparkles / Users) for the section headers and category accents.
//
// Each glyph is sized for 12–16px rendering, uses currentColor for
// stroke so it inherits text color, and has strokeWidth tuned to
// stay legible at small sizes without going heavy. The visual
// vocabulary is consistent: open shapes, one accent node, no fill
// except small solid dots that serve as anchors.

interface GlyphProps {
  className?: string;
  strokeWidth?: number;
}

// ── Inflow ──
// Three lines converging into a node. Reads as "things flowing in"
// — the right metaphor for an upstream / what-this-needs section.
export function InflowGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M2 4 L9.5 8" />
      <path d="M2 8 L9.5 8" />
      <path d="M2 12 L9.5 8" />
      <circle cx="11.25" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Outflow ──
// Mirror of inflow — a node fanning into three lines. Reads as
// "things this produces" for downstream sections.
export function OutflowGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="4.75" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <path d="M6.5 8 L14 4" />
      <path d="M6.5 8 L14 8" />
      <path d="M6.5 8 L14 12" />
    </svg>
  );
}

// ── Hazard ──
// Open triangle hairline with a small accent dot inside. Reads as
// "watch" without resorting to the loud filled-triangle alert
// metaphor.
export function HazardGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 2.5 L14 13 L2 13 Z" />
      <path d="M8 6.75 L8 10" />
      <circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Bet ──
// One origin node with two diverging paths terminating in open
// rings. Reads as "branching possibility" — what we're betting on
// (hypothesis). Replaces the AI-cliché Sparkles glyph.
export function BetGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="3" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4.5 7.4 L12.25 4.25" />
      <path d="M4.5 8.6 L12.25 11.75" />
      <circle cx="12.75" cy="4" r="1.1" />
      <circle cx="12.75" cy="12" r="1.1" />
    </svg>
  );
}

// ── Mesh ──
// Three small nodes arranged as a triangle, connected by thin
// edges. Reads as "network of collaborators" without resorting to
// a generic people silhouette.
export function MeshGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M4 11 L12 11" />
      <path d="M4 11 L8 4" />
      <path d="M12 11 L8 4" />
      <circle cx="4" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="4" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Step ──
// A tiny ringed node used as the anchor for plan steps. Exported
// for consistency though the plan step block currently renders it
// inline.
export function StepGlyph({ className, strokeWidth = 1.25 }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden
    >
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
