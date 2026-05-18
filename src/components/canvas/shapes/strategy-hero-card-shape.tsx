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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  Crown,
  ExternalLink,
  Layers,
  Loader2,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import type { StrategyHeroCardShape } from "./types";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";

export const STRATEGY_HERO_DEFAULT_W = 680;
export const STRATEGY_HERO_DEFAULT_H = 280;

/** Expanded dimensions — when the user clicks to expand the hero card,
 *  the shape resizes to this footprint and renders rich reasoning +
 *  provenance + layers + tactics inline. Larger than the collapsed
 *  size so the user can scan everything without scrolling much. */
export const STRATEGY_HERO_EXPANDED_W = 880;
export const STRATEGY_HERO_EXPANDED_H = 680;

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
  } = shape.props;
  const accent = useMemo(() => postureAccent(activePosture), [activePosture]);
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

  // ── Canvas-side expand state ──
  // Single click on the card body (not on buttons) toggles expand.
  // When expanded, fetches the rich strategy detail and renders it
  // inline. Dispatches a window event so the CanvasStrategyExpandResponder
  // can resize the shape + reframe the camera + dim other canvas shapes.
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<StrategySummary | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [hoveredTactic, setHoveredTactic] = useState<number | null>(null);

  // Fetch details lazily on first expand. Cached locally so collapse →
  // re-expand doesn't hit the network again.
  useEffect(() => {
    if (!expanded || !spaceId || details || detailsLoading) return;
    let cancelled = false;
    setDetailsLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/strategy/summary`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`summary failed: ${res.status}`);
        const json = (await res.json()) as StrategySummary;
        if (!cancelled) setDetails(json);
      } catch (err) {
        console.warn("[strategy-hero] summary fetch failed:", err);
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, spaceId, details, detailsLoading]);

  // Dispatch the expand toggle as a window event. The
  // CanvasStrategyExpandResponder (in InFrontOfTheCanvas tree) picks
  // it up and handles the editor-side concerns: shape resize, camera
  // reframe, body attribute for chrome dimming.
  const previousExpandedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (previousExpandedRef.current === expanded) return;
    previousExpandedRef.current = expanded;
    window.dispatchEvent(
      new CustomEvent("strategy-hero:toggle-expand", {
        detail: { shapeId: shape.id, expanded, spaceId },
      }),
    );
  }, [expanded, shape.id, spaceId]);

  const toggleExpand = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  // ── Tactic hover → entity glow ──
  // When the user hovers a tactic row in the expanded card, the source
  // entity IDs it cites get a brief pulse on the canvas. Dispatched as
  // a window event the CanvasEntityGlowResponder listens for.
  const handleTacticHover = useCallback(
    (tacticIndex: number, entityIds: string[]) => {
      setHoveredTactic(tacticIndex);
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("strategy-hover:entities", {
          detail: { entity_ids: entityIds },
        }),
      );
    },
    [],
  );

  const handleTacticLeave = useCallback(() => {
    setHoveredTactic(null);
  }, []);

  const handleTacticClick = useCallback(
    (entityIds: string[]) => {
      if (entityIds.length === 0) return;
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("strategy-click:entity", {
          detail: { entity_id: entityIds[0] },
        }),
      );
    },
    [],
  );

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
        onClick={(e) => {
          // Only toggle on clicks NOT originating from buttons / rank
          // chips / hover targets. Each interactive child stops
          // propagation so we don't accidentally collapse on rank click.
          if ((e.target as HTMLElement).closest("button, a, [data-no-expand]")) {
            return;
          }
          toggleExpand();
        }}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: "rgba(255,255,255,0.96)",
          border: `1px solid color-mix(in srgb, ${accent} 22%, rgba(15,23,42,0.06))`,
          boxShadow: `0 24px 60px -20px color-mix(in srgb, ${accent} 32%, transparent), 0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04)`,
          padding: expanded ? "22px 24px" : "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          cursor: expanded ? "default" : "zoom-in",
          transition: "padding 300ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
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

        {/* ── Expanded detail (canvas-side trace-back) ──
            Renders inline when the user clicks the card to expand.
            Shows reasoning_chain + provenance + L4→L1 layers + tactics
            with hover-to-glow source entity references. The user never
            leaves the canvas to inspect strategy detail. */}
        {expanded && (
          <ExpandedDetail
            details={details}
            loading={detailsLoading}
            accent={accent}
            hoveredTactic={hoveredTactic}
            onTacticHover={handleTacticHover}
            onTacticLeave={handleTacticLeave}
            onTacticClick={handleTacticClick}
            onOpenDoc={handleOpenDetail}
            onCollapse={toggleExpand}
          />
        )}

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

// ── Expanded detail types ──

interface StrategySummary {
  active_rank: number;
  total_ranks: number;
  space_name: string;
  recommendation: {
    title: string;
    summary: string;
    strategic_posture: string;
    confidence: number | null;
    target_objective: string | null;
    key_tradeoff: string | null;
    core_logic: string | null;
    reasoning_chain: string;
    provenance: StrategyProvenance | null;
    layers: StrategyLayersData | null;
    tactics: TacticData[];
  };
}

interface StrategyProvenance {
  axioms_respected?: string[];
  axioms_challenged?: string[];
  convergences_addressed?: string[];
  coverage_gaps_closed?: string[];
  inversions_considered?: string[];
  hidden_signals_addressed?: string[];
  critical_axioms_missed?: string[];
  hidden_axioms_missed?: string[];
  strong_convergences_missed?: string[];
  overall_provenance_score?: number;
}

interface StrategyLayersData {
  l4_insights?: LayerItem[];
  l3_reasoning?: LayerItem[];
  l2_methods?: LayerItem[];
  l1_outcomes?: LayerItem[];
}

interface LayerItem {
  id?: string;
  title?: string;
  summary?: string;
  pillar_sources?: Array<{
    pillar: string;
    source_refs: string[];
    contribution?: string;
  }>;
}

interface TacticData {
  id?: string;
  title?: string;
  description?: string;
  axiom_ids_respected?: string[];
  axiom_ids_challenged?: string[];
  convergence_ids_addressed?: string[];
  coverage_gap_ids_closed?: string[];
  inversion_ids_tested?: string[];
  hidden_signal_refs?: string[];
  subsystem_ids_targeted?: string[];
}

// ── ExpandedDetail component ──
//
// Renders the rich strategy detail inline inside the expanded hero
// card. Sections:
//   - Reasoning chain (full LLM narrative)
//   - Provenance score + red flags ("findings not addressed")
//   - L4 → L1 layers (collapsible accordions)
//   - Tactics (each with hover-to-glow source entities)
//
// Tactic hover dispatches `strategy-hover:entities` so the canvas's
// CanvasEntityGlowResponder can pulse the referenced entities. Click
// dispatches `strategy-click:entity` to pan camera to the first ref.

function ExpandedDetail({
  details,
  loading,
  accent,
  hoveredTactic,
  onTacticHover,
  onTacticLeave,
  onTacticClick,
  onOpenDoc,
  onCollapse,
}: {
  details: StrategySummary | null;
  loading: boolean;
  accent: string;
  hoveredTactic: number | null;
  onTacticHover: (i: number, entityIds: string[]) => void;
  onTacticLeave: () => void;
  onTacticClick: (entityIds: string[]) => void;
  onOpenDoc: () => void;
  onCollapse: () => void;
}) {
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "24px",
          fontSize: 12,
          color: "#64748b",
        }}
      >
        <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
        Loading reasoning + provenance…
      </div>
    );
  }
  if (!details) return null;

  const rec = details.recommendation;
  const prov = rec.provenance;
  const tactics = rec.tactics || [];

  return (
    <div
      data-no-expand
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        marginTop: 4,
        overflow: "auto",
        flex: 1,
        // Inner scroll so the card stays a fixed size; user pans canvas
        // around the card, scrolls content inside.
        paddingRight: 4,
      }}
    >
      {/* Reasoning chain */}
      {rec.reasoning_chain && (
        <DetailSection icon={<Sparkles style={{ width: 11, height: 11 }} />} label="Reasoning" accent={accent}>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "rgba(11,13,18,0.78)",
            }}
          >
            {rec.reasoning_chain}
          </p>
        </DetailSection>
      )}

      {/* Provenance score + red flags */}
      {prov && (
        <DetailSection icon={<ShieldCheck style={{ width: 11, height: 11 }} />} label="Provenance" accent={accent}>
          <ProvenanceBlock provenance={prov} accent={accent} />
        </DetailSection>
      )}

      {/* L4 → L1 layers */}
      {rec.layers && (
        <DetailSection icon={<Layers style={{ width: 11, height: 11 }} />} label="Layers L4 → L1" accent={accent}>
          <LayersBlock layers={rec.layers} accent={accent} />
        </DetailSection>
      )}

      {/* Tactics with hover-to-glow */}
      {tactics.length > 0 && (
        <DetailSection icon={<Target style={{ width: 11, height: 11 }} />} label={`Tactics (${tactics.length})`} accent={accent}>
          <TacticsBlock
            tactics={tactics}
            accent={accent}
            hoveredIdx={hoveredTactic}
            onHover={onTacticHover}
            onLeave={onTacticLeave}
            onClick={onTacticClick}
          />
        </DetailSection>
      )}

      {/* Bottom action row inside expanded view */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 8,
          borderTop: "1px solid rgba(11,13,18,0.06)",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: "#64748b",
            background: "transparent",
            border: "1px solid rgba(11,13,18,0.10)",
            cursor: "pointer",
          }}
        >
          <ChevronDown style={{ width: 11, height: 11, transform: "rotate(180deg)" }} strokeWidth={2.2} />
          Collapse
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDoc();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 12px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: accent,
            background: `color-mix(in srgb, ${accent} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
            cursor: "pointer",
          }}
          title="Open as a scrollable document with full detail"
        >
          Open as document
          <ExternalLink style={{ width: 11, height: 11 }} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──

function DetailSection({
  icon,
  label,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 6,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        {icon}
        {label}
      </div>
      {children}
    </section>
  );
}

function ProvenanceBlock({
  provenance,
  accent,
}: {
  provenance: StrategyProvenance;
  accent: string;
}) {
  const score = provenance.overall_provenance_score ?? null;
  const scoreColor =
    score === null
      ? "#64748b"
      : score >= 80
        ? "#10b981"
        : score >= 60
          ? "#f59e0b"
          : "#ef4444";

  const missedCritical = provenance.critical_axioms_missed?.length ?? 0;
  const missedHidden = provenance.hidden_axioms_missed?.length ?? 0;
  const missedConv = provenance.strong_convergences_missed?.length ?? 0;
  const anyRedFlags = missedCritical + missedHidden + missedConv > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Score + breakdown pills */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {score !== null && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: `color-mix(in srgb, ${scoreColor} 12%, transparent)`,
              border: `2px solid ${scoreColor}`,
              fontSize: 12,
              fontWeight: 700,
              color: scoreColor,
              fontVariantNumeric: "tabular-nums",
            }}
            title="Overall provenance score (0-100)"
          >
            {score}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
          <ProvPill label="axioms" count={provenance.axioms_respected?.length ?? 0} accent={accent} />
          <ProvPill label="convergences" count={provenance.convergences_addressed?.length ?? 0} accent={accent} />
          <ProvPill label="gaps closed" count={provenance.coverage_gaps_closed?.length ?? 0} accent={accent} />
          <ProvPill label="inversions" count={provenance.inversions_considered?.length ?? 0} accent={accent} />
        </div>
      </div>

      {/* Red flags */}
      {anyRedFlags && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.06)",
            border: "1px solid rgba(239, 68, 68, 0.22)",
            fontSize: 11,
            color: "#991b1b",
          }}
        >
          <AlertTriangle style={{ width: 12, height: 12, marginTop: 1, flexShrink: 0 }} strokeWidth={2.2} />
          <span>
            <strong>Findings not addressed: </strong>
            {missedCritical > 0 && `${missedCritical} critical axiom${missedCritical > 1 ? "s" : ""}`}
            {missedCritical > 0 && (missedHidden + missedConv > 0) && " · "}
            {missedHidden > 0 && `${missedHidden} hidden axiom${missedHidden > 1 ? "s" : ""}`}
            {missedHidden > 0 && missedConv > 0 && " · "}
            {missedConv > 0 && `${missedConv} strong convergence${missedConv > 1 ? "s" : ""}`}
          </span>
        </div>
      )}
    </div>
  );
}

function ProvPill({ label, count, accent }: { label: string; count: number; accent: string }) {
  if (count === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color: accent,
        background: `color-mix(in srgb, ${accent} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
      }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{count}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </span>
  );
}

function LayersBlock({ layers, accent }: { layers: StrategyLayersData; accent: string }) {
  // Render four collapsible accordions, one per layer. Default to all
  // collapsed; user clicks to expand any layer's items.
  const rows: Array<{ key: string; label: string; items: LayerItem[] }> = [
    { key: "l4", label: "L4 Insights", items: layers.l4_insights ?? [] },
    { key: "l3", label: "L3 Reasoning", items: layers.l3_reasoning ?? [] },
    { key: "l2", label: "L2 Methods", items: layers.l2_methods ?? [] },
    { key: "l1", label: "L1 Outcomes", items: layers.l1_outcomes ?? [] },
  ].filter((r) => r.items.length > 0);

  if (rows.length === 0) {
    return <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>No layer decomposition available.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((row) => (
        <LayerAccordion key={row.key} label={row.label} items={row.items} accent={accent} />
      ))}
    </div>
  );
}

function LayerAccordion({ label, items, accent }: { label: string; items: LayerItem[]; accent: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 0",
          background: "transparent",
          border: "none",
          fontSize: 11,
          fontWeight: 600,
          color: "#475569",
          cursor: "pointer",
        }}
      >
        <ChevronDown
          style={{
            width: 10,
            height: 10,
            transform: open ? "rotate(0)" : "rotate(-90deg)",
            transition: "transform 180ms ease",
          }}
          strokeWidth={2}
        />
        {label}
        <span style={{ color: "#94a3b8", fontWeight: 500 }}>({items.length})</span>
      </button>
      {open && (
        <div style={{ marginLeft: 16, marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item, i) => (
            <div
              key={item.id ?? i}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(11,13,18,0.025)",
                fontSize: 11,
                lineHeight: 1.5,
                color: "rgba(11,13,18,0.78)",
              }}
            >
              {item.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.title}</div>}
              {item.summary && <div style={{ color: "#64748b" }}>{item.summary}</div>}
              {(item.pillar_sources ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                  {(item.pillar_sources ?? []).map((ps, j) => (
                    <span
                      key={j}
                      title={ps.contribution ?? ""}
                      style={{
                        fontSize: 9,
                        padding: "1.5px 6px",
                        borderRadius: 999,
                        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
                        color: accent,
                        fontWeight: 600,
                      }}
                    >
                      {ps.pillar} · {ps.source_refs.slice(0, 3).join(", ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TacticsBlock({
  tactics,
  accent,
  hoveredIdx,
  onHover,
  onLeave,
  onClick,
}: {
  tactics: TacticData[];
  accent: string;
  hoveredIdx: number | null;
  onHover: (i: number, entityIds: string[]) => void;
  onLeave: () => void;
  onClick: (entityIds: string[]) => void;
}) {
  // Extract entity-id mentions from the tactic's reference arrays.
  // The shape's source_refs use entity_id strings (C1, X3, etc.) —
  // we treat axiom_ids_respected as a proxy for entity refs (axioms
  // are entity-linked), plus subsystem_ids_targeted. Hidden_signal_refs
  // are signal slugs, not entity ids — they're shown but not glowed.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {tactics.map((tactic, i) => {
        const entityIds = [
          ...(tactic.axiom_ids_respected ?? []),
          ...(tactic.subsystem_ids_targeted ?? []),
        ].filter(Boolean);
        const isHovered = hoveredIdx === i;
        return (
          <div
            key={tactic.id ?? i}
            onMouseEnter={() => onHover(i, entityIds)}
            onMouseLeave={() => onLeave()}
            onClick={(e) => {
              e.stopPropagation();
              onClick(entityIds);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              cursor: entityIds.length > 0 ? "pointer" : "default",
              background: isHovered
                ? `color-mix(in srgb, ${accent} 6%, rgba(255,255,255,0.85))`
                : "rgba(255,255,255,0.85)",
              border: `1px solid ${isHovered ? `color-mix(in srgb, ${accent} 35%, transparent)` : "rgba(11,13,18,0.06)"}`,
              transition: "background 140ms ease, border 140ms ease",
            }}
          >
            {tactic.title && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(11,13,18,0.88)", marginBottom: 2 }}>
                {tactic.title}
              </div>
            )}
            {tactic.description && (
              <div style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.45 }}>
                {tactic.description}
              </div>
            )}
            {(entityIds.length > 0 ||
              (tactic.convergence_ids_addressed ?? []).length > 0 ||
              (tactic.hidden_signal_refs ?? []).length > 0) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5 }}>
                {entityIds.slice(0, 4).map((id, j) => (
                  <span
                    key={`e-${j}`}
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: `color-mix(in srgb, ${accent} 8%, transparent)`,
                      color: accent,
                      fontWeight: 600,
                      fontFamily: "monospace",
                    }}
                    title="Source entity (hover row to glow on canvas)"
                  >
                    {id}
                  </span>
                ))}
                {(tactic.convergence_ids_addressed ?? []).slice(0, 2).map((id, j) => (
                  <span
                    key={`c-${j}`}
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "rgba(139, 92, 246, 0.08)",
                      color: "#6d28d9",
                      fontWeight: 600,
                    }}
                    title="Convergence addressed"
                  >
                    conv:{id}
                  </span>
                ))}
                {(tactic.hidden_signal_refs ?? []).slice(0, 2).map((slug, j) => (
                  <span
                    key={`h-${j}`}
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "rgba(245, 158, 11, 0.08)",
                      color: "#b45309",
                      fontWeight: 600,
                    }}
                    title="Hidden signal addressed"
                  >
                    signal:{slug}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
