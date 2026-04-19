/**
 * Post-generation strategy validation.
 * Validates that strategy entity/cycle references are grounded in the actual graph.
 * Runs programmatically (no LLM call) — ~5ms.
 *
 * Pattern follows coherence-check.ts.
 */

import type { StrategicRecommendation, RankedStrategy } from "@/types/strategy";
import type { Entity, Edge, Cycle } from "@/types";

// ── Issue types ──

export type StrategyIssueType =
  | "missing_infrastructure_entity"
  | "missing_channel_endpoint"
  | "missing_activated_loop"
  | "missing_tactic_entity"
  | "missing_perspective_entity"
  | "missing_pre_mortem_entity"
  | "missing_key_decision_entity"
  | "invalid_channel_edge"
  | "orphaned_tactic_dependency"
  | "circular_tactic_dependency"
  | "missing_layer_entity"
  // Layer internal cross-ref stripping (L1↔L2↔L3↔L4) — was previously silent.
  // Emitted by the strategy-engine's layer normalization pass so the audit
  // trail shows what got dropped instead of hiding it.
  | "stripped_layer_reference";

export interface StrategyValidationIssue {
  type: StrategyIssueType;
  severity: "error" | "warning";
  message: string;
  entity_id?: string;
  context?: string; // which part of the strategy the issue is in
}

export interface StrategyValidationResult {
  passed: boolean;
  issues: StrategyValidationIssue[];
  score: number; // 0-100
  /** Count of entity references validated */
  references_checked: number;
  /** Count of broken references found */
  broken_references: number;
  /** Count of references auto-stripped (if strip mode enabled) */
  stripped_count: number;
}

// ── Helpers ──

function extractAllEntityIdsFromRecommendation(rec: StrategicRecommendation): Set<string> {
  const ids = new Set<string>();

  // entity_references top-level
  for (const eid of rec.entity_references ?? []) {
    ids.add(eid);
  }

  // infrastructure_map
  if (rec.infrastructure_map) {
    for (const comp of rec.infrastructure_map.core_components ?? []) {
      ids.add(comp.entity_id);
      for (const rf of comp.receives_from ?? []) ids.add(rf);
      for (const pf of comp.produces_for ?? []) ids.add(pf);
    }
    for (const ch of rec.infrastructure_map.key_channels ?? []) {
      ids.add(ch.from);
      ids.add(ch.to);
    }
  }

  // perspectives
  for (const p of rec.perspectives ?? []) {
    for (const se of p.supporting_entities ?? []) ids.add(se);
    for (const a of p.actions ?? []) {
      if (a.entity_id) ids.add(a.entity_id);
    }
  }

  // micro_tactics
  for (const mt of rec.micro_tactics ?? []) {
    ids.add(mt.entity_id);
    for (const dep of mt.dependencies ?? []) ids.add(dep);
  }

  // key_decision
  if (rec.key_decision?.supporting_entities) {
    for (const eid of rec.key_decision.supporting_entities) ids.add(eid);
  }

  // pre_mortem
  for (const pm of rec.pre_mortem ?? []) {
    for (const eid of pm.related_entity_ids ?? []) ids.add(eid);
  }

  // strategy_layers — extract entity refs from pillar_sources and causal chains
  if (rec.strategy_layers) {
    const sl = rec.strategy_layers;
    const addPillarRefs = (sources: Array<{ source_refs: string[] }>) => {
      for (const ps of sources) {
        for (const ref of ps.source_refs ?? []) {
          // Only add C-prefixed and X-prefixed entity IDs (skip graph structure refs like "bridge:C1→X3")
          if (/^[CX]\d+/.test(ref)) ids.add(ref);
        }
      }
    };
    for (const l1 of sl.l1_outcomes ?? []) addPillarRefs(l1.pillar_sources ?? []);
    for (const l2 of sl.l2_methods ?? []) {
      addPillarRefs(l2.pillar_sources ?? []);
      for (const step of l2.causal_chain ?? []) {
        for (const ref of step.entity_refs ?? []) {
          if (/^[CX]\d+/.test(ref)) ids.add(ref);
        }
      }
    }
    for (const l3 of sl.l3_reasoning ?? []) addPillarRefs(l3.pillar_sources ?? []);
    for (const l4 of sl.l4_insights ?? []) addPillarRefs(l4.pillar_sources ?? []);
  }

  return ids;
}

// ── Main validator ──

/**
 * Validate a strategic recommendation against the actual knowledge graph.
 *
 * @param recommendation - The generated strategy
 * @param entities - All entities in the graph
 * @param edges - All edges in the graph
 * @param cycles - All cycles in the graph
 * @param options.strip - If true, remove broken references from the recommendation (mutates in place)
 */
export function validateStrategyReferences(
  recommendation: StrategicRecommendation,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  options: { strip?: boolean } = {}
): StrategyValidationResult {
  const issues: StrategyValidationIssue[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let strippedCount = 0;

  // Build lookup sets
  const entityIds = new Set<string>();
  for (const e of entities) {
    entityIds.add(e.entity_id); // C1, X5, etc.
  }

  // Edge lookup: "sourceId->targetId"
  const edgePairs = new Set<string>();
  for (const edge of edges) {
    // Need to map UUIDs to entity_ids for channel validation
    edgePairs.add(`${edge.source_entity_id}->${edge.target_entity_id}`);
    edgePairs.add(`${edge.target_entity_id}->${edge.source_entity_id}`);
  }

  const cycleNames = new Set<string>();
  for (const c of cycles) {
    if (c.name) cycleNames.add(c.name);
  }

  // Allow "NEW" as a valid entity_id (proposed infrastructure)
  const isValidRef = (id: string) => id === "NEW" || entityIds.has(id);

  // ── 1. Infrastructure map: core_components ──
  if (recommendation.infrastructure_map) {
    const infra = recommendation.infrastructure_map;

    for (const comp of infra.core_components ?? []) {
      totalChecks++;
      if (!isValidRef(comp.entity_id)) {
        issues.push({
          type: "missing_infrastructure_entity",
          severity: "error",
          message: `Infrastructure component "${comp.entity_name}" references entity "${comp.entity_id}" which doesn't exist in the graph`,
          entity_id: comp.entity_id,
          context: "infrastructure_map.core_components",
        });
      } else {
        passedChecks++;
      }

      // Check receives_from / produces_for
      for (const rf of comp.receives_from ?? []) {
        totalChecks++;
        if (!isValidRef(rf)) {
          issues.push({
            type: "missing_channel_endpoint",
            severity: "warning",
            message: `Infrastructure component "${comp.entity_name}" receives from "${rf}" which doesn't exist`,
            entity_id: rf,
            context: "infrastructure_map.core_components.receives_from",
          });
          if (options.strip) {
            comp.receives_from = comp.receives_from.filter((id) => id !== rf);
            strippedCount++;
          }
        } else {
          passedChecks++;
        }
      }

      for (const pf of comp.produces_for ?? []) {
        totalChecks++;
        if (!isValidRef(pf)) {
          issues.push({
            type: "missing_channel_endpoint",
            severity: "warning",
            message: `Infrastructure component "${comp.entity_name}" produces for "${pf}" which doesn't exist`,
            entity_id: pf,
            context: "infrastructure_map.core_components.produces_for",
          });
          if (options.strip) {
            comp.produces_for = comp.produces_for.filter((id) => id !== pf);
            strippedCount++;
          }
        } else {
          passedChecks++;
        }
      }
    }

    // ── 2. Infrastructure map: key_channels ──
    for (const ch of infra.key_channels ?? []) {
      totalChecks++;
      if (!isValidRef(ch.from)) {
        issues.push({
          type: "missing_channel_endpoint",
          severity: "error",
          message: `Channel "${ch.description}" source "${ch.from}" doesn't exist in graph`,
          entity_id: ch.from,
          context: "infrastructure_map.key_channels.from",
        });
      } else {
        passedChecks++;
      }

      totalChecks++;
      if (!isValidRef(ch.to)) {
        issues.push({
          type: "missing_channel_endpoint",
          severity: "error",
          message: `Channel "${ch.description}" target "${ch.to}" doesn't exist in graph`,
          entity_id: ch.to,
          context: "infrastructure_map.key_channels.to",
        });
      } else {
        passedChecks++;
      }
    }

    // ── 3. Infrastructure map: activated_loops ──
    for (const loop of infra.activated_loops ?? []) {
      totalChecks++;
      if (loop.name && !cycleNames.has(loop.name)) {
        issues.push({
          type: "missing_activated_loop",
          severity: "warning",
          message: `Activated loop "${loop.name}" doesn't match any cycle in the graph`,
          context: "infrastructure_map.activated_loops",
        });
      } else {
        passedChecks++;
      }
    }
  }

  // ── 4. Micro tactics ──
  const tacticEntityIds = new Set<string>();
  for (const tactic of recommendation.micro_tactics ?? []) {
    totalChecks++;
    if (!isValidRef(tactic.entity_id)) {
      issues.push({
        type: "missing_tactic_entity",
        severity: "error",
        message: `Micro tactic "${tactic.title}" targets entity "${tactic.entity_id}" which doesn't exist`,
        entity_id: tactic.entity_id,
        context: "micro_tactics",
      });
    } else {
      passedChecks++;
      tacticEntityIds.add(tactic.entity_id);
    }

    // Dependencies
    for (const dep of tactic.dependencies ?? []) {
      totalChecks++;
      if (!isValidRef(dep)) {
        issues.push({
          type: "orphaned_tactic_dependency",
          severity: "warning",
          message: `Tactic "${tactic.title}" depends on entity "${dep}" which doesn't exist`,
          entity_id: dep,
          context: "micro_tactics.dependencies",
        });
        if (options.strip) {
          tactic.dependencies = tactic.dependencies.filter((id) => id !== dep);
          strippedCount++;
        }
      } else {
        passedChecks++;
      }
    }
  }

  // ── 5. Tactic circular dependency check ──
  const tacticDepGraph = new Map<string, string[]>();
  for (const tactic of recommendation.micro_tactics ?? []) {
    tacticDepGraph.set(tactic.entity_id, tactic.dependencies ?? []);
  }
  // Simple cycle detection via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  function hasCycle(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const dep of tacticDepGraph.get(node) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(node);
    return false;
  }
  for (const node of tacticDepGraph.keys()) {
    totalChecks++;
    if (hasCycle(node)) {
      issues.push({
        type: "circular_tactic_dependency",
        severity: "warning",
        message: `Micro tactics have circular dependencies involving entity "${node}"`,
        entity_id: node,
        context: "micro_tactics.dependencies",
      });
    } else {
      passedChecks++;
    }
    visited.clear();
    inStack.clear();
  }

  // ── 6. Perspectives: supporting_entities ──
  for (const p of recommendation.perspectives ?? []) {
    for (const eid of p.supporting_entities ?? []) {
      totalChecks++;
      if (!isValidRef(eid)) {
        issues.push({
          type: "missing_perspective_entity",
          severity: "warning",
          message: `Perspective "${p.name}" references entity "${eid}" which doesn't exist`,
          entity_id: eid,
          context: "perspectives.supporting_entities",
        });
        if (options.strip) {
          p.supporting_entities = p.supporting_entities.filter((id) => id !== eid);
          strippedCount++;
        }
      } else {
        passedChecks++;
      }
    }
  }

  // ── 7. Key decision supporting entities ──
  if (recommendation.key_decision?.supporting_entities) {
    for (const eid of recommendation.key_decision.supporting_entities) {
      totalChecks++;
      if (!isValidRef(eid)) {
        issues.push({
          type: "missing_key_decision_entity",
          severity: "warning",
          message: `Key decision references supporting entity "${eid}" which doesn't exist`,
          entity_id: eid,
          context: "key_decision.supporting_entities",
        });
        if (options.strip) {
          recommendation.key_decision.supporting_entities =
            recommendation.key_decision.supporting_entities.filter((id) => id !== eid);
          strippedCount++;
        }
      } else {
        passedChecks++;
      }
    }
  }

  // ── 8. Pre-mortem related entities ──
  for (const pm of recommendation.pre_mortem ?? []) {
    for (const eid of pm.related_entity_ids ?? []) {
      totalChecks++;
      if (!isValidRef(eid)) {
        issues.push({
          type: "missing_pre_mortem_entity",
          severity: "warning",
          message: `Pre-mortem failure mode references entity "${eid}" which doesn't exist`,
          entity_id: eid,
          context: "pre_mortem.related_entity_ids",
        });
        if (options.strip) {
          pm.related_entity_ids = pm.related_entity_ids.filter((id) => id !== eid);
          strippedCount++;
        }
      } else {
        passedChecks++;
      }
    }
  }

  // ── 9. Temporal phases: loops_activated ──
  for (const phase of recommendation.temporal_phases ?? []) {
    for (const loopName of phase.loops_activated ?? []) {
      totalChecks++;
      if (!cycleNames.has(loopName)) {
        issues.push({
          type: "missing_activated_loop",
          severity: "warning",
          message: `Temporal phase "${phase.label}" references loop "${loopName}" which doesn't exist in detected cycles`,
          context: "temporal_phases.loops_activated",
        });
      } else {
        passedChecks++;
      }
    }
  }

  // ── 10. Strategy layers: entity refs in pillar_sources and causal chains ──
  if (recommendation.strategy_layers) {
    const sl = recommendation.strategy_layers;
    const checkPillarRefs = (
      sources: Array<{ source_refs: string[] }>,
      context: string
    ) => {
      for (const ps of sources) {
        for (const ref of ps.source_refs ?? []) {
          // Only validate C/X-prefixed entity IDs, not graph structure refs
          if (/^[CX]\d+/.test(ref)) {
            totalChecks++;
            if (!isValidRef(ref)) {
              issues.push({
                type: "missing_layer_entity",
                severity: "warning",
                message: `Strategy layer pillar source references entity "${ref}" which doesn't exist`,
                entity_id: ref,
                context,
              });
              if (options.strip) {
                ps.source_refs = ps.source_refs.filter((id) => id !== ref);
                strippedCount++;
              }
            } else {
              passedChecks++;
            }
          }
        }
      }
    };

    for (const l1 of sl.l1_outcomes ?? []) {
      checkPillarRefs(l1.pillar_sources ?? [], `strategy_layers.l1_outcomes[${l1.id}]`);
    }
    for (const l2 of sl.l2_methods ?? []) {
      checkPillarRefs(l2.pillar_sources ?? [], `strategy_layers.l2_methods[${l2.id}]`);
      for (const step of l2.causal_chain ?? []) {
        for (const ref of step.entity_refs ?? []) {
          if (/^[CX]\d+/.test(ref)) {
            totalChecks++;
            if (!isValidRef(ref)) {
              issues.push({
                type: "missing_layer_entity",
                severity: "warning",
                message: `L2 causal chain step "${step.step}" references entity "${ref}" which doesn't exist`,
                entity_id: ref,
                context: `strategy_layers.l2_methods[${l2.id}].causal_chain`,
              });
              if (options.strip) {
                step.entity_refs = step.entity_refs.filter((id) => id !== ref);
                strippedCount++;
              }
            } else {
              passedChecks++;
            }
          }
        }
      }
    }
    for (const l3 of sl.l3_reasoning ?? []) {
      checkPillarRefs(l3.pillar_sources ?? [], `strategy_layers.l3_reasoning[${l3.id}]`);
    }
    for (const l4 of sl.l4_insights ?? []) {
      checkPillarRefs(l4.pillar_sources ?? [], `strategy_layers.l4_insights[${l4.id}]`);
    }
  }

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;
  const brokenCount = issues.filter((i) => i.severity === "error").length;

  return {
    passed: brokenCount === 0,
    issues,
    score,
    references_checked: totalChecks,
    broken_references: brokenCount,
    stripped_count: strippedCount,
  };
}

/**
 * Validate all ranked strategies in a batch.
 * Returns aggregated result across all strategies.
 */
export function validateRankedStrategies(
  rankedStrategies: RankedStrategy[],
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  options: { strip?: boolean } = {}
): StrategyValidationResult {
  const allIssues: StrategyValidationIssue[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let strippedTotal = 0;

  for (const ranked of rankedStrategies) {
    const result = validateStrategyReferences(
      ranked.recommendation,
      entities, edges, cycles,
      options
    );
    allIssues.push(...result.issues.map((i) => ({
      ...i,
      context: `Rank #${ranked.rank}: ${i.context}`,
    })));
    totalChecks += result.references_checked;
    passedChecks += result.references_checked - result.broken_references;
    strippedTotal += result.stripped_count;
  }

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;
  const brokenCount = allIssues.filter((i) => i.severity === "error").length;

  return {
    passed: brokenCount === 0,
    issues: allIssues,
    score,
    references_checked: totalChecks,
    broken_references: brokenCount,
    stripped_count: strippedTotal,
  };
}
