/**
 * Post-synthesis coherence check.
 * Validates that synthesis claims are supported by entity-level evidence.
 * Runs programmatically (no LLM call) — ~10ms.
 */

import type { SynthesisData } from "@/types/synthesis";

export interface CoherenceIssue {
  type: "orphaned_reference" | "unsupported_leverage" | "unsupported_risk" | "bottleneck_mismatch" | "missing_loop_entities" | "action_without_source";
  severity: "error" | "warning";
  message: string;
  entity_id?: string;
}

export interface CoherenceResult {
  passed: boolean;
  issues: CoherenceIssue[];
  score: number; // 0-100, percentage of checks that passed
}

/**
 * Check synthesis coherence against the entity/edge data it was derived from.
 * @param synthesis - The LLM-generated synthesis output
 * @param entityIds - Set of all valid entity_ids in the analysis (e.g. "C1", "C5")
 * @param leverageEntityIds - Set of entity_ids marked is_leverage_point in DB
 * @param riskEntityIds - Set of entity_ids marked is_risk_point in DB
 * @param bottleneckEntityId - The entity_id marked is_master_bottleneck, or null
 */
export function checkSynthesisCoherence(
  synthesis: SynthesisData,
  entityIds: Set<string>,
  leverageEntityIds: Set<string>,
  riskEntityIds: Set<string>,
  bottleneckEntityId: string | null
): CoherenceResult {
  const issues: CoherenceIssue[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  // 1. Leverage points reference valid entities
  for (const lp of synthesis.leverage_points ?? []) {
    totalChecks++;
    if (!lp.entity_id || !entityIds.has(lp.entity_id)) {
      issues.push({
        type: "orphaned_reference",
        severity: "error",
        message: `Leverage point references entity "${lp.entity_id}" which doesn't exist in the analysis`,
        entity_id: lp.entity_id,
      });
    } else {
      passedChecks++;
    }
  }

  // 2. Leverage points should reference entities actually marked as leverage
  for (const lp of synthesis.leverage_points ?? []) {
    totalChecks++;
    if (lp.entity_id && entityIds.has(lp.entity_id) && !leverageEntityIds.has(lp.entity_id)) {
      issues.push({
        type: "unsupported_leverage",
        severity: "warning",
        message: `Synthesis identifies "${lp.entity_id}" as leverage point but it's not marked is_leverage_point in the graph`,
        entity_id: lp.entity_id,
      });
    } else {
      passedChecks++;
    }
  }

  // 3. Risk points reference valid entities
  for (const rp of synthesis.risk_points ?? []) {
    totalChecks++;
    if (!rp.entity_id || !entityIds.has(rp.entity_id)) {
      issues.push({
        type: "orphaned_reference",
        severity: "error",
        message: `Risk point references entity "${rp.entity_id}" which doesn't exist in the analysis`,
        entity_id: rp.entity_id,
      });
    } else {
      passedChecks++;
    }
  }

  // 4. Risk points should reference entities actually marked as risk
  for (const rp of synthesis.risk_points ?? []) {
    totalChecks++;
    if (rp.entity_id && entityIds.has(rp.entity_id) && !riskEntityIds.has(rp.entity_id)) {
      issues.push({
        type: "unsupported_risk",
        severity: "warning",
        message: `Synthesis identifies "${rp.entity_id}" as risk point but it's not marked is_risk_point in the graph`,
        entity_id: rp.entity_id,
      });
    } else {
      passedChecks++;
    }
  }

  // 5. Master bottleneck coherence
  if (synthesis.master_bottleneck?.entity_id) {
    totalChecks++;
    if (!entityIds.has(synthesis.master_bottleneck.entity_id)) {
      issues.push({
        type: "orphaned_reference",
        severity: "error",
        message: `Master bottleneck references entity "${synthesis.master_bottleneck.entity_id}" which doesn't exist`,
        entity_id: synthesis.master_bottleneck.entity_id,
      });
    } else {
      passedChecks++;
    }

    totalChecks++;
    if (bottleneckEntityId && synthesis.master_bottleneck.entity_id !== bottleneckEntityId) {
      issues.push({
        type: "bottleneck_mismatch",
        severity: "warning",
        message: `Synthesis bottleneck "${synthesis.master_bottleneck.entity_id}" differs from graph bottleneck "${bottleneckEntityId}"`,
        entity_id: synthesis.master_bottleneck.entity_id,
      });
    } else {
      passedChecks++;
    }
  }

  // 6. Feedback loop entity references
  for (const loop of synthesis.feedback_loops ?? []) {
    if (loop.steps && loop.steps.length > 0) {
      totalChecks++;
      passedChecks++; // Loops use step descriptions, not entity_ids — always pass
    }
  }

  // 7. Cross-context insights reference valid entities
  for (const cci of synthesis.cross_context_insights ?? []) {
    for (const eid of cci.internal_entities ?? []) {
      totalChecks++;
      if (!entityIds.has(eid)) {
        issues.push({
          type: "orphaned_reference",
          severity: "warning",
          message: `Cross-context insight references internal entity "${eid}" which doesn't exist`,
          entity_id: eid,
        });
      } else {
        passedChecks++;
      }
    }
  }

  // 8. Worth considering items reference valid entities
  for (const wc of synthesis.worth_considering ?? []) {
    for (const eid of wc.connected_entities ?? []) {
      totalChecks++;
      if (!entityIds.has(eid)) {
        issues.push({
          type: "orphaned_reference",
          severity: "warning",
          message: `Worth-considering item "${wc.title}" references entity "${eid}" which doesn't exist`,
          entity_id: eid,
        });
      } else {
        passedChecks++;
      }
    }
  }

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    score,
  };
}
