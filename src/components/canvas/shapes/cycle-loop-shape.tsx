"use client";

// ── Cycle loop shape (Phase A1.3) ──
//
// Feedback loops detected in the space. Classification drives visual:
//   reinforcing_positive → green accent + ↑ badge
//   reinforcing_negative → pink accent + ↓ badge
//   balancing            → cyan accent + ↺ badge
//
// The chain-preview shows the first 3-4 entity names with arrows, then
// an ending loop arrow to signal the cycle. Click → navigates to the
// first entity's lab so users can inspect the loop starting point.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { RotateCw, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import type { CycleLoopShape } from "./types";

type Classification = CycleLoopShape["props"]["classification"];

const CLASSIFICATION_META: Record<
  Classification,
  {
    label: string;
    color: string;
    bg: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    glyph: string;
  }
> = {
  reinforcing_positive: {
    label: "Reinforcing +",
    color: "#16a34a",
    bg: "#dcfce7",
    icon: TrendingUp,
    glyph: "↑",
  },
  reinforcing_negative: {
    label: "Reinforcing −",
    color: "#db2777",
    bg: "#fce7f3",
    icon: TrendingDown,
    glyph: "↓",
  },
  balancing: {
    label: "Balancing",
    color: "#0891b2",
    bg: "#cffafe",
    icon: RefreshCw,
    glyph: "↺",
  },
};

const VALID_CLASSIFICATIONS: readonly Classification[] = [
  "reinforcing_positive",
  "reinforcing_negative",
  "balancing",
] as const;

export class CycleLoopShapeUtil extends BaseBoxShapeUtil<CycleLoopShape> {
  static override type = "cycle-loop" as const;
  static override props: RecordProps<CycleLoopShape> = {
    w: T.number,
    h: T.number,
    cycleId: T.string,
    spaceId: T.string,
    name: T.string,
    classification: T.literalEnum(...VALID_CLASSIFICATIONS),
    entityNames: T.arrayOf(T.string),
    nodeCount: T.number,
    multiplier: T.number.nullable(),
    firstEntityId: T.string.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: CycleLoopShape, info: TLResizeInfo<CycleLoopShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): CycleLoopShape["props"] {
    return {
      w: 260,
      h: 140,
      cycleId: "",
      spaceId: "",
      name: "Untitled cycle",
      classification: "balancing",
      entityNames: [],
      nodeCount: 0,
      multiplier: null,
      firstEntityId: null,
    };
  }

  component(shape: CycleLoopShape) {
    return <CycleLoopShapeView shape={shape} />;
  }

  indicator(shape: CycleLoopShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function CycleLoopShapeView({ shape }: { shape: CycleLoopShape }) {
  const {
    spaceId,
    name,
    classification,
    entityNames,
    nodeCount,
    multiplier,
    firstEntityId,
  } = shape.props;

  const meta = CLASSIFICATION_META[classification];
  const Icon = meta.icon;

  const navHref =
    spaceId && firstEntityId
      ? `/app/space/${spaceId}/entity/${firstEntityId}/lab`
      : spaceId
        ? `/app/space/${spaceId}/whiteboard`
        : "";

  // Build the chain preview (up to 4 names + ↺ end marker).
  const preview = entityNames.slice(0, 4);
  const overflow = entityNames.length > preview.length;

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(12px)",
          border: `1px solid ${meta.color}33`,
          boxShadow: `0 8px 22px -8px ${meta.color}33, 0 3px 10px rgba(8, 60, 180, 0.06)`,
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: navHref ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!navHref) return;
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey || e.button === 1) {
            window.open(navHref, "_blank");
          } else {
            window.location.href = navHref;
          }
        }}
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: meta.color,
            boxShadow: `0 0 12px ${meta.color}66`,
          }}
        />

        {/* Header: classification chip + icon + multiplier */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 3,
              background: meta.bg,
              color: meta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            <Icon style={{ width: 9, height: 9 }} />
            {meta.label}
          </span>
          <span
            aria-hidden
            style={{
              fontSize: 13,
              lineHeight: 1,
              color: meta.color,
              fontWeight: 700,
            }}
          >
            <RotateCw style={{ width: 11, height: 11, display: "inline" }} />
          </span>
          {typeof multiplier === "number" && multiplier > 0 && (
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                fontWeight: 700,
                color: meta.color,
                fontVariantNumeric: "tabular-nums",
              }}
              title="Estimated multiplier per loop"
            >
              ~{multiplier.toFixed(1)}×
            </span>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.25,
            color: "#0a1020",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={name}
        >
          {name}
        </div>

        {/* Chain preview */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
            lineHeight: 1.4,
          }}
        >
          {preview.map((n, i) => (
            <span key={`${n}-${i}`} style={{ display: "inline-flex", alignItems: "center" }}>
              <span
                style={{
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: `${meta.color}10`,
                  color: meta.color,
                  fontWeight: 600,
                  maxWidth: 90,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={n}
              >
                {n}
              </span>
              <span style={{ margin: "0 3px", color: "#94a3b8" }}>
                {i < preview.length - 1 ? "→" : overflow ? "…" : meta.glyph}
              </span>
            </span>
          ))}
          {preview.length === 0 && (
            <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
              {nodeCount} nodes
            </span>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 9.5,
            color: "#64748b",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
          }}
        >
          <span>
            {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
          </span>
          {navHref && (
            <span style={{ color: meta.color, fontWeight: 700 }}>
              Inspect →
            </span>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}
