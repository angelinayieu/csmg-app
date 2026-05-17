"use client";

// ── Mechanism Card shape ────────────────────────────────────────────
//
// First-class canvas representation of a row in the `mechanisms` table.
// Mechanisms are the cyclical sub-processes each twin runs (simulation /
// prediction / validation / baseline_tracking / deviation_capture / game /
// ml_personalization). They've been first-class in the DB since
// migration 20260509_mechanisms.sql but were never visualized on the
// canvas — the data layer carried them as invisible supernodes that
// connected strategy proposals → apps. This shape closes that gap.
//
// Anchored inside the twin room of the operational cascade by the
// canvas-operational-seed-spawner — one card per mechanism row,
// positioned in a horizontal strip to the right of the twin-snapshot.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Activity, BarChart3, CheckCircle2, Sparkles, Beaker, Gamepad2, Sparkle, Zap } from "lucide-react";
import type { MechanismCardShape } from "./types";
import { useShapeEntrance } from "@/hooks/canvas/use-shape-entrance";

export const MECHANISM_CARD_DEFAULT_W = 240;
export const MECHANISM_CARD_DEFAULT_H = 160;

// Per-kind visual identity. Each mechanism kind maps to a tldraw-named
// accent + an icon. Colors are HSL-distinct so a row of mechanism cards
// reads as four-five visually-different chips, not a wall of one color.
//
// Kept terse — the user reads the kind from the icon + headline; the
// tagline below is the cycle_pattern string which carries the actual
// per-twin specificity.
const KIND_VISUALS: Record<
  MechanismCardShape["props"]["kind"],
  { accent: string; bg: string; ring: string; Icon: React.ComponentType<{ size?: number; className?: string }>; label: string }
> = {
  simulation: {
    accent: "#4F46E5", // indigo-600
    bg: "rgba(79,70,229,0.06)",
    ring: "rgba(79,70,229,0.20)",
    Icon: Activity,
    label: "Simulation",
  },
  prediction: {
    accent: "#0EA5E9", // sky-600
    bg: "rgba(14,165,233,0.06)",
    ring: "rgba(14,165,233,0.20)",
    Icon: BarChart3,
    label: "Prediction",
  },
  validation: {
    accent: "#10B981", // emerald-600
    bg: "rgba(16,185,129,0.06)",
    ring: "rgba(16,185,129,0.20)",
    Icon: CheckCircle2,
    label: "Validation",
  },
  baseline_tracking: {
    accent: "#64748B", // slate-500
    bg: "rgba(100,116,139,0.06)",
    ring: "rgba(100,116,139,0.20)",
    Icon: Beaker,
    label: "Baseline",
  },
  deviation_capture: {
    accent: "#F59E0B", // amber-500
    bg: "rgba(245,158,11,0.06)",
    ring: "rgba(245,158,11,0.20)",
    Icon: Sparkles,
    label: "Deviation",
  },
  game: {
    accent: "#EC4899", // pink-500
    bg: "rgba(236,72,153,0.06)",
    ring: "rgba(236,72,153,0.20)",
    Icon: Gamepad2,
    label: "Game",
  },
  ml_personalization: {
    accent: "#8B5CF6", // violet-500
    bg: "rgba(139,92,246,0.06)",
    ring: "rgba(139,92,246,0.20)",
    Icon: Sparkle,
    label: "ML Persona",
  },
};

// Status indicator dot colors — same vocabulary as existing app + tldraw
// status patterns: proposed=amber (awaiting), approved=indigo (cued),
// active=emerald (running), paused=slate, retired=rose.
const STATUS_COLOR: Record<MechanismCardShape["props"]["status"], string> = {
  proposed: "#F59E0B",
  approved: "#6366F1",
  active: "#10B981",
  paused: "#94A3B8",
  retired: "#F43F5E",
};

const STATUS_LABEL: Record<MechanismCardShape["props"]["status"], string> = {
  proposed: "proposed",
  approved: "approved",
  active: "active",
  paused: "paused",
  retired: "retired",
};

export class MechanismCardShapeUtil extends BaseBoxShapeUtil<MechanismCardShape> {
  static override type = "mechanism-card" as const;
  static override props: RecordProps<MechanismCardShape> = {
    w: T.number,
    h: T.number,
    mechanismId: T.string,
    kind: T.literalEnum(
      "simulation",
      "prediction",
      "validation",
      "baseline_tracking",
      "deviation_capture",
      "game",
      "ml_personalization",
    ),
    name: T.string,
    cyclePattern: T.any,    // string | null — T.any used because tldraw's
    rationale: T.any,       // T.string narrows to non-null. The view handles
                            // null explicitly. Pre-existing pattern in
                            // strategy-objective-shape.tsx for nullable text.
    status: T.literalEnum(
      "proposed",
      "approved",
      "active",
      "paused",
      "retired",
    ),
    agentCount: T.number,
    appCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: MechanismCardShape,
    info: TLResizeInfo<MechanismCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): MechanismCardShape["props"] {
    return {
      w: MECHANISM_CARD_DEFAULT_W,
      h: MECHANISM_CARD_DEFAULT_H,
      mechanismId: "",
      kind: "simulation",
      name: "Mechanism",
      cyclePattern: null,
      rationale: null,
      status: "proposed",
      agentCount: 0,
      appCount: 0,
    };
  }

  component(shape: MechanismCardShape) {
    return <MechanismCardView shape={shape} />;
  }

  indicator(shape: MechanismCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />
    );
  }
}

function MechanismCardView({ shape }: { shape: MechanismCardShape }) {
  const { w, h, kind, name, cyclePattern, rationale, status, agentCount, appCount } =
    shape.props;
  const visuals = KIND_VISUALS[kind] ?? KIND_VISUALS.simulation;
  const Icon = visuals.Icon;
  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.proposed;
  const statusLabel = STATUS_LABEL[status] ?? status;

  // Cinematic Phase 2 — entrance fade-in. Mechanism cards orbit the
  // twin during the climax reveal; the fade gives the "rising into
  // place" feel rather than the abrupt pop they had before.
  const { entranceStyle } = useShapeEntrance(640);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        background: "white",
        border: `1.5px solid ${visuals.ring}`,
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 1px 3px rgba(11,13,18,0.04)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        overflow: "hidden",
        ...entranceStyle,
      }}
    >
      {/* Header row — kind icon + label + status dot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: visuals.bg,
            color: visuals.accent,
            flexShrink: 0,
          }}
        >
          <Icon size={13} />
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: visuals.accent,
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={visuals.label}
        >
          {visuals.label}
        </span>
        <span
          title={`Status: ${statusLabel}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontSize: 8.5,
            fontWeight: 600,
            color: statusColor,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: statusColor,
            }}
          />
          {statusLabel}
        </span>
      </div>

      {/* Mechanism name — what THIS mechanism is for, in plain language */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#0B0D12",
          letterSpacing: "-0.01em",
          lineHeight: 1.25,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={name}
      >
        {name}
      </div>

      {/* Cycle pattern — the loop slug. Mono so it reads as a slug, not prose. */}
      {cyclePattern && (
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 500,
            color: "rgba(11,13,18,0.50)",
            fontFamily:
              'ui-monospace, SFMono-Regular, "Roboto Mono", monospace',
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`cycle: ${cyclePattern}`}
        >
          ⟳ {cyclePattern}
        </div>
      )}

      {/* Rationale snippet — clamped to 2 lines so the card stays compact.
          When absent, the card just shows the cycle pattern + counts. */}
      {rationale && (
        <div
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.62)",
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
        >
          {rationale}
        </div>
      )}

      {/* Footer — agent count + app count chips */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: "auto",
          paddingTop: 6,
          borderTop: "1px solid rgba(11,13,18,0.06)",
          fontSize: 9.5,
          color: "rgba(11,13,18,0.54)",
          fontWeight: 500,
        }}
      >
        <span
          title={`${agentCount} agent${agentCount === 1 ? "" : "s"} assigned`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <Zap size={10} />
          {agentCount}
        </span>
        <span
          title={`${appCount} app${appCount === 1 ? "" : "s"} below`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 11 }}>▢</span>
          {appCount}
        </span>
      </div>
    </HTMLContainer>
  );
}
