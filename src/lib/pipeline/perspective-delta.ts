// ── Perspective Delta: compare quick snapshot vs deep synthesis ──
// Pure function (no LLM calls) that computes what the deep analysis
// added, contradicted, or strengthened relative to the quick analysis.

import type {
  QuickSynthesisSnapshot,
  PerspectiveDelta,
  DeltaInsight,
  DeltaContradiction,
  DeltaStrengthened,
} from "@/types/execution-brief";
import type { SynthesisData } from "@/types/synthesis";

/**
 * Compare a quick-analysis snapshot against the new deep synthesis.
 * Returns a PerspectiveDelta describing what changed between perspectives.
 */
export function computePerspectiveDelta(
  snapshot: QuickSynthesisSnapshot,
  newSynthesis: SynthesisData,
  entities: Array<{ entity_id: string; name: string }>
): PerspectiveDelta {
  const entityNameMap = new Map<string, string>();
  for (const e of entities) {
    entityNameMap.set(e.entity_id, e.name);
  }

  const quickLeverageSet = new Set(snapshot.leverage_point_ids);
  const quickRiskSet = new Set(snapshot.risk_point_ids);
  const quickAllIds = new Set([
    ...snapshot.leverage_point_ids,
    ...snapshot.risk_point_ids,
    ...(snapshot.bottleneck_entity_id ? [snapshot.bottleneck_entity_id] : []),
  ]);

  const deepLeverageIds = (newSynthesis.leverage_points ?? []).map((lp) => lp.entity_id);
  const deepRiskIds = (newSynthesis.risk_points ?? []).map((rp) => rp.entity_id);
  const deepBottleneckId = newSynthesis.master_bottleneck?.entity_id ?? null;
  const deepAllIds = new Set([
    ...deepLeverageIds,
    ...deepRiskIds,
    ...(deepBottleneckId ? [deepBottleneckId] : []),
  ]);

  // ── Only in deep: new findings not present in quick ──
  const onlyInDeep: DeltaInsight[] = [];

  for (const lp of newSynthesis.leverage_points ?? []) {
    if (!quickAllIds.has(lp.entity_id)) {
      onlyInDeep.push({
        type: "leverage",
        entity_id: lp.entity_id,
        entity_name: lp.entity_name ?? entityNameMap.get(lp.entity_id),
        summary: lp.summary,
        source_agent: "deep_synthesis",
      });
    }
  }

  for (const rp of newSynthesis.risk_points ?? []) {
    if (!quickAllIds.has(rp.entity_id)) {
      onlyInDeep.push({
        type: "risk",
        entity_id: rp.entity_id,
        entity_name: rp.entity_name ?? entityNameMap.get(rp.entity_id),
        summary: rp.summary,
        source_agent: "deep_synthesis",
      });
    }
  }

  // Bottleneck changed to a new entity
  if (deepBottleneckId && !quickAllIds.has(deepBottleneckId)) {
    onlyInDeep.push({
      type: "bottleneck",
      entity_id: deepBottleneckId,
      entity_name: entityNameMap.get(deepBottleneckId),
      summary: newSynthesis.master_bottleneck?.summary ?? "New bottleneck identified",
      source_agent: "deep_synthesis",
    });
  }

  // New feedback loops
  for (const loop of newSynthesis.feedback_loops ?? []) {
    onlyInDeep.push({
      type: "feedback_loop",
      summary: `${loop.type === "positive" ? "Reinforcing" : "Balancing"} loop: ${loop.name}`,
      source_agent: "deep_synthesis",
    });
  }

  // New discovered connections
  for (const conn of newSynthesis.discovered_connections ?? []) {
    onlyInDeep.push({
      type: "connection",
      entity_id: conn.source_entity_id,
      entity_name: entityNameMap.get(conn.source_entity_id),
      summary: conn.reasoning,
      source_agent: "deep_synthesis",
    });
  }

  // ── Contradicted: entity changed role between quick and deep ──
  const contradicted: DeltaContradiction[] = [];

  // Leverage in quick but now risk in deep (or vice versa)
  for (const leverageId of snapshot.leverage_point_ids) {
    if (deepRiskIds.includes(leverageId)) {
      const riskPoint = (newSynthesis.risk_points ?? []).find((rp) => rp.entity_id === leverageId);
      contradicted.push({
        quick_claim: `"${entityNameMap.get(leverageId) ?? leverageId}" was identified as a leverage point`,
        deep_claim: `Deep analysis reclassified it as a risk point: ${riskPoint?.summary ?? "risk identified"}`,
        entity_id: leverageId,
        entity_name: entityNameMap.get(leverageId),
        resolution: "Deeper analysis revealed risk factors that outweigh leverage potential",
      });
    }
  }

  for (const riskId of snapshot.risk_point_ids) {
    if (deepLeverageIds.includes(riskId)) {
      const leveragePoint = (newSynthesis.leverage_points ?? []).find((lp) => lp.entity_id === riskId);
      contradicted.push({
        quick_claim: `"${entityNameMap.get(riskId) ?? riskId}" was identified as a risk point`,
        deep_claim: `Deep analysis reclassified it as a leverage point: ${leveragePoint?.summary ?? "leverage identified"}`,
        entity_id: riskId,
        entity_name: entityNameMap.get(riskId),
        resolution: "Deeper analysis found leverage opportunities that offset the risk",
      });
    }
  }

  // Bottleneck changed
  if (
    snapshot.bottleneck_entity_id &&
    deepBottleneckId &&
    snapshot.bottleneck_entity_id !== deepBottleneckId
  ) {
    contradicted.push({
      quick_claim: `"${entityNameMap.get(snapshot.bottleneck_entity_id) ?? snapshot.bottleneck_entity_id}" was the primary bottleneck`,
      deep_claim: `"${entityNameMap.get(deepBottleneckId) ?? deepBottleneckId}" is the actual bottleneck: ${newSynthesis.master_bottleneck?.summary ?? ""}`,
      entity_id: deepBottleneckId,
      entity_name: entityNameMap.get(deepBottleneckId),
      resolution: "Deep analysis identified a more fundamental constraint",
    });
  }

  // ── Strengthened: points in both but with more depth in deep ──
  const strengthened: DeltaStrengthened[] = [];

  for (const leverageId of snapshot.leverage_point_ids) {
    if (deepLeverageIds.includes(leverageId) && !deepRiskIds.includes(leverageId)) {
      const deepPoint = (newSynthesis.leverage_points ?? []).find((lp) => lp.entity_id === leverageId);
      if (deepPoint) {
        // Check if deep version has more reasoning depth
        const hasMoreReasoning = (deepPoint.reasoning?.length ?? 0) > 1;
        const hasConnections = (deepPoint.connections?.length ?? 0) > 0;
        const hasHowItWorks = (deepPoint.how_it_works?.length ?? 0) > 0;

        if (hasMoreReasoning || hasConnections || hasHowItWorks) {
          const evidenceParts: string[] = [];
          if (hasMoreReasoning) evidenceParts.push(`${deepPoint.reasoning.length} reasoning chains`);
          if (hasConnections) evidenceParts.push(`${deepPoint.connections.length} connections mapped`);
          if (hasHowItWorks) evidenceParts.push(`${deepPoint.how_it_works.length} mechanisms identified`);

          strengthened.push({
            entity_id: leverageId,
            entity_name: deepPoint.entity_name ?? entityNameMap.get(leverageId),
            quick_confidence: "initial",
            deep_confidence: hasMoreReasoning && hasConnections ? "high" : "moderate",
            additional_evidence: evidenceParts.join(", "),
          });
        }
      }
    }
  }

  for (const riskId of snapshot.risk_point_ids) {
    if (deepRiskIds.includes(riskId) && !deepLeverageIds.includes(riskId)) {
      const deepPoint = (newSynthesis.risk_points ?? []).find((rp) => rp.entity_id === riskId);
      if (deepPoint) {
        const hasMoreReasoning = (deepPoint.reasoning?.length ?? 0) > 1;
        const hasConnections = (deepPoint.connections?.length ?? 0) > 0;
        const hasHowItFails = (deepPoint.how_it_fails?.length ?? 0) > 0;

        if (hasMoreReasoning || hasConnections || hasHowItFails) {
          const evidenceParts: string[] = [];
          if (hasMoreReasoning) evidenceParts.push(`${deepPoint.reasoning.length} reasoning chains`);
          if (hasConnections) evidenceParts.push(`${deepPoint.connections.length} connections mapped`);
          if (hasHowItFails) evidenceParts.push(`${deepPoint.how_it_fails.length} failure modes`);

          strengthened.push({
            entity_id: riskId,
            entity_name: deepPoint.entity_name ?? entityNameMap.get(riskId),
            quick_confidence: "initial",
            deep_confidence: hasMoreReasoning && hasConnections ? "high" : "moderate",
            additional_evidence: evidenceParts.join(", "),
          });
        }
      }
    }
  }

  // ── Count what was removed (in quick but gone from deep) ──
  let removedCount = 0;
  for (const id of quickAllIds) {
    if (!deepAllIds.has(id)) {
      removedCount++;
    }
  }

  return {
    insights_only_in_deep: onlyInDeep,
    insights_contradicted: contradicted,
    insights_strengthened: strengthened,
    deep_added_count: onlyInDeep.length,
    deep_removed_count: removedCount,
    computed_at: new Date().toISOString(),
  };
}
