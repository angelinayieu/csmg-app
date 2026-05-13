// ── Custom action-popover icons ──
//
// Hand-drawn SVGs for the SynergyNodeActionPopover. Designed to be:
//   - Minimal: 6-10 shape elements each, no detail rendering at <16px
//   - Cute: rounded line caps + soft shapes (no sharp pictograms)
//   - Distinct: one accent color + a unique geometric signature per
//     icon, so each tile reads at a glance
//   - Innovative: NOT a literal pictogram (no magnifying glass for
//     "research", no clipboard for "plan") — instead each is an
//     abstraction of the underlying mental model
//
// All icons use a 24×24 viewBox so they swap cleanly into existing
// lucide-sized slots elsewhere. The accent color is hardcoded per
// icon so the popover tile background stays neutral and the icon
// carries the chromatic identity.

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
// Concept: one whole on top, three discrete pieces below. The
// connecting lines hint at "this becomes those." Indigo because
// decomposition is structural — it surfaces the skeleton.
export function DecomposeIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="9" y="2.5" width="6" height="6" rx="1.6" fill="#4f46e5" />
      <line
        x1="10.5"
        y1="9"
        x2="6"
        y2="16"
        stroke="#4f46e5"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="12"
        y1="9"
        x2="12"
        y2="17"
        stroke="#4f46e5"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="13.5"
        y1="9"
        x2="18"
        y2="16"
        stroke="#4f46e5"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle cx="6" cy="18.5" r="2.2" fill="#4f46e5" fillOpacity="0.7" />
      <circle cx="12" cy="20" r="2.2" fill="#4f46e5" fillOpacity="0.7" />
      <circle cx="18" cy="18.5" r="2.2" fill="#4f46e5" fillOpacity="0.7" />
    </svg>
  );
}

// ── Variations ──
// Concept: one anchor, multiple parallel possibilities fanning up.
// The three dots have a slight asymmetric arc — not perfectly
// symmetric — which reads more playful than mechanical.
export function VariationsIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      {/* anchor */}
      <circle cx="12" cy="18.5" r="2.6" fill="#d946ef" />
      {/* fan dots */}
      <circle cx="5" cy="10" r="2.1" fill="#d946ef" fillOpacity="0.72" />
      <circle cx="12" cy="6" r="2.1" fill="#d946ef" fillOpacity="0.85" />
      <circle cx="19" cy="10" r="2.1" fill="#d946ef" fillOpacity="0.6" />
      {/* slim connectors */}
      <path
        d="M 11 16.5 Q 8 13 6 11"
        stroke="#d946ef"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M 12 16 Q 12 11 12 8"
        stroke="#d946ef"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M 13 16.5 Q 16 13 18 11"
        stroke="#d946ef"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.4"
        fill="none"
      />
    </svg>
  );
}

// ── Questions ──
// Concept: a curling thought-trail that lands on a single anchor
// dot. Reads as "wondering, then landing." Amber because questions
// are a warm prompt, not a cold demand.
export function QuestionsIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <path
        d="M 7.5 14 Q 7.5 6 12 6 Q 16.5 6 16.5 10 Q 16.5 13 12 14"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="19.5" r="1.8" fill="#f59e0b" />
    </svg>
  );
}

// ── Research ──
// Concept: a central node radiating outward — search beams, but
// abstract. Purple because research feels deep / introspective.
// Eight rays with alternating opacity for visual rhythm.
export function ResearchIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <circle cx="12" cy="12" r="3" fill="#a855f7" />
      {/* cardinal rays — stronger */}
      <line x1="12" y1="2.5" x2="12" y2="5.5" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      <line x1="12" y1="18.5" x2="12" y2="21.5" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      <line x1="2.5" y1="12" x2="5.5" y2="12" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      <line x1="18.5" y1="12" x2="21.5" y2="12" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      {/* diagonal rays — softer */}
      <line x1="5.2" y1="5.2" x2="7.3" y2="7.3" stroke="#a855f7" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <line x1="16.7" y1="7.3" x2="18.8" y2="5.2" stroke="#a855f7" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <line x1="5.2" y1="18.8" x2="7.3" y2="16.7" stroke="#a855f7" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <line x1="16.7" y1="16.7" x2="18.8" y2="18.8" stroke="#a855f7" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

// ── Plan (Make actionable) ──
// Concept: three plan rows in descending length, with a small
// triangle on the top row signaling "ready to ship." Sky because
// plans are forward-looking. The triangle is the only "iconic"
// element and is so small it reads as a tag, not an arrow.
export function PlanIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="3" y="5" width="13" height="3.2" rx="1.6" fill="#0ea5e9" />
      <polygon points="17,4 22,7 17,10" fill="#0ea5e9" />
      <rect x="3" y="10.6" width="10" height="3.2" rx="1.6" fill="#0ea5e9" fillOpacity="0.7" />
      <rect x="3" y="16.2" width="7" height="3.2" rx="1.6" fill="#0ea5e9" fillOpacity="0.45" />
    </svg>
  );
}

// ── Rank ──
// Concept: ascending bars — but with rounded tops so it reads
// "podium" rather than "chart." Orange because ranking is a hot
// signal (winner, prominence).
export function RankIcon({ className, size = 28 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <rect x="3" y="14" width="4.5" height="7.5" rx="1.6" fill="#f97316" fillOpacity="0.5" />
      <rect x="9.75" y="9" width="4.5" height="12.5" rx="1.6" fill="#f97316" fillOpacity="0.78" />
      <rect x="16.5" y="4" width="4.5" height="17.5" rx="1.6" fill="#f97316" />
    </svg>
  );
}

// ── Describe (the escape-hatch icon next to the text input) ──
// Concept: three dots in a quote-bubble shape — represents free-
// form natural-language input. Neutral gray since this is a
// "anything goes" affordance rather than a typed action.
export function DescribeIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...COMMON_PROPS} width={size} height={size} className={className}>
      <path
        d="M 4 4 L 20 4 Q 21 4 21 5 L 21 15 Q 21 16 20 16 L 12 16 L 8 20 L 8 16 L 4 16 Q 3 16 3 15 L 3 5 Q 3 4 4 4 Z"
        fill="#6b7280"
        fillOpacity="0.15"
        stroke="#6b7280"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10" r="1.1" fill="#6b7280" />
      <circle cx="12" cy="10" r="1.1" fill="#6b7280" />
      <circle cx="16" cy="10" r="1.1" fill="#6b7280" />
    </svg>
  );
}
