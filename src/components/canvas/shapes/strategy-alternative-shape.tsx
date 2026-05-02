"use client";

// ── Strategy alternative card shape ────────────────────────────────────
//
// One ranked alternative from the StrategyHeroBar dropped onto the canvas
// as its own working surface. See types.ts for the long-form rationale
// (frozen at drop time, distinct from StrategyHeroCardShape's swap-aware
// singular card).
//
// Visual: posture-tinted card with rank badge, posture pill, confidence,
// title + 3-line summary. Compact 320×170; expanded 360×230 adds full
// summary clamp and the "Open detail" CTA.
//
// Drag source: src/components/canvas/chrome/strategy-hero-bar.tsx
// Drop dispatcher: src/components/canvas/interaxis-canvas.tsx (handleDrop)

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
  stopEventPropagation,
} from "tldraw";
import { useCallback, useMemo } from "react";
import { ArrowUpRight, Crown } from "lucide-react";
import type { StrategyAlternativeCardShape } from "./types";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";

// MIME used by the hero bar's onDragStart and the canvas drop handler.
// Kept separate from LIBRARY_ASSET_MIME because hero-bar entries are not
// "library items" — they're live ranked proposals from the current batch.
export const STRATEGY_ALTERNATIVE_DRAG_MIME =
  "application/x-interaxis-strategy-alternative";

export interface StrategyAlternativeDragPayload {
  spaceId: string;
  entryRank: number;
  posture: string;
  title: string;
  summary: string;
  confidence: number | null;
  isPrimary: boolean;
}

const COMPACT_W = 320;
const COMPACT_H = 170;
const EXPANDED_W = 360;
const EXPANDED_H = 240;

const POSTURE_ACCENT: Record<string, string> = {
  aggressive_growth: "#ef4444",
  cautious_validation: "#0891b2",
  defensive_consolidation: "#7c3aed",
  exploratory_discovery: "#d97706",
  efficiency_optimization: "#10b981",
  decisive_pivot: "#ec4899",
};

const POSTURE_LABEL: Record<string, string> = {
  aggressive_growth: "Aggressive growth",
  cautious_validation: "Cautious validation",
  defensive_consolidation: "Defensive consolidation",
  exploratory_discovery: "Exploratory discovery",
  efficiency_optimization: "Efficiency optimization",
  decisive_pivot: "Decisive pivot",
};

function postureAccent(posture: string): string {
  return POSTURE_ACCENT[posture] ?? "#7c3aed";
}

function postureLabel(posture: string): string {
  return POSTURE_LABEL[posture] ?? posture.replace(/_/g, " ");
}

/**
 * Stable shape id for a (spaceId, rank) pair so re-dropping the same
 * alternative dedupes against the existing card on the board.
 */
export function strategyAlternativeShapeIdSeed(
  spaceId: string,
  entryRank: number,
): string {
  return `strategy-alt-${spaceId}-${entryRank}`;
}

export class StrategyAlternativeShapeUtil extends BaseBoxShapeUtil<StrategyAlternativeCardShape> {
  static override type = "strategy-alternative-card" as const;
  static override props: RecordProps<StrategyAlternativeCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    entryRank: T.number,
    posture: T.string,
    title: T.string,
    summary: T.string,
    confidence: T.nullable(T.number),
    wasPrimary: T.boolean,
    pinnedAt: T.string,
    expanded: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: StrategyAlternativeCardShape,
    info: TLResizeInfo<StrategyAlternativeCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): StrategyAlternativeCardShape["props"] {
    return {
      w: COMPACT_W,
      h: COMPACT_H,
      spaceId: "",
      entryRank: 1,
      posture: "exploratory_discovery",
      title: "Strategy alternative",
      summary: "",
      confidence: null,
      wasPrimary: false,
      pinnedAt: new Date().toISOString(),
      expanded: false,
    };
  }

  component(shape: StrategyAlternativeCardShape) {
    return <StrategyAlternativeRenderer shape={shape} util={this} />;
  }

  indicator(shape: StrategyAlternativeCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />
    );
  }
}

export {
  COMPACT_W as STRATEGY_ALT_COMPACT_W,
  COMPACT_H as STRATEGY_ALT_COMPACT_H,
};

function StrategyAlternativeRenderer({
  shape,
  util,
}: {
  shape: StrategyAlternativeCardShape;
  util: StrategyAlternativeShapeUtil;
}) {
  const editor = util.editor;
  const accent = useMemo(() => postureAccent(shape.props.posture), [shape.props.posture]);
  const postureDisplay = useMemo(
    () => postureLabel(shape.props.posture),
    [shape.props.posture],
  );

  const confidencePct = useMemo(() => {
    const c = shape.props.confidence;
    if (typeof c !== "number") return null;
    return Math.round(c > 1 ? c : c * 100);
  }, [shape.props.confidence]);

  const toggleExpanded = useCallback(() => {
    const next = !shape.props.expanded;
    editor.updateShape<StrategyAlternativeCardShape>({
      id: shape.id,
      type: "strategy-alternative-card",
      props: {
        expanded: next,
        w: next ? EXPANDED_W : COMPACT_W,
        h: next ? EXPANDED_H : COMPACT_H,
      },
    });
  }, [editor, shape.id, shape.props.expanded]);

  const handleOpenDetail = useCallback(() => {
    if (!shape.props.spaceId) return;
    canvasNavigate(`/app/space/${shape.props.spaceId}/strategy`);
  }, [shape.props.spaceId]);

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        onDoubleClick={toggleExpanded}
        role="button"
        aria-label={`Strategy alternative #${shape.props.entryRank}: ${shape.props.title}. Double-click to ${shape.props.expanded ? "collapse" : "expand"}.`}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          background:
            "linear-gradient(155deg, rgba(255,255,255,0.98) 0%, rgba(250,251,253,0.95) 100%)",
          border: `1px solid color-mix(in srgb, ${accent} 30%, rgba(15,23,42,0.06))`,
          boxShadow: `0 1px 3px rgba(15, 23, 42, 0.06), 0 12px 28px -8px ${accent}33`,
          padding: shape.props.expanded ? "14px 16px" : "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: shape.props.expanded ? 10 : 8,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* Accent bar (left) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: accent,
            borderTopLeftRadius: 14,
            borderBottomLeftRadius: 14,
          }}
        />

        {/* Header row: rank + posture + confidence */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9.5,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 7px",
              borderRadius: 6,
              background: shape.props.wasPrimary ? "#FEF3C7" : "#F1F5F9",
              color: shape.props.wasPrimary ? "#92400E" : "#475569",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {shape.props.wasPrimary && (
              <Crown style={{ width: 10, height: 10, color: "#F59E0B" }} />
            )}
            #{shape.props.entryRank}
          </span>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 6,
              background: `${accent}15`,
              color: accent,
              border: `1px solid ${accent}40`,
            }}
            title={`Posture: ${postureDisplay}`}
          >
            {postureDisplay}
          </span>
          {confidencePct !== null && (
            <span
              style={{
                marginLeft: "auto",
                padding: "2px 6px",
                borderRadius: 6,
                background: "rgba(99,102,241,0.08)",
                color: "#4338CA",
                fontVariantNumeric: "tabular-nums",
              }}
              title="Confidence"
            >
              {confidencePct}%
            </span>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.3,
            fontWeight: 600,
            color: "#0F172A",
            letterSpacing: "-0.005em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {shape.props.title || "Untitled strategy"}
        </div>

        {/* Summary */}
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            color: "#475569",
            display: "-webkit-box",
            WebkitLineClamp: shape.props.expanded ? 5 : 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {shape.props.summary}
        </div>

        {/* Footer (expanded only) — open detail link */}
        {shape.props.expanded && (
          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 6,
              borderTop: "1px dashed rgba(148, 163, 184, 0.3)",
            }}
          >
            <span style={{ fontSize: 9.5, color: "#94A3B8" }}>
              Pinned {new Date(shape.props.pinnedAt).toLocaleDateString()}
            </span>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDetail();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 999,
                background: accent,
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              title="Open strategy detail"
            >
              Open
              <ArrowUpRight style={{ width: 10, height: 10 }} />
            </button>
          </div>
        )}

        {/* Collapsed hint */}
        {!shape.props.expanded && (
          <div
            style={{
              marginTop: "auto",
              fontSize: 9,
              color: "#94A3B8",
              lineHeight: 1.2,
            }}
          >
            Double-click to expand
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
