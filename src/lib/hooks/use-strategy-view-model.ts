"use client";

import { useEffect, useMemo, useState } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { useStrategyAuto } from "@/lib/hooks/use-strategy-auto";
import { buildStrategyVM, type StrategyVM } from "@/components/strategy/v2/strategy-view-model";
import {
  computeChainsStaleness,
  type StalenessResult,
} from "@/lib/strategy/chains-staleness";
import type { SynthesisData } from "@/types/synthesis";
import type { StrategicRecommendation, RankedStrategy } from "@/types/strategy";
import type { StrategyReasoningTrace } from "@/types/strategy-reasoning";
import type { CausalChain } from "@/types/causal-chains";
import type { StrategyBatch, StrategyBatchEntry } from "@/types/strategy-batch";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import {
  bucketEvidenceByEntity,
  type CalibrationByEdge,
} from "@/lib/twin/impact-weighted-metric";

export interface StrategyViewModelResult {
  vm: StrategyVM | null;
  synthData: SynthesisData | null;
  /**
   * The currently-selected entry's recommendation. When a strategy_batch
   * exists, this returns the entry at `currentEntryIndex` (defaults to 0).
   * Pre-Tier-2 spaces fall back to synthesis_data.strategic_recommendation
   * unchanged. Existing readers of `recommendation` keep working — they
   * just get whichever strategy entry is currently surfaced.
   */
  recommendation: StrategicRecommendation | null;
  rankedStrategies: RankedStrategy[];
  strategyData: ReturnType<typeof useStrategyAuto>["strategyData"];
  /** Phase 3: causal-chain staleness relative to the strategy's target goal. */
  chainsStaleness: StalenessResult;
  /** Phase 4a: summary from the most recent confirm call this session. */
  lastConfirm: ReturnType<typeof useStrategyAuto>["lastConfirm"];
  /**
   * Tier 2.5: multi-strategy batch metadata.
   * `batch` is null on legacy (pre-Tier-2) spaces or when synthesis_data
   * has no `strategy_batch` field. `entries` always returns a usable list
   * — either the batch's entries or a single-entry array synthesized from
   * the legacy `strategic_recommendation` for compatibility.
   */
  batch: StrategyBatch | null;
  entries: StrategyBatchEntry[];
  currentEntryIndex: number;
  currentEntry: StrategyBatchEntry | null;
  flags: {
    hasSynthesis: boolean;
    needsGeneration: boolean;
    needsRefresh: boolean;
    loading: boolean;
    error: string | null;
    /**
     * Tier 1 fix: transient success/info banner state. Surfaced from
     * useStrategyAuto so the strategy page can render an inline banner
     * after Approve / Select-alternative — without this, both success
     * and silent failure look identical to the user.
     */
    message: { kind: "success" | "info"; text: string } | null;
    confirmed: boolean;
    status: "generated" | "reviewing" | "confirmed" | "superseded" | null;
  };
  actions: {
    generate: () => Promise<void>;
    confirm: () => Promise<void>;
    selectAlternative: (rank: number) => Promise<void>;
    regenerate: () => Promise<void>;
  };
}

/**
 * Tier 2.5: optional argument to switch between strategy_batch entries.
 * Caller (strategy-glass-page) owns the index state via useState. When
 * undefined or out of range, the view model returns the primary entry —
 * preserves single-strategy behavior for callers that don't care.
 */
export interface UseStrategyViewModelArgs {
  currentEntryIndex?: number;
}

function parseSynthesisData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
  } catch {
    return null;
  }
}

export function useStrategyViewModel(
  args: UseStrategyViewModelArgs = {},
): StrategyViewModelResult {
  const ctx = useSpaceData();
  const strategyAuto = useStrategyAuto(ctx.space);

  const synthData = useMemo(
    () => parseSynthesisData(ctx.space.synthesis_data),
    [ctx.space.synthesis_data],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRecData = (synthData as any)?.strategic_recommendation;

  // Tier 2.5: read the batch + resolve which entry is currently surfaced.
  // The legacy `strategic_recommendation` is treated as a fallback so
  // pre-Tier-2 spaces (and any space whose batch hasn't been written yet)
  // still produce a working view model.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batch: StrategyBatch | null =
    ((synthData as any)?.strategy_batch as StrategyBatch | undefined) ?? null;

  const entries: StrategyBatchEntry[] = useMemo(() => {
    if (batch && batch.strategies.length > 0) return batch.strategies;
    // Synthesize a 1-entry list from the legacy field so consumers can
    // treat single-strategy spaces uniformly with the multi-strategy case.
    if (strategicRecData?.recommendation) {
      return [{
        objective_id: strategicRecData.improvement_goal_id ?? null,
        objective_title:
          strategicRecData.recommendation.title ?? "Strategy",
        objective_source: "goal_hierarchy" as const,
        parent_goal_id: null,
        rank: 0,
        is_primary: true,
        recommendation: strategicRecData.recommendation,
        ranked_strategies: strategicRecData.ranked_strategies,
        status: strategicRecData.status ?? "generated",
        generated_at: strategicRecData.generated_at ?? new Date().toISOString(),
        validation_score: strategicRecData.validation_score,
        validation_issues_count: strategicRecData.validation_issues_count,
        reasoning_trace: strategicRecData.reasoning_trace,
        probability_space_summary: strategicRecData.probability_space_summary,
        probability_spaces: strategicRecData.probability_spaces,
        space_intersections: strategicRecData.space_intersections,
      }];
    }
    return [];
  }, [batch, strategicRecData]);

  // Clamp the requested index into [0, entries.length-1]. Out-of-range
  // values quietly snap to 0 — preserves UI stability when the batch
  // shrinks across regens (e.g. user removed a sub-objective).
  const currentEntryIndex = useMemo(() => {
    const requested = args.currentEntryIndex ?? 0;
    if (entries.length === 0) return 0;
    return Math.max(0, Math.min(entries.length - 1, requested));
  }, [args.currentEntryIndex, entries.length]);

  const currentEntry: StrategyBatchEntry | null = entries[currentEntryIndex] ?? null;

  // The legacy `recommendation` field on the result now reflects the
  // currently-selected entry. Existing readers (vm builder, deliverables,
  // baseline widgets) automatically follow the switcher.
  const recommendation: StrategicRecommendation | null =
    currentEntry?.recommendation ?? strategicRecData?.recommendation ?? null;

  const reasoningTrace: StrategyReasoningTrace | null =
    (currentEntry?.reasoning_trace as StrategyReasoningTrace | undefined) ??
    strategicRecData?.reasoning_trace ??
    null;

  const causalChains: CausalChain[] = (synthData?.causal_chains ?? []) as CausalChain[];

  const rankedStrategies: RankedStrategy[] = useMemo(() => {
    // Per-entry ranked_strategies when the batch entry has them; falls
    // back to the legacy field for pre-Tier-2 data.
    if (currentEntry?.ranked_strategies) return currentEntry.ranked_strategies;
    return strategyAuto.rankedStrategies ?? [];
  }, [currentEntry, strategyAuto.rankedStrategies]);

  // ── Phase D: evidence fetch ─────────────────────────────────────
  //
  // Single fetch on space change. Cap at the endpoint max (500 rows)
  // so we don't truncate at the default 100 limit on rich spaces. The
  // response is bucketed by attached_entity_id via the impact lib's
  // helper; the same bucketed Map flows into both the cascade VM (for
  // computeStageImpact's pooled effect) and the decomposition drawer
  // (for per-edge evidence rows).
  //
  // Soft-fail: a fetch error leaves the Map empty. The impact library
  // already handles n_studies=0 honestly (composite confidence collapses
  // to 100% chain weight, evidence section shows "not yet aggregated"
  // empty state). No throw, no broken UI.
  const [evidenceByEntity, setEvidenceByEntity] = useState<
    Map<string, EvidenceRegistryRow[]>
  >(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const spaceId = ctx.space?.id;
    if (!spaceId) {
      setEvidenceByEntity(new Map());
      return;
    }
    fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/evidence?limit=500`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const rows = (payload?.rows ?? []) as EvidenceRegistryRow[];
        setEvidenceByEntity(bucketEvidenceByEntity(rows));
      })
      .catch(() => {
        if (!cancelled) setEvidenceByEntity(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.space?.id]);

  // ── Phase F: calibration fetch ────────────────────────────────────
  //
  // Identical pattern to the evidence fetch above. Buckets the
  // `by_edge` payload into a Map<edgeId, CalibrationByEdge> the impact
  // lib can consume directly. Soft-fail keeps the Map empty so
  // computeStageImpact returns `calibration: null` and the composite
  // confidence falls back to the two-factor formula.
  //
  // Scope: space-wide (no `strategySnapshotId` filter today). The current
  // strategy's snapshot id isn't always available at this layer — we'd
  // need to plumb `currentEntry.strategy_snapshot_id` here. For now,
  // space-wide is a slight over-count on multi-strategy spaces; trade
  // for simplicity and revisit when the snapshot-attribution UI lands.
  const [calibrationByEdge, setCalibrationByEdge] = useState<
    Map<string, CalibrationByEdge>
  >(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const spaceId = ctx.space?.id;
    if (!spaceId) {
      setCalibrationByEdge(new Map());
      return;
    }
    fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/calibration-summary?days=90`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const byEdge = (payload?.by_edge ?? {}) as Record<
          string,
          CalibrationByEdge
        >;
        const map = new Map<string, CalibrationByEdge>();
        for (const [edgeId, agg] of Object.entries(byEdge)) {
          if (agg && typeof agg.n === "number" && agg.n > 0) {
            map.set(edgeId, agg);
          }
        }
        setCalibrationByEdge(map);
      })
      .catch(() => {
        if (!cancelled) setCalibrationByEdge(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.space?.id]);

  const vm = useMemo<StrategyVM | null>(() => {
    if (!recommendation) return null;
    return buildStrategyVM({
      recommendation,
      rankedStrategies,
      reasoningTrace,
      causalChains,
      synthData,
      entityCount: ctx.entities.length,
      spaceName: ctx.space.name,
      // Phase B (impact-weighted metric): pass the active goal + edges
      // so the cascade can compute real goal-contribution % via
      // computeStageImpact() instead of the legacy current/target ratio.
      // Phase D: evidenceByEntity now carries real evidence rows
      // bucketed by attached_entity_id. Pooled effect sizes + CIs + I²
      // appear in the drawer once n_studies >= 1. Composite confidence
      // blends in evidence quality once n_studies >= 3.
      activeGoal: ctx.activeGoal,
      edges: ctx.edges,
      evidenceByEntity,
      // Phase F: per-edge calibration aggregates from
      // /api/spaces/[id]/calibration-summary. Empty map on pre-resolution
      // spaces — impact lib leaves StageImpact.calibration null and the
      // composite confidence uses the legacy two-factor formula.
      calibrationByEdge,
    });
  }, [
    recommendation,
    rankedStrategies,
    reasoningTrace,
    causalChains,
    synthData,
    ctx.entities.length,
    ctx.space.name,
    ctx.activeGoal,
    ctx.edges,
    evidenceByEntity,
    calibrationByEdge,
  ]);

  // Phase 3: chain staleness vs strategy's target goal
  const chainsStaleness: StalenessResult = useMemo(() => {
    const strategyGoalId =
      recommendation?.improvement_goal_id ?? strategicRecData?.improvement_goal_id ?? null;
    const strategyGeneratedAt =
      currentEntry?.generated_at ?? strategicRecData?.generated_at ?? null;
    return computeChainsStaleness(causalChains, strategyGoalId, strategyGeneratedAt);
  }, [recommendation, strategicRecData, causalChains, currentEntry]);

  return {
    vm,
    synthData,
    recommendation,
    rankedStrategies,
    strategyData: strategyAuto.strategyData,
    chainsStaleness,
    lastConfirm: strategyAuto.lastConfirm,
    batch,
    entries,
    currentEntryIndex,
    currentEntry,
    flags: {
      hasSynthesis: ctx.hasSynthesis,
      needsGeneration: strategyAuto.needsGeneration,
      needsRefresh: strategyAuto.needsRefresh,
      loading: strategyAuto.loading,
      error: strategyAuto.error,
      message: strategyAuto.message,
      confirmed: strategyAuto.status === "confirmed",
      status: strategyAuto.status,
    },
    actions: {
      generate: strategyAuto.generateStrategy,
      confirm: strategyAuto.confirmStrategy,
      selectAlternative: strategyAuto.selectAlternative,
      regenerate: strategyAuto.generateStrategy,
    },
  };
}
