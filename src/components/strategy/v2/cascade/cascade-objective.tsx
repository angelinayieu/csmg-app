"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CascadeObjective, CascadeRowVM } from "../strategy-view-model";
import { palette } from "../strategy-palette";
import { MechanismChain } from "./mechanism-chain";
import {
  STRATEGY_OBJECTIVE_DRAG_MIME,
  type StrategyObjectiveDragPayload,
} from "@/components/canvas/strategy-objective-drag";
import { useStrategyCanvasPresence } from "@/components/canvas/strategy-canvas-presence-context";
import { useSpaceData } from "@/contexts/space-data-context";
import { GoalImpactDecompositionDrawer } from "./goal-impact-decomposition-drawer";
import { bucketEvidenceByEntity } from "@/lib/twin/impact-weighted-metric";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import { RigorMark } from "@/components/canvas/shapes/rigor-mark";

// Module-level cache so N cascade rows don't trigger N separate
// /evidence fetches. First row to fetch resolves the Promise and
// every subsequent caller gets the cached Map. Cleared by spaceId
// change so a different space's data doesn't leak across mounts.
const _evidenceCache = new Map<
  string,
  Promise<Map<string, EvidenceRegistryRow[]>>
>();
function fetchEvidenceForSpace(
  spaceId: string,
): Promise<Map<string, EvidenceRegistryRow[]>> {
  const cached = _evidenceCache.get(spaceId);
  if (cached) return cached;
  const promise = fetch(
    `/api/spaces/${encodeURIComponent(spaceId)}/evidence?limit=500`,
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((payload) => {
      const rows = (payload?.rows ?? []) as EvidenceRegistryRow[];
      return bucketEvidenceByEntity(rows);
    })
    .catch(() => new Map<string, EvidenceRegistryRow[]>());
  _evidenceCache.set(spaceId, promise);
  return promise;
}

interface CascadeObjectiveProps {
  objective: CascadeObjective;
  row: CascadeRowVM;
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  onLayoutChange?: () => void;
}

export function CascadeObjectiveCard({
  objective,
  row,
  causalChains,
  entityMap,
  spaceId,
  onLayoutChange,
}: CascadeObjectiveProps) {
  const p = palette(row.paletteKey);
  const [expanded, setExpanded] = useState(false);
  // Decomposition drawer state — separate from row expansion so opening
  // the drawer doesn't expand the cascade row underneath it.
  const [decompositionOpen, setDecompositionOpen] = useState(false);
  const presence = useStrategyCanvasPresence();
  const isOnCanvas = presence.objectiveIds.has(objective.id);

  // Pull edges + active goal from the space-data context so the drawer
  // can walk per-chain edges without prop-drilling them through three
  // cascade ancestors.
  const spaceData = useSpaceData();
  const drawerEdges = spaceData.edges;
  const activeGoal = spaceData.activeGoal;

  // entityNameById — derived from the entityMap that's already in
  // scope. Keys on entity_id (the chain.entity_ids[] uses entity_id
  // strings, not row.id).
  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entityMap.values()) {
      if (e.entity_id) map.set(e.entity_id, e.name);
    }
    return map;
  }, [entityMap]);

  // Evidence pulled from the cached space-level fetch. The Map is
  // empty until the first fetch resolves; the drawer renders honest
  // empty states for the evidence section in the interim (n_studies=0,
  // no pooled effect, "not yet aggregated").
  const [evidenceByEntity, setEvidenceByEntity] = useState<
    Map<string, EvidenceRegistryRow[]>
  >(() => new Map());
  useEffect(() => {
    let cancelled = false;
    if (!spaceId) return;
    fetchEvidenceForSpace(spaceId).then((m) => {
      if (!cancelled) setEvidenceByEntity(m);
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const matchedChain = objective.matchedChainId
    ? causalChains.find((c) => c.id === objective.matchedChainId)
    : null;

  const handleToggle = () => {
    setExpanded((v) => !v);
    // Notify parent to redraw SVG routing after height change
    setTimeout(() => onLayoutChange?.(), 260);
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!spaceId) {
        e.preventDefault();
        return;
      }
      // Don't toggle expanded on drag-start (the click handler still fires
      // on drop without movement, but native drag suppresses click).
      e.dataTransfer.effectAllowed = "copy";
      const payload: StrategyObjectiveDragPayload = {
        spaceId,
        objectiveId: objective.id,
        title: objective.title,
        description: objective.description ?? null,
        // The canvas shape requires a numeric progress for its inline bar;
        // qualitative / untracked objectives drop on the canvas at 0% and
        // the user can update it once execution data exists.
        progressPct: objective.progressPct ?? 0,
        // Drag payload contract still requires a definite tag for shape
        // styling — when the cascade row chose to hide the chip (null),
        // default the dropped canvas card to "lead" rather than failing.
        tag: objective.tag ?? "lead",
        valueLabel: objective.valueLabel ?? null,
        paletteKey: row.paletteKey,
        sourceEntityIds: objective.sourceEntityIds,
        perspectiveLabel: row.categoryLabel,
      };
      e.dataTransfer.setData(
        STRATEGY_OBJECTIVE_DRAG_MIME,
        JSON.stringify(payload),
      );
      // text/plain fallback for non-canvas drop targets.
      const fallbackText = objective.description
        ? `${objective.title}\n\n${objective.description}`
        : objective.title;
      e.dataTransfer.setData("text/plain", fallbackText);
    },
    [spaceId, objective, row.paletteKey, row.categoryLabel],
  );

  return (
    <div
      draggable={Boolean(spaceId)}
      onDragStart={handleDragStart}
      className={cn(
        "rounded-[8px] overflow-hidden transition-all cursor-pointer",
        spaceId && "active:cursor-grabbing",
      )}
      onClick={handleToggle}
      title={
        spaceId
          ? "Click to expand · drag onto the canvas to pin this objective"
          : undefined
      }
      style={{
        background: "#fff",
        border: expanded
          ? `1px solid ${p.accent}`
          : "1px solid rgba(11,13,18,0.08)",
        boxShadow: expanded ? `0 0 0 2px ${p.tint}` : "0 1px 2px rgba(11,13,18,0.03)",
      }}
    >
      {/* Head */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="flex-1 min-w-0">
          <p
            className="font-semibold mb-1.5 truncate"
            style={{
              fontSize: "12.5px",
              color: "#0B0D12",
              letterSpacing: "-0.005em",
              lineHeight: 1.3,
            }}
          >
            {objective.title}
          </p>
          {/* Progress bar only renders when we have a numeric percent. For
              qualitative metrics (current/target = "high"/"low") and for
              action-derived objectives that haven't been tracked yet, the
              valueLabel below carries the meaningful info instead. */}
          {objective.progressPct !== undefined && (
            <div
              className="h-[3px] rounded-full overflow-hidden relative"
              style={{ background: "rgba(11,13,18,0.06)" }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full"
                style={{
                  width: `${objective.progressPct}%`,
                  background: p.accent,
                }}
              />
            </div>
          )}
          {objective.valueLabel && (
            <p
              className="mt-1 font-mono"
              style={{
                fontSize: "9.5px",
                color: "rgba(11,13,18,0.48)",
                fontWeight: 500,
              }}
            >
              {objective.valueLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOnCanvas && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                presence.zoomToObjective(objective.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors"
              style={{
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.32)",
                color: "#047857",
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
              title="Pinned on canvas — click to zoom there"
              aria-label="Zoom to this objective on canvas"
            >
              <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />
              On canvas
            </button>
          )}
          {objective.progressPct !== undefined &&
            (objective.impact ? (
              // Impact chip — clickable, opens the decomposition drawer.
              // Hover reveals the full breakdown; click opens the audit.
              // Pill-shaped with hairline border + soft fill so it reads
              // as an actionable affordance, not a passive readout.
              (() => {
                // Phase 0 rigor: pick the chip's glyph variant by which
                // tier family dominates the pooling. Three cases:
                //   • anchored — at least one paper-sourced row pooled
                //   • drifted  — pooling is web/legacy only
                //   • none     — no pooled evidence at all (glyph hidden)
                // The chip's border + tint shift subtly on the drifted
                // path so the warning is readable at-a-glance without
                // overwhelming the layout.
                const ev = objective.impact.evidence;
                const hasAnchored = ev.n_anchored > 0;
                const hasDrifted = ev.n_drifted > 0;
                const drifted = hasDrifted && !hasAnchored;
                const showGlyph = ev.n_studies > 0;
                const baseBg = drifted
                  ? "rgba(180, 83, 9, 0.06)"
                  : "rgba(11,13,18,0.04)";
                const hoverBg = drifted
                  ? "rgba(180, 83, 9, 0.10)"
                  : "rgba(11,13,18,0.07)";
                const baseBorder = drifted
                  ? "1px solid rgba(180, 83, 9, 0.28)"
                  : "1px solid rgba(11,13,18,0.08)";
                const hoverBorder = drifted
                  ? "1px solid rgba(180, 83, 9, 0.48)"
                  : "1px solid rgba(11,13,18,0.16)";
                const glyphColor = drifted ? "#B45309" : "#0F766E";
                const tierLine =
                  ev.n_studies > 0
                    ? ` · n=${ev.n_studies}${
                        ev.n_drifted > 0
                          ? ` (${ev.n_anchored} anchored · ${ev.n_drifted} drifted)`
                          : ""
                      }`
                    : "";
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDecompositionOpen(true);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    className="tabular-nums"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: "11.5px",
                      fontWeight: 700,
                      color: "#0B0D12",
                      letterSpacing: "-0.02em",
                      textAlign: "right",
                      background: baseBg,
                      border: baseBorder,
                      borderRadius: 999,
                      padding: "3px 10px",
                      cursor: "pointer",
                      transition:
                        "background 120ms ease-out, border-color 120ms ease-out",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = hoverBg;
                      e.currentTarget.style.border = hoverBorder;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = baseBg;
                      e.currentTarget.style.border = baseBorder;
                    }}
                    title={
                      `${objective.impact.pct.toFixed(1)}% expected goal impact · ` +
                      `${objective.impact.chains.length} chain${objective.impact.chains.length === 1 ? "" : "s"}` +
                      tierLine +
                      (ev.i_squared !== null
                        ? `, I²=${Math.round(ev.i_squared)}%`
                        : "") +
                      ` · confidence ${objective.impact.confidence.toFixed(2)}` +
                      // Phase F: when calibration is loaded for this stage,
                      // surface the tracking number in the tooltip so the
                      // user sees their predictions are factored in without
                      // opening the drawer. `blended` distinguishes "this
                      // moved confidence" from "informational only".
                      (objective.impact.calibration
                        ? ` · ±${objective.impact.calibration.mean_abs_delta_strength.toFixed(2)} drift across ${objective.impact.calibration.n_rows} prediction${objective.impact.calibration.n_rows === 1 ? "" : "s"}${objective.impact.calibration.blended ? " (blended)" : ""}`
                        : "") +
                      (drifted
                        ? " · pool is web/legacy only — see decomposition for tier breakdown"
                        : "") +
                      " — click to see the math"
                    }
                    aria-label={`Open decomposition for ${objective.title}${
                      drifted ? " (low-rigor pool)" : ""
                    }`}
                  >
                    {showGlyph && (
                      <RigorMark
                        tier={hasAnchored ? "paper_extracted" : "web_heuristic"}
                        size={10}
                        showTitle={false}
                        style={{ color: glyphColor }}
                      />
                    )}
                    {objective.impact.pct.toFixed(1)}% goal impact
                  </button>
                );
              })()
            ) : (
              // Legacy: bare key-metric ratio, kept honest via tooltip.
              // No drawer because there's no decomposition to show.
              <span
                className="tabular-nums"
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: "#0B0D12",
                  letterSpacing: "-0.02em",
                  textAlign: "right",
                  minWidth: 30,
                }}
                title={`${objective.progressPct}% (legacy key-metric ratio — no goal anchor)`}
              >
                {objective.progressPct}%
              </span>
            ))}
          {/* LEAD/LAG chip only renders when the perspective gives us a real
              signal (trend_direction or action timeframe). Defaulting to
              "lead" when neither was present — the previous behaviour — was
              misleading on action-derived objectives that had no direction. */}
          {objective.tag && (
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background:
                  objective.tag === "lead"
                    ? "rgba(var(--accent-rgb), 0.08)"
                    : "rgba(251,191,36,0.1)",
                color: objective.tag === "lead" ? "var(--accent-700)" : "#B45309",
                border:
                  objective.tag === "lead"
                    ? "1px solid rgba(var(--accent-rgb), 0.2)"
                    : "1px solid rgba(251,191,36,0.3)",
              }}
            >
              {objective.tag}
            </span>
          )}
          <span
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              expanded && "rotate-90",
            )}
            style={{
              border: "1px solid rgba(11,13,18,0.08)",
              background: expanded ? p.accent : "#fff",
              color: expanded ? "#fff" : "rgba(11,13,18,0.48)",
            }}
          >
            <ChevronRight className="w-2.5 h-2.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <>
          {matchedChain ? (
            <MechanismChain
              chain={matchedChain}
              entityMap={entityMap}
              spaceId={spaceId}
              assetEntityIds={objective.sourceEntityIds}
            />
          ) : (
            <div
              className="border-t"
              style={{
                borderColor: "rgba(11,13,18,0.08)",
                background: "rgba(247,248,250,0.6)",
                padding: "12px 14px",
                fontSize: 11,
                color: "rgba(11,13,18,0.48)",
              }}
            >
              {objective.description ? (
                <p style={{ marginBottom: 8, lineHeight: 1.5 }}>
                  {objective.description}
                </p>
              ) : null}
              <div
                className="flex items-center gap-2 rounded-md px-2.5 py-2"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.18)",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "rgba(11,13,18,0.64)" }}>
                  No causal chain links this objective yet.
                </span>
                <a
                  href={`/app/space/${spaceId}/causal-chains`}
                  className="underline font-semibold transition-colors"
                  style={{ color: "#4F46E5" }}
                >
                  Generate chains →
                </a>
              </div>
            </div>
          )}
        </>
      )}
      {/* Decomposition drawer — only rendered when there's a real impact
          to decompose. Mounted at the end so AnimatePresence's exit
          animation completes before unmount, even if the component
          re-renders (state lives in the cascade objective, not the
          drawer itself). */}
      {objective.impact && (
        <GoalImpactDecompositionDrawer
          open={decompositionOpen}
          onClose={() => setDecompositionOpen(false)}
          stageName={objective.title}
          goalTitle={activeGoal?.title ?? null}
          impact={objective.impact}
          stageEntityId={objective.sourceEntityIds[0] ?? ""}
          causalChains={causalChains}
          edges={drawerEdges}
          // Evidence map starts empty (Phase D wires the fetch). The
          // drawer renders honest empty states — n=0 study rows, no
          // pooled effect, confidence falls back to chain trust only.
          evidenceByEntity={evidenceByEntity}
          entityNameById={entityNameById}
          // Phase E: clicking "Open forest plot →" on an edge row closes
          // the drawer, then asks the canvas to focus the singleton
          // forest-plot card on that edge (filter + zoom + highlight).
          // Close-then-focus ordering matters: the drawer's exit
          // animation runs in parallel with the zoom so the camera move
          // doesn't feel hidden behind the scrim.
          onOpenForestPlot={(edgeId) => {
            setDecompositionOpen(false);
            presence.focusForestPlotOnEdge(edgeId);
          }}
        />
      )}
    </div>
  );
}
