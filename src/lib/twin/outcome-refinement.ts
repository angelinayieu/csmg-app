// Outcome → Synthesis Refinement — Gap 6
// When users record outcomes on recommendations, compute signals
// about which entities are reliable vs unreliable for next synthesis

import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ObjectiveBenchmark } from "@/types/goals";
import type { OutcomeRecord } from "./outcome-tracking";
import { computeEntityReliability } from "./outcome-tracking";

export interface RefinementSignal {
  entity_id: string;
  signal_type: "confirmed" | "contradicted" | "partial";
  current_reliability: number; // 0-1
  recommendation: "keep" | "demote" | "investigate";
  reason: string;
}

/**
 * Compute refinement signals from recorded outcomes.
 * Groups outcomes by source_entity_id, computes reliability,
 * and generates signals for the next synthesis run.
 */
export function computeRefinementSignals(
  outcomes: OutcomeRecord[],
  synthesis: SynthesisData | null,
  entities: Entity[],
  benchmark?: ObjectiveBenchmark | null,
): RefinementSignal[] {
  const signals: RefinementSignal[] = [];

  // Group outcomes by source_entity_id
  const byEntity = new Map<string, OutcomeRecord[]>();
  for (const outcome of outcomes) {
    if (!outcome.source_entity_id || outcome.outcome === "not_tested") continue;
    const existing = byEntity.get(outcome.source_entity_id) ?? [];
    existing.push(outcome);
    byEntity.set(outcome.source_entity_id, existing);
  }

  // Build leverage/risk sets from synthesis for context
  const leverageIds = new Set(
    (synthesis?.leverage_points ?? []).map((lp) => lp.entity_id)
  );
  const riskIds = new Set(
    (synthesis?.risk_points ?? []).map((rp) => rp.entity_id)
  );

  // Build entity name lookup
  const entityNames = new Map<string, string>();
  for (const e of entities) {
    entityNames.set(e.entity_id, e.name);
  }

  for (const [entityId, entityOutcomes] of byEntity) {
    const reliability = computeEntityReliability(entityId, outcomes);
    const entityName = entityNames.get(entityId) ?? entityId;
    const isLeverage = leverageIds.has(entityId);
    const isRisk = riskIds.has(entityId);

    // All outcomes ineffective → entity is unreliable
    const allIneffective = entityOutcomes.every((o) => o.outcome === "ineffective");
    const allEffective = entityOutcomes.every((o) => o.outcome === "effective");

    if (reliability < 0.3) {
      const roleNote = isLeverage
        ? "reconsider whether this is truly a leverage point"
        : isRisk
          ? "this risk may be overstated"
          : "recommendations based on this entity underperformed";
      signals.push({
        entity_id: entityId,
        signal_type: "contradicted",
        current_reliability: reliability,
        recommendation: allIneffective ? "demote" : "investigate",
        reason: `${entityName}: ${entityOutcomes.length} tested outcomes, reliability ${(reliability * 100).toFixed(0)}% — ${roleNote}`,
      });
    } else if (reliability > 0.8) {
      signals.push({
        entity_id: entityId,
        signal_type: "confirmed",
        current_reliability: reliability,
        recommendation: "keep",
        reason: `${entityName}: ${entityOutcomes.length} tested outcomes, reliability ${(reliability * 100).toFixed(0)}% — ${allEffective ? "all recommendations effective" : "high success rate"}, trust this entity's connections`,
      });
    } else if (reliability >= 0.3 && reliability <= 0.5) {
      signals.push({
        entity_id: entityId,
        signal_type: "partial",
        current_reliability: reliability,
        recommendation: "investigate",
        reason: `${entityName}: mixed results (reliability ${(reliability * 100).toFixed(0)}%), some recommendations worked and others didn't — investigate which conditions determine success`,
      });
    }
  }

  // Benchmark-driven refinement signals
  if (benchmark && outcomes.length >= 2) {
    const effectiveRate = outcomes.filter(o => o.outcome === "effective").length /
      outcomes.filter(o => o.outcome !== "not_tested").length;

    // If less than 30% of recommendations are effective AND benchmark has failure signals
    if (effectiveRate < 0.3 && benchmark.failure_signals.length > 0) {
      signals.push({
        entity_id: "__benchmark__",
        signal_type: "contradicted",
        current_reliability: effectiveRate,
        recommendation: "investigate",
        reason: `Low recommendation effectiveness (${(effectiveRate * 100).toFixed(0)}%) — benchmark failure signal may be firing: "${benchmark.failure_signals[0].signal}". Response: ${benchmark.failure_signals[0].response}.`,
      });
    }

    // If most recommendations work but not moving the needle on must-have criteria
    const mustHaves = benchmark.success_criteria.filter(sc => sc.priority === "must_have");
    if (effectiveRate > 0.5 && mustHaves.length > 0) {
      signals.push({
        entity_id: "__benchmark__",
        signal_type: "partial",
        current_reliability: effectiveRate,
        recommendation: "investigate",
        reason: `Recommendations are effective (${(effectiveRate * 100).toFixed(0)}%) but verify against must-have criteria: ${mustHaves.map(sc => `"${sc.criterion}"`).join(", ")}. Check leading indicators for progress.`,
      });
    }
  }

  // Sort: contradicted first (most urgent), then partial, then confirmed
  const order = { contradicted: 0, partial: 1, confirmed: 2 };
  signals.sort((a, b) => order[a.signal_type] - order[b.signal_type]);

  return signals;
}
