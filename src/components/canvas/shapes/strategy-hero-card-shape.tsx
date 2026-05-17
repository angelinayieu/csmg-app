"use client";

// ── Strategy hero card shape ──
//
// Phase B (intake redesign): the user's #1 ranked strategy as a
// persistent, prominent tldraw shape on the whiteboard. Replaces
// the old behavior where strategies lived only on a separate
// `/app/space/[id]/strategy` page that most users never reached.
//
// What it shows:
//   - Title + one-line summary of the active rank
//   - Strategic posture chip + confidence %
//   - A row of rank chips (#1 ⭐, #2, #3, ...) — click any non-active
//     chip to swap that rank into the hero slot
//   - "Open detail" button that navigates to the existing strategy
//     page (which mounts the full StrategyHeroGlass + variants UI)
//
// Data source:
//   - Cached preview props (title/summary/confidence/posture) ride
//     on the tldraw shape so it renders instantly on canvas reload
//   - Full StrategyBatch is fetched on-demand from
//     /api/spaces/[id]/twin-proposal so deep details (mechanisms,
//     causal chains, infrastructure proposals) are always fresh
//
// Swap mechanics:
//   - Click rank-N chip → POST /api/spaces/[id]/twin-proposal/swap-rank
//     with { target_rank: N }
//   - On success, the route returns the new active entry; we update
//     the shape props and bump pulse so the view re-fetches
//   - swap is purely presentational at the strategy level — apps
//     materialized for the prior rank-1 are not re-materialized

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Crown, Loader2, Sparkles } from "lucide-react";
import type { StrategyHeroCardShape } from "./types";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";

export const STRATEGY_HERO_DEFAULT_W = 680;
export const STRATEGY_HERO_DEFAULT_H = 280;

// Posture → accent color. Mirrors the accent system used in the
// existing strategy/v2 hero so the on-canvas card visually matches
// the detail page when the user clicks through.
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

export class StrategyHeroCardShapeUtil extends BaseBoxShapeUtil<StrategyHeroCardShape> {
  static override type = "strategy-hero-card" as const;
  static override props: RecordProps<StrategyHeroCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    totalRanks: T.number,
    activeRank: T.number,
    activeTitle: T.string,
    activeSummary: T.string,
    activeConfidence: T.nullable(T.number),
    activePosture: T.string,
    pulse: T.number,
    activeLayerFocusId: T.nullable(T.string),
    activeLayerFocusLabel: T.nullable(T.string),
    activeLayerFocusColor: T.nullable(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: StrategyHeroCardShape,
    info: TLResizeInfo<StrategyHeroCardShape>,
  ) => resizeBox(shape, info);

  // Double-click to open the full strategy detail page (the existing
  // /strategy route that mounts StrategyHeroGlass + variants section
  // with full decomposition). We keep the detail page as the deep-dive
  // surface; the on-canvas shape is the always-visible primary-card.
  override onDoubleClick = (shape: StrategyHeroCardShape) => {
    if (!shape.props.spaceId) return;
    canvasNavigate(`/app/space/${shape.props.spaceId}/strategy`);
  };

  getDefaultProps(): StrategyHeroCardShape["props"] {
    return {
      w: STRATEGY_HERO_DEFAULT_W,
      h: STRATEGY_HERO_DEFAULT_H,
      spaceId: "",
      totalRanks: 1,
      activeRank: 1,
      activeTitle: "Strategy",
      activeSummary: "",
      activeConfidence: null,
      activePosture: "cautious_validation",
      pulse: 0,
      activeLayerFocusId: null,
      activeLayerFocusLabel: null,
      activeLayerFocusColor: null,
    };
  }

  component(shape: StrategyHeroCardShape) {
    return <StrategyHeroCardView shape={shape} />;
  }

  indicator(shape: StrategyHeroCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />
    );
  }
}

function StrategyHeroCardView({ shape }: { shape: StrategyHeroCardShape }) {
  const {
    w,
    h,
    spaceId,
    totalRanks,
    activeRank,
    activeTitle,
    activeSummary,
    activeConfidence,
    activePosture,
    activeLayerFocusId,
    activeLayerFocusLabel,
    activeLayerFocusColor,
  } = shape.props;
  const accent = useMemo(() => postureAccent(activePosture), [activePosture]);
  // E3 — when the active rank is a layer-stratified variant, the card shows
  // a chip in the header indicating which layer of the user's domain
  // ontology this strategy emphasizes. A `null` activeLayerFocusId means
  // the variant is comprehensive (no chip).
  const layerFocus = useMemo(
    () =>
      activeLayerFocusId && activeLayerFocusLabel && activeLayerFocusColor
        ? {
            id: activeLayerFocusId,
            label: activeLayerFocusLabel,
            color: activeLayerFocusColor,
          }
        : null,
    [activeLayerFocusId, activeLayerFocusLabel, activeLayerFocusColor],
  );
  const postureDisplay = useMemo(
    () => postureLabel(activePosture),
    [activePosture],
  );

  // Local "swap in flight" state so the chip click feels responsive.
  // The actual props update happens via the painter's reaction to a
  // successful swap response — we only show a per-chip spinner here.
  const [pendingRank, setPendingRank] = useState<number | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Clear any pending state when the shape's pulse bumps (i.e. the
  // painter just refreshed the props with new active rank data).
  useEffect(() => {
    setPendingRank(null);
    setSwapError(null);
  }, [shape.props.pulse]);

  const handleSwap = useCallback(
    async (targetRank: number) => {
      if (!spaceId) return;
      if (targetRank === activeRank) return;
      setPendingRank(targetRank);
      setSwapError(null);
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/twin-proposal/swap-rank`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ target_rank: targetRank }),
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`swap failed: ${res.status} ${txt}`);
        }
        // Dispatch a window event the painter can listen for to
        // refresh this shape's preview props. Decoupled this way so
        // the shape util doesn't need a reference to the editor.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("strategy-hero:swap-complete", {
              detail: { spaceId, newActiveRank: targetRank },
            }),
          );
        }
      } catch (err) {
        setSwapError(err instanceof Error ? err.message : String(err));
        setPendingRank(null);
      }
    },
    [spaceId, activeRank],
  );

  const handleOpenDetail = useCallback(() => {
    if (!spaceId) return;
    canvasNavigate(`/app/space/${spaceId}/strategy`);
  }, [spaceId]);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: "rgba(255,255,255,0.96)",
          border: `1px solid color-mix(in srgb, ${accent} 22%, rgba(15,23,42,0.06))`,
          boxShadow: `0 24px 60px -20px color-mix(in srgb, ${accent} 32%, transparent), 0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04)`,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        {/* E3 — left-edge layer accent stripe. Only when this rank is a
            layer-stratified variant. The gradient fades from the layer's
            color at the top to transparent at the bottom, so the
            accent feels like a "light source" emanating from the
            top-left corner rather than a flat color block. Positioned
            absolutely, clipped by the parent's overflow:hidden +
            border-radius so it follows the card's rounded corner. */}
        {layerFocus && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 4,
              background: `linear-gradient(180deg, ${layerFocus.color} 0%, color-mix(in srgb, ${layerFocus.color} 50%, transparent) 60%, color-mix(in srgb, ${layerFocus.color} 0%, transparent) 100%)`,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Header row — pill + meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              borderRadius: 999,
              background: `color-mix(in srgb, ${accent} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            <Crown style={{ width: 11, height: 11 }} strokeWidth={2.4} />
            Top strategy
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              letterSpacing: "0.04em",
            }}
            title={`Posture: ${postureDisplay}`}
          >
            {postureDisplay}
          </span>

          {/* E3 — layer-focus chip. visionOS aesthetic: glass pill with
              backdrop-blur, a soft inner glow from the layer's accent
              color, a custom geometric "layer stack" SVG icon (three
              offset rounded squares signaling depth), and a pure-color
              dot showing the layer's accent at full saturation. Only
              renders when this rank is a layer-stratified variant —
              comprehensive ranks (layer_focus === null) show no chip. */}
          {layerFocus && (
            <span
              title={`This variant emphasizes the ${layerFocus.label} layer of your domain ontology. Click to filter the canvas to this layer.`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px 3px 8px",
                borderRadius: 999,
                // Glass surface — translucent white with a subtle layer-
                // tinted wash. Backdrop-blur gives the visionOS depth feel.
                background: `linear-gradient(135deg, rgba(255,255,255,0.78) 0%, color-mix(in srgb, ${layerFocus.color} 6%, rgba(255,255,255,0.78)) 100%)`,
                backdropFilter: "blur(14px) saturate(160%)",
                WebkitBackdropFilter: "blur(14px) saturate(160%)",
                // Inner border in layer color, very subtle.
                border: `1px solid color-mix(in srgb, ${layerFocus.color} 28%, transparent)`,
                // Soft outer glow in layer color — gives the chip a sense
                // of "lit from the layer color underneath" without
                // bleeding loudly into the surrounding card.
                boxShadow: `0 1px 0 rgba(255,255,255,0.6) inset, 0 0 0 1px rgba(255,255,255,0.4) inset, 0 4px 14px -8px ${layerFocus.color}`,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: `color-mix(in srgb, ${layerFocus.color} 80%, #0b0d12)`,
                lineHeight: 1,
              }}
            >
              {/* Custom geometric "layer stack" icon — three offset
                  rounded squares with descending opacity, the foremost
                  filled. Communicates depth and the selected front
                  layer at a glance. */}
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                aria-hidden
                style={{ flexShrink: 0 }}
              >
                <rect
                  x="1.4"
                  y="1.4"
                  width="6.4"
                  height="6.4"
                  rx="1.6"
                  ry="1.6"
                  fill="none"
                  stroke={layerFocus.color}
                  strokeWidth="1.2"
                  opacity="0.38"
                />
                <rect
                  x="3"
                  y="3"
                  width="6.4"
                  height="6.4"
                  rx="1.6"
                  ry="1.6"
                  fill="none"
                  stroke={layerFocus.color}
                  strokeWidth="1.2"
                  opacity="0.7"
                />
                <rect
                  x="4.6"
                  y="4.6"
                  width="6.4"
                  height="6.4"
                  rx="1.6"
                  ry="1.6"
                  fill={layerFocus.color}
                  stroke={layerFocus.color}
                  strokeWidth="1.2"
                  fillOpacity="0.92"
                />
              </svg>
              <span>{layerFocus.label}</span>
            </span>
          )}

          {activeConfidence !== null && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10.5,
                fontWeight: 700,
                color: accent,
                fontVariantNumeric: "tabular-nums",
              }}
              title="LLM-self-reported confidence"
            >
              {Math.round(activeConfidence)}% conf
            </span>
          )}
        </div>

        {/* Title */}
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            lineHeight: 1.25,
            color: "#0b0d12",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={activeTitle}
        >
          {activeTitle || "Strategy generating…"}
        </h3>

        {/* Summary */}
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            fontWeight: 400,
            lineHeight: 1.55,
            color: "rgba(11,13,18,0.74)",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {activeSummary || "Synthesizing the top-ranked strategy from the knowledge graph…"}
        </p>

        {/* Footer — rank chips + open button */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 12,
            borderTop: "1px solid rgba(11,13,18,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(11,13,18,0.45)",
            }}
          >
            Rank
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {Array.from({ length: Math.max(1, totalRanks) }, (_, i) => i + 1).map(
              (rank) => {
                const isActive = rank === activeRank;
                const isPending = pendingRank === rank;
                return (
                  <button
                    key={rank}
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSwap(rank);
                    }}
                    disabled={isActive || pendingRank !== null}
                    title={
                      isActive
                        ? "Currently displayed"
                        : `Swap rank ${rank} into hero slot`
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      minWidth: 28,
                      height: 24,
                      padding: "0 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: isActive ? "default" : "pointer",
                      transition: "all 120ms ease",
                      background: isActive
                        ? accent
                        : "rgba(255,255,255,0.6)",
                      color: isActive ? "#fff" : "#475569",
                      border: isActive
                        ? `1px solid ${accent}`
                        : "1px solid rgba(11,13,18,0.12)",
                      opacity: pendingRank !== null && !isPending ? 0.5 : 1,
                    }}
                  >
                    {isPending ? (
                      <Loader2
                        style={{ width: 11, height: 11 }}
                        className="animate-spin"
                      />
                    ) : isActive ? (
                      <Sparkles
                        style={{ width: 10, height: 10 }}
                        strokeWidth={2.5}
                      />
                    ) : null}
                    #{rank}
                  </button>
                );
              },
            )}
          </div>
          {swapError && (
            <span
              style={{
                fontSize: 10,
                color: "#dc2626",
                marginLeft: 4,
              }}
              title={swapError}
            >
              swap failed
            </span>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDetail();
            }}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              color: "#fff",
              background: accent,
              border: `1px solid ${accent}`,
              cursor: "pointer",
              transition: "transform 100ms ease",
            }}
            title="Open the full strategy detail page"
          >
            Open detail
            <ArrowUpRight style={{ width: 12, height: 12 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}
