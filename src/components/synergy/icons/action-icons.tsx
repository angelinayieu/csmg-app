// ── Custom action-popover icons ──
//
// Hand-drawn SVGs for the SynergyNodeActionPopover. Design rules:
//   - Monochrome: every stroke + fill resolves to `currentColor` so
//     the icon picks up the parent button's text color. The popover
//     drives color via Tailwind's text-gray-700 / text-gray-900 on
//     the parent button. No rainbow palette.
//   - Thin-weight strokes (1.4-1.6px) at 24×24 — Apple SF Symbol-ish
//   - Abstract, not literal: each icon is a geometric signature of
//     the mental model, not a pictogram (no clipboard, no magnifying
//     glass, etc.)
//   - Opacity-driven hierarchy: secondary shapes use 0.4-0.6 opacity
//     so the icon reads as one cohesive glyph rather than competing
//     elements
//
// All icons swap cleanly with lucide-sized slots elsewhere — pass
// className="text-gray-700" (or any text-* class) to set the color.

interface IconProps {
  className?: string;
  size?: number;
}

const COMMON_PROPS = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
};

// ── Decompose ──
// One whole on top, three discrete pieces below — "this becomes those."
export function DecomposeIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="9" y="2.5" width="6" height="6" rx="1.6" fill="currentColor" />
      <line
        x1="10.5"
        y1="9"
        x2="6"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="12"
        y1="9"
        x2="12"
        y2="17"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="13.5"
        y1="9"
        x2="18"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle cx="6" cy="18.5" r="2.2" fill="currentColor" fillOpacity="0.65" />
      <circle cx="12" cy="20" r="2.2" fill="currentColor" fillOpacity="0.65" />
      <circle cx="18" cy="18.5" r="2.2" fill="currentColor" fillOpacity="0.65" />
    </svg>
  );
}

// ── Variations ──
// One anchor, three fanning possibilities — variations on a theme.
export function VariationsIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <circle cx="12" cy="18.5" r="2.6" fill="currentColor" />
      <circle cx="5" cy="10" r="2.1" fill="currentColor" fillOpacity="0.65" />
      <circle cx="12" cy="6" r="2.1" fill="currentColor" fillOpacity="0.85" />
      <circle cx="19" cy="10" r="2.1" fill="currentColor" fillOpacity="0.55" />
      <path
        d="M 11 16.5 Q 8 13 6 11"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M 12 16 Q 12 11 12 8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M 13 16.5 Q 16 13 18 11"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
    </svg>
  );
}

// ── Questions ──
// A curling thought-trail landing on a single anchor dot.
export function QuestionsIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <path
        d="M 7.5 14 Q 7.5 6 12 6 Q 16.5 6 16.5 10 Q 16.5 13 12 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="19.5" r="1.8" fill="currentColor" />
    </svg>
  );
}

// ── Research ──
// A central node radiating outward — abstract beams, not a literal
// magnifying glass.
export function ResearchIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <line x1="12" y1="2.5" x2="12" y2="5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <line x1="12" y1="18.5" x2="12" y2="21.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <line x1="2.5" y1="12" x2="5.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <line x1="18.5" y1="12" x2="21.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <line x1="5.2" y1="5.2" x2="7.3" y2="7.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      <line x1="16.7" y1="7.3" x2="18.8" y2="5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      <line x1="5.2" y1="18.8" x2="7.3" y2="16.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
      <line x1="16.7" y1="16.7" x2="18.8" y2="18.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

// ── Plan (Make actionable) ──
// Three plan rows in descending length. The small triangle on the top
// row reads as a deliverable flag, not an arrow.
export function PlanIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="3" y="5" width="13" height="3.2" rx="1.6" fill="currentColor" />
      <polygon points="17,4 22,7 17,10" fill="currentColor" />
      <rect x="3" y="10.6" width="10" height="3.2" rx="1.6" fill="currentColor" fillOpacity="0.65" />
      <rect x="3" y="16.2" width="7" height="3.2" rx="1.6" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

// ── Rank ──
// Ascending rounded bars — reads as "podium," not "chart."
export function RankIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="3" y="14" width="4.5" height="7.5" rx="1.6" fill="currentColor" fillOpacity="0.45" />
      <rect x="9.75" y="9" width="4.5" height="12.5" rx="1.6" fill="currentColor" fillOpacity="0.7" />
      <rect x="16.5" y="4" width="4.5" height="17.5" rx="1.6" fill="currentColor" />
    </svg>
  );
}

// ── Tidy this subtree ──
// Concept: scattered ghost dots → snap into a clean radial. The
// solid dots are the "after" state; the faint outliers are what's
// being swept into place. Reads as "organize," not "delete."
export function TidyIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      {/* center anchor */}
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      {/* clean radial spokes — solid */}
      <circle cx="12" cy="4.5" r="1.4" fill="currentColor" fillOpacity="0.85" />
      <circle cx="19.5" cy="12" r="1.4" fill="currentColor" fillOpacity="0.85" />
      <circle cx="12" cy="19.5" r="1.4" fill="currentColor" fillOpacity="0.85" />
      <circle cx="4.5" cy="12" r="1.4" fill="currentColor" fillOpacity="0.85" />
      {/* connectors */}
      <line x1="12" y1="10" x2="12" y2="6" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.45" />
      <line x1="14" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.45" />
      <line x1="12" y1="14" x2="12" y2="18" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.45" />
      <line x1="10" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.45" />
      {/* ghost outliers — the messy "before" being snapped in */}
      <circle cx="6" cy="6.5" r="0.9" fill="currentColor" opacity="0.22" />
      <circle cx="18" cy="6.5" r="0.9" fill="currentColor" opacity="0.22" />
      <circle cx="6" cy="17.5" r="0.9" fill="currentColor" opacity="0.22" />
      <circle cx="18" cy="17.5" r="0.9" fill="currentColor" opacity="0.22" />
    </svg>
  );
}

// ── Describe (free-form input affordance) ──
// Three dots in a quote-bubble — natural-language entry.
export function DescribeIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <path
        d="M 4 4 L 20 4 Q 21 4 21 5 L 21 15 Q 21 16 20 16 L 12 16 L 8 20 L 8 16 L 4 16 Q 3 16 3 15 L 3 5 Q 3 4 4 4 Z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10" r="1.1" fill="currentColor" />
      <circle cx="12" cy="10" r="1.1" fill="currentColor" />
      <circle cx="16" cy="10" r="1.1" fill="currentColor" />
    </svg>
  );
}
