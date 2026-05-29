"use client";

// ── Correlation side panel (v3 — chain triples) ──
//
// PRIMARY VIEW (default): Chain triples — Friction → Mechanism →
// Result composed from the underlying edges. This is the actionable
// unit. Approving a chain approves both underlying edges and
// promotes the bet to the main canvas.
//
// SECONDARY VIEW: All edges — the legacy pair-wise display.
// Surfaces half-chains and lone edges that don't yet participate in
// a full triple, useful for the data-rigorous user.
//
// All vocabulary (filter chips, layer chips, hover popovers) is
// driven by the LLM-adaptive lane labels passed in by the room view
// so the panel speaks the same language as the rest of the room.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Filter,
  RefreshCw,
  Sparkles,
  X,
  AlertTriangle,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { RoomEdge } from "./sub-objective-room-view";
import {
  computeChains,
  type ChainTriple,
} from "@/lib/objective-canvas/compute-chains";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";
import { ChainCard, type ChainArchetype } from "./cards/chain-card";

interface EntityRef {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
}

export interface LaneLabelMap {
  pain: string;
  features: string;
  outcomes: string;
  objective: string;
}

/** Per-card detail the chain view needs (root_causes /
 *  first_principles / measured_by) lifted out of causal_chain
 *  jsonb by the room view. */
export interface ChainEntityDetail {
  /** entityId → root_causes[] (for pains) */
  rootCausesById: Map<string, string[]>;
  /** entityId → first_principles[] (for features) */
  firstPrinciplesById: Map<string, string[]>;
  /** entityId → measured_by (for outcomes) */
  measuredByById: Map<string, string | null>;
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  edges: RoomEdge[];
  entityIndex: Map<string, EntityRef>;
  approvedEdgeIds: Set<string>;
  onApprovalChange: (edgeId: string, approved: boolean) => void;
  /** Lifts hover into the parent so lanes highlight in sync. The
   *  parent maps a single entity id to all its linked ids via the
   *  edges graph. Pass null on leave. */
  onHoverEntity: (entityId: string | null) => void;
  /** Adaptive lane labels — driven by the LLM-chosen room labels. */
  laneLabels: LaneLabelMap;
  /** Per-entity detail used by the chain card's expand state. */
  detail: ChainEntityDetail;
  /** Tier 3 — room sub-category sets, used to resolve each chain's
   *  category triple → archetype display labels. */
  roomCategories?: RoomCategories;
  /** Annotation Lens hover state — when an edge in this panel has
   *  a derived_from_annotation matching this index, its chip
   *  flips to the hovered style. Hovering the chip itself drives
   *  onHoverAnnotation so the lanes light up the cards on the same
   *  annotation. Optional — when undefined the panel still renders
   *  the chips as static badges. */
  hoveredAnnotationIndex?: number | null;
  onHoverAnnotation?: (index: number | null) => void;
}

type ViewMode = "chains" | "edges";
type ThresholdMode = "all" | "weak" | "supportive" | "critical";

const THRESHOLD_MODES: Array<{
  id: ThresholdMode;
  label: string;
  min: number;
}> = [
  { id: "all", label: "All", min: 0 },
  { id: "weak", label: "≥ 30%", min: 0.3 },
  { id: "supportive", label: "≥ 50%", min: 0.5 },
  { id: "critical", label: "≥ 70%", min: 0.7 },
];

// ── Helpers ────────────────────────────────────────────────────────

/** Short 3-4 char ALL-CAPS abbreviation of an adaptive lane label.
 *  "Frictions" → "FRI", "Mechanisms" → "MEC", "Blockers" → "BLK".
 *  Falls through to the slug's first 3 letters when label is empty. */
function abbreviateLabel(label: string, fallback: string): string {
  const clean = (label || fallback).replace(/[^a-zA-Z]/g, "");
  return clean.slice(0, Math.min(4, Math.max(3, clean.length))).toUpperCase();
}

// ── Panel ──────────────────────────────────────────────────────────

export function CorrelationSidePanel({
  spaceId,
  subObjectiveId,
  edges,
  entityIndex,
  approvedEdgeIds,
  onApprovalChange,
  onHoverEntity,
  laneLabels,
  detail,
  roomCategories,
  hoveredAnnotationIndex,
  onHoverAnnotation,
}: Props) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);

  // Retry / generate correlations only — runs the correlation LLM
  // step against existing entities without regenerating the whole
  // room. Surfaces errors (the existing soft-fail in /room/generate
  // hid them behind a console.warn).
  function runCorrelationsRetry(mode: "initial" | "regenerate") {
    setRetryError(null);
    startRetry(async () => {
      try {
        const res = await fetch(
          "/api/brainstorm/room/correlations/generate",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ spaceId, subObjectiveId, mode }),
          },
        );
        const json = await res.json();
        if (!res.ok) {
          const base = json?.error ?? "Correlation generation failed.";
          setRetryError(json?.detail ? `${base} — ${json.detail}` : base);
          return;
        }
        router.refresh();
      } catch (err) {
        setRetryError(
          err instanceof Error ? err.message : "Network error.",
        );
      }
    });
  }
  // Resolve a chain's category triple into {label, color} display
  // data. Used as the archetype label on each ChainCard.
  function resolveArchetype(chain: ChainTriple): ChainArchetype {
    if (!roomCategories) {
      return { pain: null, feature: null, result: null };
    }
    const lookup = (
      lane: "friction" | "mechanism" | "result",
      slug: string | null,
    ) => {
      if (!slug) return null;
      const hit = roomCategories[lane].find((c) => c.slug === slug);
      return hit ? { label: hit.label, color: hit.color } : null;
    };
    return {
      pain: lookup("friction", chain.categoryTriple.painSlug),
      feature: lookup("mechanism", chain.categoryTriple.featureSlug),
      result: lookup("result", chain.categoryTriple.resultSlug),
    };
  }
  const [viewMode, setViewMode] = useState<ViewMode>("chains");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState<ThresholdMode>("all");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // Adaptive labels for the filter chips. Build the layer-pair
  // filters dynamically from laneLabels so vocabulary matches the
  // rest of the room.
  const pairFilters = useMemo(
    () => [
      {
        id: "pain_feature",
        label: `${laneLabels.pain} ↔ ${laneLabels.features}`,
        test: (s: EntityRef["layer"], t: EntityRef["layer"]) =>
          (s === "pain" && t === "features") ||
          (s === "features" && t === "pain"),
      },
      {
        id: "feature_outcome",
        label: `${laneLabels.features} ↔ ${laneLabels.outcomes}`,
        test: (s: EntityRef["layer"], t: EntityRef["layer"]) =>
          (s === "features" && t === "outcomes") ||
          (s === "outcomes" && t === "features"),
      },
      {
        id: "pain_outcome",
        label: `${laneLabels.pain} ↔ ${laneLabels.outcomes}`,
        test: (s: EntityRef["layer"], t: EntityRef["layer"]) =>
          (s === "pain" && t === "outcomes") ||
          (s === "outcomes" && t === "pain"),
      },
      {
        id: "to_objective",
        label: `→ ${laneLabels.objective}`,
        test: (_s: EntityRef["layer"], t: EntityRef["layer"]) =>
          t === "objective",
      },
    ],
    [laneLabels],
  );

  // ── Chains ──
  const chains = useMemo(
    () => computeChains(edges, entityIndex),
    [edges, entityIndex],
  );

  // Filtered chains (strength threshold; pair-filters don't apply
  // since chains span all three layers by construction).
  const filteredChains = useMemo(() => {
    const min = THRESHOLD_MODES.find((m) => m.id === threshold)?.min ?? 0;
    return chains.filter((c) => c.composite >= min);
  }, [chains, threshold]);

  // Alternatives by friction id — for each friction, list all
  // mechanisms+results that ALSO chain off it (excluding the
  // mechanism currently being displayed). Used in the expand.
  const alternativesByPain = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        featureName: string;
        outcomeName: string;
        strength: number;
        featureId: string;
      }>
    >();
    for (const c of chains) {
      const list = map.get(c.painId) ?? [];
      list.push({
        featureName: c.featureName,
        outcomeName: c.outcomeName,
        strength: c.composite,
        featureId: c.featureId,
      });
      map.set(c.painId, list);
    }
    for (const v of map.values()) v.sort((a, b) => b.strength - a.strength);
    return map;
  }, [chains]);

  // ── Edges (secondary view) ──
  const filteredEdges = useMemo(() => {
    const min = THRESHOLD_MODES.find((m) => m.id === threshold)?.min ?? 0;
    return edges
      .filter((e) => (e.strength ?? 0) >= min)
      .filter((e) => {
        if (activeFilters.size === 0) return true;
        const s = entityIndex.get(e.source_entity_id);
        const t = entityIndex.get(e.target_entity_id);
        if (!s || !t) return false;
        for (const filterId of activeFilters) {
          const f = pairFilters.find((x) => x.id === filterId);
          if (f?.test(s.layer, t.layer)) return true;
        }
        return false;
      })
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  }, [edges, entityIndex, activeFilters, threshold, pairFilters]);

  function toggleFilter(id: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Approval ──
  async function setApproval(edgeId: string, approved: boolean) {
    setBusyIds((prev) => new Set(prev).add(edgeId));
    onApprovalChange(edgeId, approved); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/room/edges/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            subObjectiveId,
            edgeId,
            approved,
          }),
        });
        if (!res.ok) onApprovalChange(edgeId, !approved);
      } catch {
        onApprovalChange(edgeId, !approved);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(edgeId);
          return next;
        });
      }
    });
  }

  // Chain approval = approve both underlying edges in sequence.
  // Status is derived (chain.approved when both edges approved).
  async function approveChain(c: ChainTriple) {
    const pfId = c.painFeatureEdge.id;
    const foId = c.featureOutcomeEdge.id;
    if (!approvedEdgeIds.has(pfId)) await setApproval(pfId, true);
    if (!approvedEdgeIds.has(foId)) await setApproval(foId, true);
  }
  async function rejectChain(c: ChainTriple) {
    const pfId = c.painFeatureEdge.id;
    const foId = c.featureOutcomeEdge.id;
    if (approvedEdgeIds.has(pfId)) await setApproval(pfId, false);
    if (approvedEdgeIds.has(foId)) await setApproval(foId, false);
  }

  return (
    <aside
      id="correlation-side-panel-anchor"
      className="flex h-fit w-full flex-col rounded-3xl p-4 lg:sticky lg:top-24 lg:w-[380px]"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
      aria-label="Correlation chains panel"
    >
      <header>
        <div className="flex items-center justify-between">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            Correlations
          </div>
          {edges.length > 0 && (
            <button
              type="button"
              onClick={() => runCorrelationsRetry("regenerate")}
              disabled={retrying}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.tertiary,
                cursor: retrying ? "wait" : "pointer",
              }}
              title="Re-run the correlation LLM step against the existing entities"
            >
              <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.5} />
              {retrying ? "Retrying…" : "Re-run"}
            </button>
          )}
        </div>
        <h3
          className="mt-1 text-[14px] font-semibold tracking-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {edges.length === 0
            ? "No correlations yet"
            : viewMode === "chains"
              ? `${filteredChains.length} of ${chains.length} chains`
              : `${filteredEdges.length} of ${edges.length} edges`}
        </h3>
        <p
          className="mt-1 text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          {edges.length === 0
            ? `The room has items but they aren't linked yet. Each correlation forms one complete ${laneLabels.pain.toLowerCase()} → ${laneLabels.features.toLowerCase()} → ${laneLabels.outcomes.toLowerCase()} chain — the hypothesis you'll approve. Run the correlation step to populate.`
            : `Each chain is a complete ${laneLabels.pain.toLowerCase()} → ${laneLabels.features.toLowerCase()} → ${laneLabels.outcomes.toLowerCase()} hypothesis. Approve the ones you want promoted to the main canvas.`}
        </p>
      </header>

      {/* Empty state — surfaces the "no edges" recovery path */}
      {edges.length === 0 && (
        <div
          className="mt-3 rounded-2xl p-3"
          style={{
            background: "rgba(15,23,42,0.03)",
            border: `1px dashed ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.md,
          }}
        >
          <button
            type="button"
            onClick={() => runCorrelationsRetry("initial")}
            disabled={retrying}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-[12px] font-semibold"
            style={{
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              borderRadius: appleVibe.radius.md,
              cursor: retrying ? "wait" : "pointer",
              opacity: retrying ? 0.7 : 1,
            }}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {retrying ? "Generating…" : "Generate correlations"}
          </button>
          <p
            className="mt-2 text-[10.5px] font-light italic leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            Cheaper than &quot;Regenerate the room&quot; — only the
            correlation LLM call runs. Existing items stay intact.
          </p>
        </div>
      )}

      {retryError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          <AlertTriangle
            className="h-3 w-3 flex-shrink-0"
            strokeWidth={2}
          />
          <span className="leading-snug">{retryError}</span>
        </div>
      )}

      {/* View toggle — Chains (primary) vs All edges.
          Hidden when there are no edges; the empty state above
          carries the active CTA so the toggle would be noise. */}
      {edges.length > 0 && (
      <div className="mt-3 inline-flex w-fit rounded-full p-0.5" style={{
        background: appleVibe.surface.chip,
      }}>
        <button
          type="button"
          onClick={() => setViewMode("chains")}
          className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
          style={{
            background:
              viewMode === "chains" ? appleVibe.accent.primary : "transparent",
            color:
              viewMode === "chains"
                ? appleVibe.text.onAccent
                : appleVibe.text.secondary,
          }}
        >
          Chains
        </button>
        <button
          type="button"
          onClick={() => setViewMode("edges")}
          className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
          style={{
            background:
              viewMode === "edges" ? appleVibe.accent.primary : "transparent",
            color:
              viewMode === "edges"
                ? appleVibe.text.onAccent
                : appleVibe.text.secondary,
          }}
        >
          All edges
        </button>
      </div>
      )}

      {/* Edges-only filter chips */}
      {edges.length > 0 && viewMode === "edges" && (
        <>
          <div className="mt-3 flex items-center gap-1.5">
            <Filter
              className="h-3 w-3"
              strokeWidth={2}
              style={{ color: appleVibe.text.tertiary }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: appleVibe.text.tertiary }}
            >
              Stage pair
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pairFilters.map((f) => {
              const active = activeFilters.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleFilter(f.id)}
                  aria-pressed={active}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                  style={{
                    background: active
                      ? appleVibe.accent.primary
                      : appleVibe.surface.chip,
                    color: active
                      ? appleVibe.text.onAccent
                      : appleVibe.text.secondary,
                  }}
                >
                  {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  <span>{f.label}</span>
                </button>
              );
            })}
            {activeFilters.size > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilters(new Set())}
                className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[10.5px] font-semibold"
                style={{
                  background: "transparent",
                  color: appleVibe.text.tertiary,
                }}
              >
                <X className="h-2.5 w-2.5" strokeWidth={2} />
                clear
              </button>
            )}
          </div>
        </>
      )}

      {/* Strength threshold (applies to both views) — hidden in
          empty state since there's nothing to threshold. The eyebrow
          row is dropped — the inline "Strength" label sits with the
          chips as a single quiet filter row. */}
      {edges.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            className="text-[10.5px] font-medium tracking-tight"
            style={{ color: appleVibe.text.tertiary }}
          >
            Strength
          </span>
          {THRESHOLD_MODES.map((m) => {
            const active = threshold === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setThreshold(m.id)}
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-medium tracking-tight transition-colors"
                style={{
                  background: active
                    ? appleVibe.accent.primary
                    : "transparent",
                  color: active
                    ? appleVibe.text.onAccent
                    : appleVibe.text.secondary,
                  border: active
                    ? "1px solid transparent"
                    : `1px solid ${appleVibe.stroke.soft}`,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Rows */}
      <ul
        className="mt-4 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-0.5"
        onMouseLeave={() => onHoverEntity(null)}
      >
        {viewMode === "chains" && (
          <>
            {filteredChains.length === 0 && (
              <EmptyState
                msg={
                  chains.length === 0
                    ? "No complete chains yet. Regenerate the room — the new prompt requires feature→outcome edges so chains can compose."
                    : "No chains match the strength threshold."
                }
              />
            )}
            {filteredChains.map((c) => {
              const approved =
                approvedEdgeIds.has(c.painFeatureEdge.id) &&
                approvedEdgeIds.has(c.featureOutcomeEdge.id);
              const busy =
                busyIds.has(c.painFeatureEdge.id) ||
                busyIds.has(c.featureOutcomeEdge.id);
              const altList = (alternativesByPain.get(c.painId) ?? []).filter(
                (a) => a.featureId !== c.featureId,
              );
              return (
                <ChainCard
                  key={c.id}
                  chain={c}
                  laneLabels={{
                    pain: laneLabels.pain,
                    features: laneLabels.features,
                    outcomes: laneLabels.outcomes,
                  }}
                  archetype={resolveArchetype(c)}
                  painRootCauses={detail.rootCausesById.get(c.painId) ?? []}
                  featureFirstPrinciples={
                    detail.firstPrinciplesById.get(c.featureId) ?? []
                  }
                  outcomeMeasuredBy={
                    detail.measuredByById.get(c.outcomeId) ?? null
                  }
                  alternatives={altList.map((a) => ({
                    name: a.featureName,
                    strength: a.strength,
                    outcomeName: a.outcomeName,
                  }))}
                  approved={approved}
                  busy={busy}
                  onApprove={() => approveChain(c)}
                  onReject={() => rejectChain(c)}
                  onHover={onHoverEntity}
                />
              );
            })}
          </>
        )}

        {viewMode === "edges" && (
          <>
            {filteredEdges.length === 0 && (
              <EmptyState msg="No edges match these filters." />
            )}
            {filteredEdges.map((e) => {
              const src = entityIndex.get(e.source_entity_id);
              const tgt = entityIndex.get(e.target_entity_id);
              if (!src || !tgt) return null;
              const pct = Math.round((e.strength ?? 0) * 100);
              const approved = approvedEdgeIds.has(e.id);
              const busy = busyIds.has(e.id);
              return (
                <li
                  key={e.id}
                  onMouseEnter={() => onHoverEntity(e.source_entity_id)}
                  onFocus={() => onHoverEntity(e.source_entity_id)}
                  className="rounded-2xl p-2.5 transition-colors"
                  style={{
                    background: approved
                      ? "rgba(22,163,74,0.06)"
                      : appleVibe.surface.base,
                    border: `1px solid ${
                      approved
                        ? "rgba(22,163,74,0.25)"
                        : appleVibe.stroke.hairline
                    }`,
                    borderRadius: appleVibe.radius.md,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <ConfidenceDot pct={pct} polarity={e.polarity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-1 text-[11.5px]">
                        <LayerChip
                          layer={src.layer}
                          laneLabels={laneLabels}
                        />
                        <span
                          className="font-semibold leading-tight"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {src.name}
                        </span>
                      </div>
                      <div
                        className="my-0.5 text-[10px] font-light italic"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        {e.relationship_type}{" "}
                        <span style={{ color: appleVibe.text.faint }}>
                          ({pct}%)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-1 text-[11.5px]">
                        <LayerChip
                          layer={tgt.layer}
                          laneLabels={laneLabels}
                        />
                        <span
                          className="font-semibold leading-tight"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {tgt.name}
                        </span>
                      </div>
                      {(() => {
                        const fb =
                          e.agent_feedback &&
                          typeof e.agent_feedback === "object"
                            ? (e.agent_feedback as Record<string, unknown>)
                            : {};
                        const mech =
                          typeof fb.mechanism === "string" ? fb.mechanism : null;
                        // derived_from_annotation: { index, phrase, facet }
                        // persisted by the route's resolveProvenance().
                        const dfa =
                          fb.derived_from_annotation &&
                          typeof fb.derived_from_annotation === "object"
                            ? (fb.derived_from_annotation as Record<
                                string,
                                unknown
                              >)
                            : null;
                        const annPhrase =
                          dfa && typeof dfa.phrase === "string"
                            ? dfa.phrase
                            : null;
                        const annIndex =
                          dfa &&
                          typeof dfa.index === "number" &&
                          Number.isFinite(dfa.index)
                            ? (dfa.index as number)
                            : null;
                        const annFacet =
                          dfa && typeof dfa.facet === "string"
                            ? (dfa.facet as string)
                            : null;
                        if (!mech && !annPhrase) return null;
                        const annHovered =
                          annIndex !== null &&
                          hoveredAnnotationIndex === annIndex;
                        return (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {mech && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em]"
                                style={{
                                  background: "rgba(15,23,42,0.05)",
                                  color: appleVibe.text.secondary,
                                  border: `1px solid ${appleVibe.stroke.hairline}`,
                                }}
                                title="Mechanism — the lever this edge pulls"
                              >
                                via {mech}
                              </span>
                            )}
                            {annPhrase && annIndex !== null && (
                              <button
                                type="button"
                                onMouseEnter={() =>
                                  onHoverAnnotation?.(annIndex)
                                }
                                onMouseLeave={() => onHoverAnnotation?.(null)}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onHoverAnnotation?.(
                                    annHovered ? null : annIndex,
                                  );
                                }}
                                className="inline-flex max-w-[180px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium transition-all"
                                style={{
                                  background: annHovered
                                    ? "rgba(15,23,42,0.10)"
                                    : "rgba(15,23,42,0.035)",
                                  color: appleVibe.text.secondary,
                                  border: `1px solid ${
                                    annHovered
                                      ? "rgba(15,23,42,0.22)"
                                      : appleVibe.stroke.hairline
                                  }`,
                                  cursor: "pointer",
                                }}
                                title={`Annotation provenance${
                                  annFacet ? ` · ${annFacet}` : ""
                                } · ${annPhrase}`}
                              >
                                <span
                                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                                  style={{
                                    background:
                                      annFacet === "tension"
                                        ? "rgba(217,119,6,0.78)"
                                        : annFacet === "inference"
                                          ? "rgba(124,58,237,0.78)"
                                          : annFacet === "fragility"
                                            ? "rgba(220,38,38,0.78)"
                                            : annFacet === "analogy"
                                              ? "rgba(37,99,235,0.78)"
                                              : annFacet === "dimension"
                                                ? "rgba(22,163,74,0.78)"
                                                : "rgba(15,23,42,0.45)",
                                  }}
                                  aria-hidden
                                />
                                <span className="truncate">↳ {annPhrase}</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      {e.conditions && (
                        <p
                          className="mt-1.5 line-clamp-3 text-[11px] font-light leading-snug"
                          style={{ color: appleVibe.text.secondary }}
                          title={e.conditions}
                        >
                          {e.conditions}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setApproval(e.id, false)}
                      disabled={busy || !approved}
                      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: !approved
                          ? "transparent"
                          : appleVibe.surface.chip,
                        color: appleVibe.text.tertiary,
                        cursor: busy || !approved ? "default" : "pointer",
                        opacity: !approved ? 0.5 : 1,
                      }}
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2} />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setApproval(e.id, true)}
                      disabled={busy || approved}
                      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: approved
                          ? "rgba(22,163,74,0.12)"
                          : appleVibe.accent.primary,
                        color: approved
                          ? "rgba(20,83,45,0.95)"
                          : appleVibe.text.onAccent,
                        cursor: busy || approved ? "default" : "pointer",
                      }}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      {approved ? "Approved" : "Approve"}
                    </button>
                  </div>
                </li>
              );
            })}
          </>
        )}
      </ul>
    </aside>
  );
}

// ── small helpers ──

function EmptyState({ msg }: { msg: string }) {
  return (
    <li
      className="rounded-2xl border border-dashed px-3 py-4 text-center text-[11.5px] font-light"
      style={{
        borderColor: appleVibe.stroke.hairline,
        color: appleVibe.text.tertiary,
        borderRadius: appleVibe.radius.md,
      }}
    >
      {msg}
    </li>
  );
}

const LAYER_COLORS: Record<EntityRef["layer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

function LayerChip({
  layer,
  laneLabels,
}: {
  layer: EntityRef["layer"];
  laneLabels: LaneLabelMap;
}) {
  const fallback = layer;
  const short = abbreviateLabel(laneLabels[layer], fallback);
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{
        background: `${LAYER_COLORS[layer]}1A`,
        color: LAYER_COLORS[layer],
      }}
    >
      {short}
    </span>
  );
}

function ConfidenceDot({
  pct,
  polarity,
}: {
  pct: number;
  polarity: string | null;
}) {
  const color =
    polarity === "negative"
      ? "#DC2626"
      : pct >= 75
        ? "#16A34A"
        : pct >= 50
          ? "#D97706"
          : "#94A3B8";
  return (
    <span
      className="mt-0.5 block h-2 w-2 flex-shrink-0 rounded-full"
      style={{ background: color }}
      aria-hidden
    />
  );
}
