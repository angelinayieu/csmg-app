"use client";

import { useMemo } from "react";
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

export interface StrategyViewModelResult {
  vm: StrategyVM | null;
  synthData: SynthesisData | null;
  recommendation: StrategicRecommendation | null;
  rankedStrategies: RankedStrategy[];
  strategyData: ReturnType<typeof useStrategyAuto>["strategyData"];
  /** Phase 3: causal-chain staleness relative to the strategy's target goal. */
  chainsStaleness: StalenessResult;
  /** Phase 4a: summary from the most recent confirm call this session. */
  lastConfirm: ReturnType<typeof useStrategyAuto>["lastConfirm"];
  flags: {
    hasSynthesis: boolean;
    needsGeneration: boolean;
    needsRefresh: boolean;
    loading: boolean;
    error: string | null;
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

function parseSynthesisData(raw: unknown): SynthesisData | null {
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SynthesisData;
  } catch {
    return null;
  }
}

export function useStrategyViewModel(): StrategyViewModelResult {
  const ctx = useSpaceData();
  const strategyAuto = useStrategyAuto(ctx.space);

  const synthData = useMemo(
    () => parseSynthesisData(ctx.space.synthesis_data),
    [ctx.space.synthesis_data],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRecData = (synthData as any)?.strategic_recommendation;
  const recommendation: StrategicRecommendation | null =
    strategicRecData?.recommendation ?? strategicRecData ?? null;

  const reasoningTrace: StrategyReasoningTrace | null =
    strategicRecData?.reasoning_trace ?? null;

  const causalChains: CausalChain[] = (synthData?.causal_chains ?? []) as CausalChain[];

  const rankedStrategies: RankedStrategy[] = useMemo(() => {
    return strategyAuto.rankedStrategies ?? [];
  }, [strategyAuto.rankedStrategies]);

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
    });
  }, [recommendation, rankedStrategies, reasoningTrace, causalChains, synthData, ctx.entities.length, ctx.space.name]);

  // Phase 3: chain staleness vs strategy's target goal
  const chainsStaleness: StalenessResult = useMemo(() => {
    const strategyGoalId =
      recommendation?.improvement_goal_id ?? strategicRecData?.improvement_goal_id ?? null;
    const strategyGeneratedAt = strategicRecData?.generated_at ?? null;
    return computeChainsStaleness(causalChains, strategyGoalId, strategyGeneratedAt);
  }, [recommendation, strategicRecData, causalChains]);

  return {
    vm,
    synthData,
    recommendation,
    rankedStrategies,
    strategyData: strategyAuto.strategyData,
    chainsStaleness,
    lastConfirm: strategyAuto.lastConfirm,
    flags: {
      hasSynthesis: ctx.hasSynthesis,
      needsGeneration: strategyAuto.needsGeneration,
      needsRefresh: strategyAuto.needsRefresh,
      loading: strategyAuto.loading,
      error: strategyAuto.error,
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
