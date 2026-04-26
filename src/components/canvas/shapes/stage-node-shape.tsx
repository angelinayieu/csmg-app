"use client";

// ── Stage node shape (Sprint A — wrap-what-exists pass) ────────────
//
// Tldraw wrapper for a single causal-chain stage card. The original
// StageNode (src/components/causal-chains/stage-node.tsx) is a
// ReactFlow node — it calls Handle + NodeProps, which only make sense
// inside a ReactFlowProvider. Rather than boot ReactFlow inside every
// tldraw shape, we port the visual language (identical palette,
// layout, typography, badges) into a self-contained card that takes
// plain props. Handles become tldraw arrow bindings — the canvas
// painter wires arrows between stage-node shapes to form the chain.
//
// Why a shape per stage (vs one shape per chain): the painter unfurls
// stages left-to-right in the root-cause band; each one arrives on
// its own beat. Keeping stages as discrete shapes lets the event
// painter stagger their ghost entrance and lets users rearrange /
// delete individual stages without losing the rest of the chain.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { CheckCircle2, Sparkles } from "lucide-react";
import type { CausalStageKind } from "@/types/causal-chains";
import type { StageNodeShape } from "./types";
import { CAUSAL_LAYOUT } from "@/lib/causal-chains/to-reactflow-shape";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";

// Palette mirrored from src/components/causal-chains/stage-node.tsx so
// stages read identically whether rendered on the canvas or the
// legacy ReactFlow trace view.
const STAGE_PALETTE: Record<
  CausalStageKind,
  { bg: string; border: string; text: string; accent: string }
> = {
  concept:     { bg: "#FAF5FF", border: "#E9D5FF", text: "#5B21B6", accent: "#7C3AED" },
  research:    { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46", accent: "#047857" },
  deliverable: { bg: "#EEF2FF", border: "#C7D2FE", text: "#3730A3", accent: "#4F46E5" },
  application: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", accent: "#B45309" },
  outcome:     { bg: "#ECFEFF", border: "#A5F3FC", text: "#155E75", accent: "#0E7490" },
  goal:        { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B", accent: "#B91C1C" },
};

const STAGE_LABELS: Record<CausalStageKind, string> = {
  concept: "Concept",
  research: "Research",
  deliverable: "Deliverable",
  application: "Application",
  outcome: "Outcome",
  goal: "Goal",
};

// Use the ReactFlow layout's NODE_W/NODE_H so the canvas card matches
// the trace-view card pixel-for-pixel. Change in one place updates both.
const DEFAULT_W = CAUSAL_LAYOUT.NODE_W;
const DEFAULT_H = CAUSAL_LAYOUT.NODE_H;

export class StageNodeShapeUtil extends BaseBoxShapeUtil<StageNodeShape> {
  static override type = "stage-node" as const;
  static override props: RecordProps<StageNodeShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    chainId: T.string,
    chainName: T.string,
    chainRank: T.number,
    stageIndex: T.number,
    kind: T.literalEnum(
      "concept",
      "research",
      "deliverable",
      "application",
      "outcome",
      "goal",
    ),
    title: T.string,
    meta: T.string,
    confidence: T.number.nullable(),
    verified: T.boolean,
    valueLabel: T.string.nullable(),
    entityId: T.string.nullable(),
    isTerminal: T.boolean,
    convergingCount: T.number.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: StageNodeShape,
    info: TLResizeInfo<StageNodeShape>,
  ) => resizeBox(shape, info);

  // Sprint B.5 — double-click a stage card to deep-link back to the
  // entity that anchors it. Reuses the existing canvas `?focus=<id>`
  // param (see interaxis-canvas focus-applier at ~line 1269) so the
  // navigation lands the user on the KG shape for that entity. No
  // dedicated chain trace route exists yet — terminal/synthetic
  // stages are silent on double-click rather than fabricating a URL.
  override onDoubleClick = (shape: StageNodeShape) => {
    const { spaceId, entityId } = shape.props;
    if (!spaceId || !entityId) return;
    canvasNavigate(`/app/space/${spaceId}/whiteboard?focus=${entityId}`);
  };

  getDefaultProps(): StageNodeShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      spaceId: "",
      chainId: "",
      chainName: "",
      chainRank: 1,
      stageIndex: 0,
      kind: "concept",
      title: "Stage",
      meta: "",
      confidence: null,
      verified: false,
      valueLabel: null,
      entityId: null,
      isTerminal: false,
      convergingCount: null,
    };
  }

  component(shape: StageNodeShape) {
    return <StageNodeShapeView shape={shape} />;
  }

  indicator(shape: StageNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />;
  }
}

function StageNodeShapeView({ shape }: { shape: StageNodeShape }) {
  const {
    w,
    h,
    kind,
    title,
    meta,
    confidence,
    verified,
    valueLabel,
    stageIndex,
    chainRank,
    isTerminal,
    convergingCount,
  } = shape.props;

  const palette = STAGE_PALETTE[kind];

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          background: palette.bg,
          border: `1.5px solid ${palette.border}`,
          borderRadius: 10,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "6px 10px",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Top row: stage label + verified badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: palette.text,
              opacity: 0.7,
            }}
          >
            {isTerminal
              ? `${convergingCount ?? 0} chains → goal`
              : STAGE_LABELS[kind]}
          </span>
          {verified ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontSize: 8,
                color: "#047857",
                fontWeight: 600,
              }}
            >
              <CheckCircle2 style={{ width: 10, height: 10 }} />
              verified
            </span>
          ) : null}
        </div>

        {/* Title */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.2,
            color: palette.text,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </p>

        {/* Bottom row: meta + confidence dots or value label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: palette.text,
              opacity: 0.6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </span>
          {valueLabel ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: palette.accent,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {valueLabel}
            </span>
          ) : confidence != null ? (
            <ConfidenceDots confidence={confidence} accent={palette.accent} />
          ) : null}
        </div>

        {/* Rank badge (top-left) for the first stage of each non-terminal chain */}
        {stageIndex === 0 && !isTerminal ? (
          <span
            style={{
              position: "absolute",
              top: -8,
              left: -8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 20,
              width: 20,
              borderRadius: 999,
              background: "white",
              boxShadow: `0 0 0 1px ${palette.border}`,
              fontSize: 9,
              fontWeight: 700,
              color: palette.text,
              fontFeatureSettings: '"tnum"',
            }}
          >
            {chainRank}
          </span>
        ) : null}

        {/* Terminal shimmer — subtle indicator on the goal node */}
        {isTerminal ? (
          <Sparkles
            style={{
              position: "absolute",
              top: -8,
              right: -8,
              width: 16,
              height: 16,
              color: palette.accent,
            }}
          />
        ) : null}
      </div>
    </HTMLContainer>
  );
}

function ConfidenceDots({
  confidence,
  accent,
}: {
  confidence: number;
  accent: string;
}) {
  const filled = Math.round(Math.max(0, Math.min(1, confidence)) * 4);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            height: 4,
            width: 4,
            borderRadius: 999,
            background: i < filled ? accent : "rgba(0,0,0,0.12)",
          }}
        />
      ))}
    </span>
  );
}
