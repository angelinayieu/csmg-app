"use client";

// TrailNode — one step in a probe rabbit-hole's spatial reasoning trail.
//
// Five phases drive visual state:
//   • idle      — empty placeholder (rare; only when a node is about to start)
//   • working   — glass surface + breathing inner glow (kg-drill-halo cadence)
//   • complete  — settled glass surface, no glow
//   • result    — final terminal node, gold ring accent
//   • error     — quiet red ring, no glow
//
// Every node is 56×40, radius 12, glass float tier. Don't introduce
// per-step custom geometries — the trail's read comes from the *chain*
// (one node + arrow → another node), not from each node looking unique.

import { forwardRef } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { rail } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import {
  ProbeOriginIcon,
  DecomposeStepIcon,
  SearchStepIcon,
  ResultTerminalIcon,
  ReasoningStepIcon,
} from "@/components/canvas/icons";

export type TrailNodePhase =
  | "idle"
  | "working"
  | "complete"
  | "result"
  | "error";

export type TrailNodeIcon =
  | "probe-origin"
  | "decompose-step"
  | "search-step"
  | "result-terminal"
  | "reasoning-step";

const TRAIL_ICON_MAP: Record<
  TrailNodeIcon,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  "probe-origin": ProbeOriginIcon,
  "decompose-step": DecomposeStepIcon,
  "search-step": SearchStepIcon,
  "result-terminal": ResultTerminalIcon,
  "reasoning-step": ReasoningStepIcon,
};

export interface TrailNodeProps {
  phase: TrailNodePhase;
  /** Tiny label below the node (9-10px, 1-line). */
  label?: string;
  /** Custom SVG icon from the canvas/icons set. Preferred over emoji. */
  icon?: TrailNodeIcon;
  /** Position on the canvas overlay (px, relative to container). */
  x?: number;
  y?: number;
  onClick?: () => void;
}

const PHASE_RING: Record<TrailNodePhase, string | undefined> = {
  idle: undefined,
  working: undefined, // animated glow handles depth
  complete: undefined,
  result: rail.trail.resultAccent.ring,
  error: "rgba(239,68,68,0.5)",
};

export const TrailNode = forwardRef<HTMLDivElement, TrailNodeProps>(
  function TrailNode(
    { phase, label, icon, x, y, onClick },
    ref,
  ) {
    const reduced = useReducedMotion();
    const ring = PHASE_RING[phase];
    const IconComp = icon ? TRAIL_ICON_MAP[icon] : null;
    const iconColor =
      phase === "result"
        ? "#a16207"
        : phase === "error"
          ? "#b42318"
          : phase === "idle"
            ? "rgba(85,100,121,0.55)"
            : "#0a1020";

    return (
      <div
        ref={ref}
        style={{
          position: x != null && y != null ? "absolute" : "relative",
          left: x,
          top: y,
          width: rail.trail.nodeWidth + 16, // +16 to fit the label below
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <GlassPanel
          tier="float"
          radius={rail.trail.nodeRadius}
          accent={ring}
          className={cn(
            phase === "working" && !reduced && "trail-glow-breath",
            phase !== "idle" && !reduced && "trail-node-settle",
          )}
          style={{
            width: rail.trail.nodeWidth,
            height: rail.trail.nodeHeight,
            display: "grid",
            placeItems: "center",
            cursor: onClick ? "pointer" : "default",
            opacity: phase === "idle" ? 0.55 : 1,
            transition: "opacity 240ms var(--ease-out-quart)",
            color: iconColor,
          }}
          onClick={onClick}
        >
          {IconComp ? <IconComp size={16} /> : null}
        </GlassPanel>
        {label && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 500,
              color: "#556479",
              letterSpacing: "0.02em",
              textAlign: "center",
              maxWidth: rail.trail.nodeWidth + 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}
            title={label}
          >
            {label}
          </span>
        )}
      </div>
    );
  },
);
