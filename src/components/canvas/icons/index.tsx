"use client";

// Custom SVG icons for the rail + probe trail + stage rooms.
//
// Every icon:
//   • is 16×16 viewBox, normalized so size=11 / size=13 swap freely
//   • uses currentColor for stroke and fill, so it tints from context
//   • stroke 1.5 with round caps/joins, matching the design system
//   • is geometric/minimal — never iconographic clichés (no flasks
//     for "lab", no light bulbs for "idea")
//
// Naming convention: <Domain><Concept>Icon.
// Imports stay tight: import { ProbeOriginIcon } from "@/components/canvas/icons";

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

// ── Probe trail step icons ─────────────────────────────────────────

/** Probe origin — focused signal: dot inside a thin ring. */
export function ProbeOriginIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

/** Decompose step — three diverging hairlines from a single point. */
export function DecomposeStepIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="3" cy="8" r="1.4" fill="currentColor" stroke="none" />
        <path d="M4.4 8 L13 4" />
        <path d="M4.4 8 L13 8" />
        <path d="M4.4 8 L13 12" />
      </>
    ),
  });
}

/** Search step — slim arc with a tail (a "throw" outward). */
export function SearchStepIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3.5 11 Q 8 3 13 7" />
        <path d="M11 5 L 13 7 L 11 9" />
      </>
    ),
  });
}

/** Result terminal — hexagon outline with single inner dot ("crystal"). */
export function ResultTerminalIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 2 L13.2 5 L13.2 11 L8 14 L2.8 11 L2.8 5 Z" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

/** Reasoning/decompose intermediate — a small node with three radiating ticks. */
export function ReasoningStepIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 4.5 L 8 2.5" />
        <path d="M11.5 8 L 13.5 8" />
        <path d="M5.4 10.6 L 3.5 12.5" />
      </>
    ),
  });
}

// ── Mode / intent icons ────────────────────────────────────────────

/** Add — single concept landing. Plus inside a soft frame. */
export function ModeAddIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
        <path d="M8 5.5 L 8 10.5" />
        <path d="M5.5 8 L 10.5 8" />
      </>
    ),
  });
}

/** Decompose — fanning tree from a root node (the substrate-build mode). */
export function ModeDecomposeIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="3.2" r="1.4" fill="currentColor" stroke="none" />
        <path d="M8 4.6 L 8 7" />
        <path d="M8 7 L 4 11" />
        <path d="M8 7 L 12 11" />
        <circle cx="4" cy="12.4" r="1.2" />
        <circle cx="12" cy="12.4" r="1.2" />
      </>
    ),
  });
}

/** Solve — converging arrows meeting at a point (use-the-graph mode). */
export function ModeSolveIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2 3 L 7.5 8" />
        <path d="M14 3 L 8.5 8" />
        <path d="M8 14 L 8 9" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

/** Probe — focused inquiry: ring with a leading dot. */
export function ModeProbeIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="6.5" cy="6.5" r="3.6" />
        <path d="M9.4 9.4 L 13 13" />
        <circle cx="6.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

// ── Diverge / converge ─────────────────────────────────────────────

export function DivergeForkIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2 8 L 6 8" />
        <path d="M6 8 L 13 3" />
        <path d="M6 8 L 13 8" />
        <path d="M6 8 L 13 13" />
        <path d="M11 1.4 L 13 3 L 11.4 4.8" />
        <path d="M11 6.4 L 13 8 L 11 9.6" />
        <path d="M11 11.4 L 13 13 L 11.4 14.6" />
      </>
    ),
  });
}

export function ConvergeMergeIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 3 L 10 8" />
        <path d="M3 8 L 10 8" />
        <path d="M3 13 L 10 8" />
        <path d="M10 8 L 14 8" />
        <path d="M12 6 L 14 8 L 12 10" />
      </>
    ),
  });
}

// ── Stage-room icons ───────────────────────────────────────────────

/** Intake — a downward funnel (capturing). */
export function IntakeRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2.5 3 L 13.5 3 L 9.5 8.5 L 9.5 13 L 6.5 13 L 6.5 8.5 Z" />
      </>
    ),
  });
}

/** Landscape — a fan of three lines from origin (probability spaces). */
export function LandscapeRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="13" r="1.2" fill="currentColor" stroke="none" />
        <path d="M8 11.6 L 3 3" />
        <path d="M8 11.6 L 8 2" />
        <path d="M8 11.6 L 13 3" />
        <path d="M3 3 A 5 9 0 0 1 13 3" strokeDasharray="1.4 1.4" />
      </>
    ),
  });
}

/** KG — a graph node with two connecting nodes (the substrate). */
export function KgRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="4" r="1.6" />
        <circle cx="3.5" cy="12" r="1.6" />
        <circle cx="12.5" cy="12" r="1.6" />
        <path d="M7.4 5.4 L 4.5 10.4" />
        <path d="M8.6 5.4 L 11.5 10.4" />
        <path d="M5 12 L 11 12" strokeDasharray="1.4 1.4" />
      </>
    ),
  });
}

/** Proposal — the converge mark, simplified (ranked strategies). */
export function ProposalRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 3 L 8 8 L 13 3" />
        <path d="M8 8 L 8 13" />
        <path d="M5.5 13 L 10.5 13" />
      </>
    ),
  });
}

/** Lab — translucent chamber outline (isometric box). */
export function LabRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M4 5.5 L 8 3.5 L 12 5.5 L 12 11.5 L 8 13.5 L 4 11.5 Z" />
        <path d="M8 3.5 L 8 7.5" />
        <path d="M4 5.5 L 8 7.5 L 12 5.5" />
      </>
    ),
  });
}

/** Results — a check inside a circle, but the check is asymmetric to feel hand-drawn. */
export function ResultsRoomIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M5 8.4 L 7.2 10.4 L 11 6" />
      </>
    ),
  });
}

// ── Misc canvas vocabulary ─────────────────────────────────────────

/** North star — strategy / locked active. Star with a horizontal underline. */
export function NorthStarIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 2 L 9.4 6.6 L 14 6.8 L 10.4 9.6 L 11.6 14 L 8 11.4 L 4.4 14 L 5.6 9.6 L 2 6.8 L 6.6 6.6 Z" />
      </>
    ),
  });
}

/** Cycle — a curl that loops back with a notch (reinforcing loop). */
export function CycleIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M11.5 5 A 4.5 4.5 0 1 0 13 8.5" />
        <path d="M11 3.4 L 13 5 L 14.5 3" />
      </>
    ),
  });
}

/** Stale flag — circle with a small inset gap (a "broken seal"). */
export function StaleFlagIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M14 8 A 6 6 0 1 1 8 2" />
        <path d="M11 4 L 14 4" />
        <path d="M14 4 L 14 7" />
      </>
    ),
  });
}

/** Bridge — two arcs over a base (cross-axis or cross-space connection). */
export function BridgeIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2 11 L 14 11" />
        <path d="M2 11 Q 5 5 8 11" />
        <path d="M8 11 Q 11 5 14 11" />
      </>
    ),
  });
}

/** Pin — a stylized thumbtack (compact, geometric, not iconographic). */
export function PinIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M8 2 L 8 7" />
        <path d="M5 6.4 L 11 6.4" />
        <path d="M5.5 6.4 L 6 11" />
        <path d="M10.5 6.4 L 10 11" />
        <path d="M6 11 L 10 11" />
        <path d="M8 11 L 8 14" />
      </>
    ),
  });
}

/** Drop / dismiss — small X centered in soft frame. */
export function DismissIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M5.6 5.6 L 10.4 10.4" />
        <path d="M10.4 5.6 L 5.6 10.4" />
      </>
    ),
  });
}

/** Streaming flow — a line with a pulse bump (live indicator). */
export function StreamingFlowIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M2 8 L 5 8 L 6.5 5 L 8 11 L 9.5 8 L 14 8" />
      </>
    ),
  });
}

/** Audit — a magnifier on a small grid. */
export function AuditIcon(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="6.5" cy="6.5" r="3" />
        <path d="M8.6 8.6 L 12 12" />
        <path d="M2 13 L 14 13" strokeDasharray="1.2 1.4" />
      </>
    ),
  });
}
