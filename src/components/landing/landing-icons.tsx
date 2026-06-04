// ── Landing icons (custom line set) ──
//
// Hand-drawn, on-brand line icons for the V2 landing card chips. Same "pen"
// as the hero starburst + card glyphs: `currentColor` stroke, round caps +
// joins, 24×24 viewBox — so each is tintable by the card accent (the caller
// passes `style={{ color: accent }}`, exactly like lucide) and reads as one
// hand across the page.
//
// API-COMPATIBLE WITH lucide: same `{ className, style, strokeWidth }` props,
// so `card-decomposition.tsx` needs zero changes and `template-meta.ts` can
// mix custom + lucide during rollout.
//
// Phase 1 set (11): inputs Notes · Voice · Photos · PDFs · Links · Datasets;
// outputs (the 5 "Map" glyphs that used to all be one lucide `Network`)
// PatternMap · ConceptMap · HypothesisMap · CauseMap · SkillGapMap.

import type { CSSProperties, ReactNode } from "react";

export interface LandingIconProps {
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

/** Type matching lucide's component shape closely enough to be a drop-in. */
export type LandingIcon = (props: LandingIconProps) => ReactNode;

function Base({
  className,
  style,
  strokeWidth = 2,
  children,
}: LandingIconProps & { children: ReactNode }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const dot = (cx: number, cy: number, r = 1.4) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

// ── Inputs ──

/** A sticky page with a dog-eared corner + two text lines. */
export function NotesIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M7 4 H14 L18 8 V20 H7 Z" />
      <path d="M14 4 V8 H18" />
      <path d="M9.5 12 H15" />
      <path d="M9.5 15.2 H13.5" />
    </Base>
  );
}

/** A sound waveform (not a plain mic) — five rounded bars. */
export function VoiceIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M5.5 10 V14" />
      <path d="M9 7.5 V16.5" />
      <path d="M12 5 V19" />
      <path d="M15 8 V16" />
      <path d="M18.5 10.5 V13.5" />
    </Base>
  );
}

/** A photo stack — front frame (sun + ridge) with a second frame behind. */
export function PhotosIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M8 5 H20 V16" />
      <path d="M4 8 H16 V20 H4 Z" />
      {dot(7.5, 11, 1.3)}
      <path d="M4 17.5 L8 13.5 L10.5 16 L13 13 L16 16.5" />
    </Base>
  );
}

/** A two-page document stack (distinct from a single Note). */
export function PdfIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M10 3 H16 L19 6 V18" />
      <path d="M5 6 H12 L15 9 V21 H5 Z" />
      <path d="M12 6 V9 H15" />
      <path d="M7.5 13 H12.5" />
      <path d="M7.5 16 H11" />
    </Base>
  );
}

/** Two interlocking capsule links (a chain). */
export function LinksIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <rect x="3.5" y="9" width="11" height="6" rx="3" />
      <rect x="9.5" y="9" width="11" height="6" rx="3" />
    </Base>
  );
}

/** A data table with a second sheet stacked behind it. */
export function DatasetsIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M8 5 H21 V18" />
      <rect x="3.5" y="8" width="14.5" height="12" rx="1.5" />
      <path d="M10.7 8 V20" />
      <path d="M3.5 12 H18" />
      <path d="M3.5 16 H18" />
    </Base>
  );
}

// ── Output "Map" glyphs (each a distinct node/edge silhouette) ──

/** Pattern Map — a radial hub-and-spoke (rhymes with the hero starburst). */
export function PatternMapIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M12 12 L12 5.2" />
      <path d="M12 12 L18.3 8.2" />
      <path d="M12 12 L17.4 17.6" />
      <path d="M12 12 L6.2 17.8" />
      <path d="M12 12 L4.6 11" />
      {dot(12, 12, 1.8)}
      {dot(12, 4.6, 1.3)}
      {dot(19, 7.7, 1.3)}
      {dot(18, 18.3, 1.3)}
      {dot(5.6, 18.4, 1.3)}
      {dot(4, 10.8, 1.3)}
    </Base>
  );
}

/** Concept Map — a clean linked triad with one branch (not a busy mesh). */
export function ConceptMapIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M7 7.5 L16.5 9" />
      <path d="M7 7.5 L10.5 17.5" />
      <path d="M16.5 9 L10.5 17.5" />
      <path d="M16.5 9 L19.5 16.5" />
      {dot(7, 7.5)}
      {dot(16.5, 9)}
      {dot(10.5, 17.5)}
      {dot(19.5, 16.5, 1.2)}
    </Base>
  );
}

/** Hypothesis Map — three sources converging into one central node. */
export function HypothesisMapIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M5 5.8 L13.6 11.3" />
      <path d="M4.4 13 L13.8 12" />
      <path d="M5.6 19.4 L13.6 12.7" />
      {dot(4.6, 5.4, 1.3)}
      {dot(4, 13, 1.3)}
      {dot(5.2, 19.6, 1.3)}
      {dot(15.5, 12, 2)}
    </Base>
  );
}

/** Cause Map — a fishbone (Ishikawa): a spine into the effect node, with
 *  diagonal "cause" bones branching off it. */
export function CauseMapIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M3.5 12 H17" />
      <path d="M6.5 7.5 L8.5 12" />
      <path d="M11 7.5 L13 12" />
      <path d="M9 16.5 L11 12" />
      {dot(19, 12, 1.7)}
    </Base>
  );
}

/** Skill-Gap Map — current + target nodes with a bridged gap between them. */
export function SkillGapMapIcon(p: LandingIconProps) {
  return (
    <Base {...p}>
      <path d="M7 13 H10.4" />
      <path d="M13.6 13 H17" />
      <path d="M8 11.2 Q12 5.6 16 11.2" />
      {dot(5, 13, 1.6)}
      {dot(19, 13, 1.6)}
    </Base>
  );
}
