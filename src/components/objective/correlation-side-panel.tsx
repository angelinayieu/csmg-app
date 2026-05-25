"use client";

// ── Correlation side panel ──
//
// Docked panel on the right of the room. Shows ranked cross-layer
// correlations with:
//   - Filter chips: by layer pair (Pain↔Outcome, Pain↔Feature,
//     Feature↔Outcome, →Objective) and by strength threshold
//   - Hover → emits hovered entity ids up to the parent so the
//     lanes can highlight those items
//   - Per-row Approve / Reject buttons that PATCH edges.approved_at
//
// State is intentionally local: filter + hover live here, edge data
// + approvals lift back to the parent room view so a regenerate
// reset propagates.

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, Filter, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { RoomEdge } from "./sub-objective-room-view";

interface EntityRef {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  edges: RoomEdge[];
  entityIndex: Map<string, EntityRef>;
  /** Set of edge ids the user has approved. Mutated optimistically. */
  approvedEdgeIds: Set<string>;
  onApprovalChange: (edgeId: string, approved: boolean) => void;
  /** Lifts the currently hovered (or focused) edge to the parent so
   *  it can highlight the matching lane items. Empty set = no highlight. */
  onHighlightChange: (entityIds: Set<string>) => void;
}

// 4 chosen layer-pair filters — keep the common cases pickable.
const LAYER_PAIR_FILTERS: Array<{
  id: string;
  label: string;
  test: (s: EntityRef["layer"], t: EntityRef["layer"]) => boolean;
}> = [
  {
    id: "pain_feature",
    label: "Pain ↔ Feature",
    test: (s, t) =>
      (s === "pain" && t === "features") ||
      (s === "features" && t === "pain"),
  },
  {
    id: "feature_outcome",
    label: "Feature ↔ Outcome",
    test: (s, t) =>
      (s === "features" && t === "outcomes") ||
      (s === "outcomes" && t === "features"),
  },
  {
    id: "pain_outcome",
    label: "Pain ↔ Outcome",
    test: (s, t) =>
      (s === "pain" && t === "outcomes") ||
      (s === "outcomes" && t === "pain"),
  },
  {
    id: "to_objective",
    label: "→ Objective",
    test: (_s, t) => t === "objective",
  },
];

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

export function CorrelationSidePanel({
  spaceId,
  subObjectiveId,
  edges,
  entityIndex,
  approvedEdgeIds,
  onApprovalChange,
  onHighlightChange,
}: Props) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState<ThresholdMode>("all");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // ── Filtering ──
  const filtered = useMemo(() => {
    const thresholdMin =
      THRESHOLD_MODES.find((m) => m.id === threshold)?.min ?? 0;
    return edges
      .filter((e) => (e.strength ?? 0) >= thresholdMin)
      .filter((e) => {
        if (activeFilters.size === 0) return true;
        const s = entityIndex.get(e.source_entity_id);
        const t = entityIndex.get(e.target_entity_id);
        if (!s || !t) return false;
        for (const filterId of activeFilters) {
          const f = LAYER_PAIR_FILTERS.find((x) => x.id === filterId);
          if (f?.test(s.layer, t.layer)) return true;
        }
        return false;
      })
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  }, [edges, entityIndex, activeFilters, threshold]);

  function toggleFilter(id: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setApproval(edgeId: string, approved: boolean) {
    setBusyIds((prev) => new Set(prev).add(edgeId));
    // Optimistic UI: parent updates immediately.
    onApprovalChange(edgeId, approved);
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
        if (!res.ok) {
          // Revert on failure.
          onApprovalChange(edgeId, !approved);
        }
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

  function hoverEdge(e: RoomEdge | null) {
    if (!e) {
      onHighlightChange(new Set());
      return;
    }
    onHighlightChange(new Set([e.source_entity_id, e.target_entity_id]));
  }

  return (
    <aside
      className="flex h-fit w-full flex-col rounded-3xl p-4 lg:sticky lg:top-24 lg:w-[340px]"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
      aria-label="Cross-layer correlation panel"
    >
      <header>
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Correlations
        </div>
        <h3
          className="mt-1 text-[14px] font-semibold tracking-tight"
          style={{ color: appleVibe.text.primary }}
        >
          {filtered.length} of {edges.length} shown
        </h3>
        <p
          className="mt-0.5 text-[11px] font-light leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          Hover a row to highlight the linked items. Approve the ones
          you want promoted back to the main canvas.
        </p>
      </header>

      {/* Filter chips */}
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
          Layer pair
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {LAYER_PAIR_FILTERS.map((f) => {
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

      {/* Threshold pills */}
      <div className="mt-3 flex items-center gap-1.5">
        <ChevronDown
          className="h-3 w-3"
          strokeWidth={2}
          style={{ color: appleVibe.text.tertiary }}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: appleVibe.text.tertiary }}
        >
          Strength
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {THRESHOLD_MODES.map((m) => {
          const active = threshold === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setThreshold(m.id)}
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
              style={{
                background: active
                  ? appleVibe.accent.primary
                  : appleVibe.surface.chip,
                color: active
                  ? appleVibe.text.onAccent
                  : appleVibe.text.secondary,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <ul
        className="mt-3 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto"
        onMouseLeave={() => hoverEdge(null)}
      >
        {filtered.length === 0 && (
          <li
            className="rounded-2xl border border-dashed px-3 py-4 text-center text-[11.5px] font-light"
            style={{
              borderColor: appleVibe.stroke.hairline,
              color: appleVibe.text.tertiary,
              borderRadius: appleVibe.radius.md,
            }}
          >
            no correlations match these filters
          </li>
        )}
        {filtered.map((e) => {
          const src = entityIndex.get(e.source_entity_id);
          const tgt = entityIndex.get(e.target_entity_id);
          if (!src || !tgt) return null;
          const pct = Math.round((e.strength ?? 0) * 100);
          const approved = approvedEdgeIds.has(e.id);
          const busy = busyIds.has(e.id);
          return (
            <li
              key={e.id}
              onMouseEnter={() => hoverEdge(e)}
              onFocus={() => hoverEdge(e)}
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
                    <LayerChip layer={src.layer} />
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
                    <LayerChip layer={tgt.layer} />
                    <span
                      className="font-semibold leading-tight"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {tgt.name}
                    </span>
                  </div>

                  {/* Mechanism — the specific lever name the LLM
                      identified. Shown as a small pill so it reads
                      as a named THING the user can reason about,
                      not just narrative prose. */}
                  {(() => {
                    const mech =
                      e.agent_feedback &&
                      typeof e.agent_feedback === "object" &&
                      typeof (e.agent_feedback as Record<string, unknown>)
                        .mechanism === "string"
                        ? ((e.agent_feedback as Record<string, unknown>)
                            .mechanism as string)
                        : null;
                    if (!mech) return null;
                    return (
                      <div className="mt-1.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em]"
                          style={{
                            background: "rgba(15,23,42,0.05)",
                            color: appleVibe.text.secondary,
                            border: `1px solid ${appleVibe.stroke.hairline}`,
                          }}
                          title="Mechanism — the specific lever this edge pulls"
                        >
                          via {mech}
                        </span>
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

              {/* Approve / Reject */}
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
      </ul>
    </aside>
  );
}

// ── small helpers ──

const LAYER_COLORS: Record<EntityRef["layer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

const LAYER_LABEL_SHORT: Record<EntityRef["layer"], string> = {
  pain: "Pain",
  features: "Feat",
  outcomes: "Out",
  objective: "Obj",
};

function LayerChip({ layer }: { layer: EntityRef["layer"] }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{
        background: `${LAYER_COLORS[layer]}1A`,
        color: LAYER_COLORS[layer],
      }}
    >
      {LAYER_LABEL_SHORT[layer]}
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
