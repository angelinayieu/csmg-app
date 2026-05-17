"use client";

// ── Twin-domain icon set ────────────────────────────────────────────
//
// Custom SVG icons for the Digital Twin Detail Page + related
// surfaces. Same family as src/components/canvas/icons/index.tsx —
// thin geometric stroke, 16×16 viewBox, currentColor, no
// iconographic clichés (no eyes for "observation", no heartbeats
// for "health", no gears for "mechanism", no exclamation marks for
// "pain").
//
// Every icon:
//   • is 16×16 viewBox, normalized so size=12/14/16 swap freely
//   • uses currentColor for stroke and fill, so it tints from context
//   • stroke 1.5 with round caps/joins, matching the design system
//   • is geometric/minimal — apple-tier restraint, no emojis

import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

function svg(props: IconProps & { children: React.ReactNode }) {
  const { size = 12, children, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── Twin domain ─────────────────────────────────────────────────────

/** Twin overall — two diamond outlines, second rotated 45° from the
 *  first, suggests "facets of the same thing" rather than the cliché
 *  two-circles-overlapping. */
export function TwinIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 1.5 L 14.5 8 L 8 14.5 L 1.5 8 Z" opacity="0.55" />
        <path
          d="M3.5 3.5 L 12.5 3.5 L 12.5 12.5 L 3.5 12.5 Z"
          transform="rotate(45 8 8)"
        />
      </>
    ),
  });
}

/** System model — three nested concentric hexagons. Stratification
 *  + boundedness without the gear cliché. Reads as "the system is
 *  composed of layers within layers." */
export function SystemModelIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 1.5 L 14 5 L 14 11 L 8 14.5 L 2 11 L 2 5 Z" />
        <path d="M8 4 L 12 6.3 L 12 9.7 L 8 12 L 4 9.7 L 4 6.3 Z" opacity="0.55" />
        <path d="M8 6.5 L 10 7.6 L 10 8.4 L 8 9.5 L 6 8.4 L 6 7.6 Z" opacity="0.3" />
      </>
    ),
  });
}

/** Pain point — a wedge with a notch cut into its base. "Where
 *  reality catches and snags." No analog in standard icon sets;
 *  intentionally novel so it reads as a domain primitive. */
export function PainIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 2 L 14 13 L 10 13 L 9 11 L 7 11 L 6 13 L 2 13 Z" />
      </>
    ),
  });
}

/** Mechanism — small open circle with a curved arrow tail looping
 *  back. Cycle, but cleaner than RotateCw or a literal loop. */
export function MechanismIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M11.5 5.5 Q 14 8 11.5 10.5" />
        <path d="M10 9.5 L 11.5 10.5 L 12.5 9" />
      </>
    ),
  });
}

/** Layer — horizontal lines with progressively lighter opacity going
 *  down. Vertical stratification suggesting depth. */
export function LayerIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2 3 L 14 3" />
        <path d="M2 7 L 14 7" opacity="0.75" />
        <path d="M2 11 L 14 11" opacity="0.5" />
        <path d="M2 14 L 14 14" opacity="0.25" />
      </>
    ),
  });
}

/** Observation — a single filled dot inside two concentric rings.
 *  "A moment captured against the field." Not an eye, not a
 *  magnifying glass. */
export function ObservationIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="6" opacity="0.4" />
        <circle cx="8" cy="8" r="3.5" />
        <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

/** Pain reduction — wedge narrowing rightward with anchor dots.
 *  Compression of pain over time. Reads as "the trend is down." */
export function PainReductionIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="2.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
        <path d="M3 5 L 13 7" />
        <path d="M3 11 L 13 9" />
        <circle cx="13.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

/** Calibration — crosshair with one dotted arc completing a circle.
 *  "Aligning toward truth." Distinct from a plain target. */
export function CalibrationIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 2 L 8 14" />
        <path d="M2 8 L 14 8" />
        <circle cx="8" cy="8" r="4" strokeDasharray="1.5 1.5" />
      </>
    ),
  });
}

/** Apps as interventions — square outline with a force-vector arrow
 *  piercing one edge. Container + intent. */
export function InterventionAppIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 5.5 L 3 13 L 11 13 L 11 5.5 L 7 5.5" />
        <path d="M11 8 L 14.5 8" />
        <path d="M13 6.5 L 14.5 8 L 13 9.5" />
      </>
    ),
  });
}

/** Apps as twin visualizations — same square container but with a
 *  dotted boundary (suggesting "depiction, not action") and a small
 *  inner glyph echoing the twin diamond. */
export function VisualizationAppIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2.5 2.5 L 13.5 2.5 L 13.5 13.5 L 2.5 13.5 Z" strokeDasharray="2 1.5" />
        <path d="M8 5 L 11 8 L 8 11 L 5 8 Z" />
      </>
    ),
  });
}

/** Snapshot — bracketed frame with an interior dot. "Freeze frame." */
export function SnapshotIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 4 L 3 2 L 5 2" />
        <path d="M13 4 L 13 2 L 11 2" />
        <path d="M3 12 L 3 14 L 5 14" />
        <path d="M13 12 L 13 14 L 11 14" />
        <circle cx="8" cy="8" r="2.5" />
      </>
    ),
  });
}

/** Prediction — a wedge fanning rightward with three internal rays.
 *  p10/p50/p90 forecast in pictorial form. */
export function PredictionIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none" />
        <path d="M3.5 8 L 13 4" opacity="0.4" />
        <path d="M3.5 8 L 13 8" />
        <path d="M3.5 8 L 13 12" opacity="0.4" />
      </>
    ),
  });
}

/** Goal — open ring with a small filled crescent at the top.
 *  "Toward the target." */
export function GoalIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5 A 5.5 5.5 0 0 1 13.5 8" strokeWidth="2.5" />
      </>
    ),
  });
}
