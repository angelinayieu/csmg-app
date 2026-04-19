"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, AlertTriangle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubComponent, InternalPathway, InternalDynamic } from "@/types/expansion";
import {
  enumeratePathways,
  type EnumeratedPathway,
} from "@/lib/pathways/enumerate-pathways";

interface PathwaysTableProps {
  sub_components: SubComponent[];
  internal_pathways: InternalPathway[];
  internal_dynamics?: InternalDynamic[];
  /** Called when the user selects/deselects a path row (for downstream highlighting) */
  onPathSelect?: (pathId: string | null) => void;
  /** Called when user adjusts probability overrides (for downstream visualizations) */
  onOverridesChange?: (overrides: Map<string, number>) => void;
  /** Display limit — table shows top N paths; user can expand. Default 10. */
  topN?: number;
}

/**
 * Pathways table — "the combinatorial space of how sub-components connect".
 *
 * Each row is one source→sink path through the entity's internal structure.
 * User can:
 *   - Sort by probability, min-hop, path length, importance
 *   - Select a row to see full hop breakdown
 *   - Override any hop's probability via slider — entire table recomputes live
 *   - Reset overrides back to the model's original probabilities
 *
 * Critical path (highest cumulative probability) is highlighted at the top.
 */
export function PathwaysTable({
  sub_components,
  internal_pathways,
  internal_dynamics,
  onPathSelect,
  onOverridesChange,
  topN = 10,
}: PathwaysTableProps) {
  // ── State ──
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"probability" | "min_hop" | "length" | "importance">(
    "probability",
  );
  const [showAll, setShowAll] = useState(false);

  // ── Enumerate paths (recomputes whenever overrides change) ──
  const result = useMemo(
    () =>
      enumeratePathways(sub_components, internal_pathways, internal_dynamics, {
        probabilityOverrides: overrides,
      }),
    [sub_components, internal_pathways, internal_dynamics, overrides],
  );

  // ── Sorted view ──
  const sortedPathways = useMemo(() => {
    const copy = [...result.pathways];
    const importanceRank: Record<string, number> = {
      critical: 0,
      important: 1,
      moderate: 2,
      minor: 3,
    };
    switch (sortKey) {
      case "probability":
        return copy.sort((a, b) => b.cumulative_probability - a.cumulative_probability);
      case "min_hop":
        return copy.sort((a, b) => b.min_hop_probability - a.min_hop_probability);
      case "length":
        return copy.sort((a, b) => a.hops.length - b.hops.length);
      case "importance":
        return copy.sort((a, b) => {
          const ra = a.max_importance ? importanceRank[a.max_importance] : 99;
          const rb = b.max_importance ? importanceRank[b.max_importance] : 99;
          return ra - rb;
        });
      default:
        return copy;
    }
  }, [result.pathways, sortKey]);

  const visiblePathways = showAll ? sortedPathways : sortedPathways.slice(0, topN);
  const hasOverrides = overrides.size > 0;

  // ── Build "unique edges" list for the slider panel ──
  // Every (source→target) in internal_pathways is a sliderable hop.
  const allHops = useMemo(() => {
    const map = new Map<string, InternalPathway>();
    for (const pw of internal_pathways) {
      map.set(`${pw.source_id}->${pw.target_id}`, pw);
    }
    return Array.from(map.values());
  }, [internal_pathways]);

  const subById = useMemo(() => new Map(sub_components.map((sc) => [sc.id, sc])), [sub_components]);

  // ── Handlers ──
  const updateOverride = (key: string, value: number) => {
    const next = new Map(overrides);
    next.set(key, value);
    setOverrides(next);
    onOverridesChange?.(next);
  };

  const clearOverride = (key: string) => {
    const next = new Map(overrides);
    next.delete(key);
    setOverrides(next);
    onOverridesChange?.(next);
  };

  const resetAll = () => {
    setOverrides(new Map());
    onOverridesChange?.(new Map());
  };

  const togglePath = (id: string) => {
    if (expandedPathId === id) {
      setExpandedPathId(null);
      setSelectedPathId(null);
      onPathSelect?.(null);
    } else {
      setExpandedPathId(id);
      setSelectedPathId(id);
      onPathSelect?.(id);
    }
  };

  // ── Empty state ──
  if (result.pathways.length === 0) {
    const msg =
      result.source_count === 0
        ? "No root sub-components — every component has incoming edges. This suggests a cycle-only topology (no entry points)."
        : result.sink_count === 0
          ? "No leaf sub-components — every component has outgoing edges. This suggests a cycle-only topology (no exit points)."
          : "Could not enumerate pathways. The internal pathway data may be empty or inconsistent.";
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
        <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-amber-500" />
        {msg}
      </div>
    );
  }

  const criticalId = result.critical_pathway_id;

  return (
    <div className="space-y-4">
      {/* ── Summary bar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-gray-400">Paths</span>
          <span className="rounded-full bg-white px-2 py-0.5 font-mono font-semibold text-gray-800">
            {result.pathways.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-gray-400">Sources</span>
          <span className="rounded-full bg-white px-2 py-0.5 font-mono font-semibold text-gray-800">
            {result.source_count}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-gray-400">Sinks</span>
          <span className="rounded-full bg-white px-2 py-0.5 font-mono font-semibold text-gray-800">
            {result.sink_count}
          </span>
        </div>
        {result.unreachable_node_ids.length > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span className="text-amber-700">
              {result.unreachable_node_ids.length} unreachable
            </span>
          </div>
        )}
        {hasOverrides && (
          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
              <Zap className="h-3 w-3" />
              {overrides.size} counterfactual {overrides.size === 1 ? "override" : "overrides"}
            </span>
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:text-gray-900"
              title="Reset all probability overrides"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        )}
      </div>

      {/* ── Sort controls ── */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-gray-400">Sort by</span>
        {(["probability", "min_hop", "length", "importance"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSortKey(key)}
            className={cn(
              "rounded-md px-2 py-1 font-medium transition-colors",
              sortKey === key
                ? "bg-interaxis-100 text-interaxis-700"
                : "text-gray-500 hover:text-gray-800",
            )}
          >
            {key === "probability" && "Cumulative probability"}
            {key === "min_hop" && "Weakest link"}
            {key === "length" && "Shortest path"}
            {key === "importance" && "Most critical"}
          </button>
        ))}
      </div>

      {/* ── Pathway rows ── */}
      <div className="space-y-1.5">
        {visiblePathways.map((pw, idx) => (
          <PathwayRow
            key={pw.id}
            pathway={pw}
            rank={idx + 1}
            isCritical={pw.id === criticalId}
            isSelected={pw.id === selectedPathId}
            isExpanded={pw.id === expandedPathId}
            onToggle={() => togglePath(pw.id)}
          />
        ))}

        {sortedPathways.length > topN && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full rounded-md border border-dashed border-gray-200 bg-white py-1.5 text-center text-[11px] font-semibold text-gray-500 hover:border-gray-300 hover:text-gray-700"
          >
            {showAll
              ? `Show top ${topN} only`
              : `Show all ${sortedPathways.length} paths`}
          </button>
        )}
      </div>

      {/* ── Counterfactual hop sliders ── */}
      <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-purple-600" />
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
            Counterfactual hop probabilities
          </h4>
          <span className="text-[10px] text-gray-500">
            Drag a slider to simulate a change in that hop&apos;s probability.
            Paths recompute live.
          </span>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {allHops.map((pw) => {
            const key = `${pw.source_id}->${pw.target_id}`;
            const original = pw.probability ?? 0.5;
            const override = overrides.get(key);
            const current = override ?? original;
            const diff = override !== undefined ? current - original : 0;
            const srcName = subById.get(pw.source_id)?.name ?? pw.source_id;
            const tgtName = subById.get(pw.target_id)?.name ?? pw.target_id;

            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]",
                  override !== undefined
                    ? "border-purple-300 bg-white"
                    : "border-gray-200 bg-white/60",
                )}
              >
                {/* Source → Target label */}
                <div className="flex min-w-0 flex-1 items-center gap-1 truncate">
                  <span className="truncate font-semibold text-gray-800">{srcName}</span>
                  <span className="shrink-0 text-gray-400">→</span>
                  <span className="truncate font-semibold text-gray-800">{tgtName}</span>
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={current}
                  onChange={(e) => updateOverride(key, parseFloat(e.target.value))}
                  className="h-1 w-32 accent-purple-600"
                  title={`Original: ${Math.round(original * 100)}% · Now: ${Math.round(current * 100)}%`}
                />

                {/* Probability value + delta */}
                <div className="flex w-24 shrink-0 items-center justify-end gap-1">
                  <span
                    className={cn(
                      "font-mono font-bold tabular-nums",
                      override !== undefined ? "text-purple-700" : "text-gray-700",
                    )}
                  >
                    {Math.round(current * 100)}%
                  </span>
                  {diff !== 0 && (
                    <span
                      className={cn(
                        "font-mono text-[10px] tabular-nums",
                        diff > 0 ? "text-emerald-600" : "text-rose-600",
                      )}
                    >
                      {diff > 0 ? "+" : ""}
                      {Math.round(diff * 100)}
                    </span>
                  )}
                </div>

                {/* Reset hop */}
                {override !== undefined && (
                  <button
                    onClick={() => clearOverride(key)}
                    className="shrink-0 text-gray-400 hover:text-gray-700"
                    title="Reset this hop to model probability"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Row component ───

function PathwayRow({
  pathway,
  rank,
  isCritical,
  isSelected,
  isExpanded,
  onToggle,
}: {
  pathway: EnumeratedPathway;
  rank: number;
  isCritical: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cumPct = Math.round(pathway.cumulative_probability * 100);
  const minPct = Math.round(pathway.min_hop_probability * 100);

  const importanceColor: Record<string, string> = {
    critical: "text-red-700 bg-red-100",
    important: "text-amber-700 bg-amber-100",
    moderate: "text-gray-600 bg-gray-100",
    minor: "text-gray-500 bg-gray-50",
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-white transition-all",
        isCritical && "border-emerald-300 shadow-sm",
        !isCritical && isSelected && "border-interaxis-300",
        !isCritical && !isSelected && "border-gray-200",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        {/* Rank */}
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
            isCritical ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600",
          )}
        >
          {rank}
        </div>

        {/* Path preview (node names chain) */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-[12px] font-semibold text-gray-800">
            <span className="truncate">{pathway.hops[0].from_name}</span>
            {pathway.hops.map((h, i) => (
              <span key={i} className="flex items-center gap-1 truncate">
                <span className="shrink-0 text-gray-400">→</span>
                <span className="truncate">{h.to_name}</span>
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
            <span>{pathway.hops.length} hops</span>
            {pathway.failure_points.length > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-600">
                <AlertTriangle className="h-2.5 w-2.5" />
                {pathway.failure_points.length} failure {pathway.failure_points.length === 1 ? "point" : "points"}
              </span>
            )}
            {pathway.has_conditional_hop && (
              <span className="text-amber-600">conditional</span>
            )}
            {pathway.max_importance && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                  importanceColor[pathway.max_importance],
                )}
              >
                {pathway.max_importance}
              </span>
            )}
          </div>
        </div>

        {/* Cumulative probability */}
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "font-mono text-sm font-bold tabular-nums",
              cumPct >= 60 ? "text-emerald-600" : cumPct >= 30 ? "text-amber-600" : "text-rose-600",
            )}
          >
            {cumPct}%
          </div>
          <div className="text-[9px] text-gray-400">min hop {minPct}%</div>
        </div>

        {/* Critical badge */}
        {isCritical && (
          <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Critical
          </span>
        )}

        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </button>

      {/* Expanded hop detail */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5 bg-gray-50/50">
          {pathway.hops.map((h, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md border border-gray-200 bg-white p-2 text-[11px]",
                h.overridden && "border-purple-300 bg-purple-50/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-gray-800">
                  {h.from_name} <span className="text-gray-400">→</span> {h.to_name}
                </div>
                <div className="flex items-center gap-2 font-mono text-gray-600 tabular-nums">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      h.probability >= 0.7
                        ? "bg-emerald-100 text-emerald-700"
                        : h.probability >= 0.4
                          ? "bg-amber-100 text-amber-700"
                          : "bg-rose-100 text-rose-700",
                      h.overridden && "ring-1 ring-purple-400",
                    )}
                  >
                    {Math.round(h.probability * 100)}%
                  </span>
                </div>
              </div>
              {h.mechanism && (
                <div className="mt-1 text-[11px] text-gray-600">{h.mechanism}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5">
                  {h.dynamics}
                </span>
                {h.dynamic_flags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-700"
                  >
                    {f.replace(/_/g, " ")}
                  </span>
                ))}
                {h.failure_mode && (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">
                    fails if: {h.failure_mode.slice(0, 60)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
