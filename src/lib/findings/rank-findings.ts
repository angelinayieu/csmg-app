/**
 * Finding Ranker — Pure compute, no LLM calls.
 *
 * Collects leverage points, risk points, convergences, and bottleneck
 * from synthesis_data and normalizes them into a unified Finding[] list,
 * ranked by impact on the master goal.
 */

import type { SynthesisData } from "@/types/synthesis";
import type { Entity } from "@/types";
import type { ConvergenceInsight, ConvergenceDepth, InteractionMetadata } from "@/types/interactions";
import type { Finding, FindingType } from "@/types/finding";
import type { ImprovementGoal } from "@/types/goals";

// Map entity importance to convergence depth layer
const IMPORTANCE_TO_LAYER: Record<string, ConvergenceDepth> = {
  fundamental: "L1",
  critical: "L2",
  important: "L3",
  moderate: "L4",
};

// Structural value multiplier by layer depth (deeper = rarer = more valuable)
const LAYER_VALUE: Record<ConvergenceDepth, number> = {
  L1: 0.25,
  L2: 0.5,
  L3: 0.75,
  L4: 1.0,
};

interface RankFindingsInput {
  synthesisData: SynthesisData;
  entities: Entity[];
  interactionMetadata?: InteractionMetadata | null;
  activeGoal?: ImprovementGoal | null;
}

/**
 * Rank all findings from synthesis data into a unified, sorted list.
 */
export function rankFindings({
  synthesisData,
  entities,
  interactionMetadata,
  activeGoal,
}: RankFindingsInput): Finding[] {
  const findings: Finding[] = [];
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityById.set(e.id, e);
    if (e.entity_id) entityById.set(e.entity_id, e);
  }

  // Critical path entity IDs for goal relevance scoring
  const criticalPathIds = new Set(
    synthesisData.goal_fitness?.on_critical_path ?? []
  );

  let idCounter = 0;
  const nextId = () => `finding-${++idCounter}`;

  // ── 1. Master bottleneck ──
  if (synthesisData.master_bottleneck) {
    const b = synthesisData.master_bottleneck;
    const entity = entityById.get(b.entity_id);
    const layer = entity
      ? (IMPORTANCE_TO_LAYER[entity.importance ?? "moderate"] ?? "L3")
      : "L3";

    findings.push({
      id: nextId(),
      rank: 0, // will be set after sorting
      title: entity?.name ?? b.summary,
      summary: b.summary,
      finding_type: "bottleneck",
      layer,
      impact_pct: computeImpact(b.blast_radius ?? 5, 0.9, true, layer),
      confidence: 0.9,
      source_entity_ids: [b.entity_id],
      domains: entity ? [entity.entity_category] : [],
      action_label: "Investigate",
      blast_radius: b.blast_radius,
      reasoning: b.reasoning,
      action_primary: b.counterfactual_unlock ?? undefined,
    });
  }

  // ── 2. Leverage points ──
  for (const lp of synthesisData.leverage_points) {
    const entity = entityById.get(lp.entity_id);
    const layer = entity
      ? (IMPORTANCE_TO_LAYER[entity.importance ?? "moderate"] ?? "L2")
      : "L2";
    const onCriticalPath = criticalPathIds.has(lp.entity_id);

    findings.push({
      id: nextId(),
      rank: 0,
      title: lp.entity_name ?? entity?.name ?? lp.summary,
      summary: lp.summary,
      finding_type: "leverage",
      layer,
      impact_pct: computeImpact(
        entity?.centrality_rank ?? 5,
        entity?.confidence ?? 0.8,
        onCriticalPath,
        layer,
      ),
      confidence: entity?.confidence ?? 0.8,
      source_entity_ids: [lp.entity_id],
      domains: entity ? [entity.entity_category] : [],
      action_label: "Review",
      insight_status: lp.insight_status,
      reasoning: lp.reasoning,
      action_primary: lp.action?.primary,
    });
  }

  // ── 3. Risk points ──
  for (const rp of synthesisData.risk_points) {
    const entity = entityById.get(rp.entity_id);
    const layer = entity
      ? (IMPORTANCE_TO_LAYER[entity.importance ?? "moderate"] ?? "L2")
      : "L2";
    const onCriticalPath = criticalPathIds.has(rp.entity_id);

    findings.push({
      id: nextId(),
      rank: 0,
      title: rp.entity_name ?? entity?.name ?? rp.summary,
      summary: rp.summary,
      finding_type: "risk",
      layer,
      impact_pct: computeImpact(
        rp.blast_radius ?? 3,
        entity?.confidence ?? 0.7,
        onCriticalPath,
        layer,
      ),
      confidence: entity?.confidence ?? 0.7,
      source_entity_ids: [rp.entity_id],
      domains: entity ? [entity.entity_category] : [],
      action_label: "Investigate",
      insight_status: rp.insight_status,
      blast_radius: rp.blast_radius,
      reasoning: rp.reasoning,
      action_primary: rp.mitigation?.primary,
    });
  }

  // ── 4. Convergences ──
  const convergences = interactionMetadata?.convergences ?? [];
  for (const conv of convergences) {
    const branchDomains = conv.converging_branches.map((b) => b.category);
    const domainLabel = branchDomains.join(" ↔ ");

    findings.push({
      id: nextId(),
      rank: 0,
      title: conv.shared_element.name,
      summary: conv.explanation,
      finding_type: "convergence",
      layer: conv.depth,
      impact_pct: computeConvergenceImpact(conv),
      confidence: conv.structural_value,
      source_entity_ids: [
        conv.shared_element.entity_id,
        ...conv.converging_branches.map((b) => b.entity_id),
      ],
      domains: branchDomains,
      action_label: conv.depth === "L4" ? "Approve" : conv.depth === "L3" ? "Review" : "Skip",
      convergence_data: conv,
    });
  }

  // ── Sort by impact descending, assign ranks ──
  findings.sort((a, b) => b.impact_pct - a.impact_pct);
  for (let i = 0; i < findings.length; i++) {
    findings[i].rank = i + 1;
  }

  // ── Compute impact detail fields ──
  const goalGap = activeGoal
    ? Math.abs((activeGoal.target_value ?? 100) - (activeGoal.current_value ?? 0))
    : null;

  for (const f of findings) {
    // Effort estimate — heuristic based on layer depth (deeper = less effort to encode)
    if (f.layer === "L4") {
      f.effort_estimate = "Low";
      f.effort_detail = "~2 weeks · reversible";
      f.time_to_result_days = 21;
    } else if (f.layer === "L3") {
      f.effort_estimate = "Medium";
      f.effort_detail = "~4 weeks · iterative";
      f.time_to_result_days = 42;
    } else if (f.layer === "L2") {
      f.effort_estimate = "Medium";
      f.effort_detail = "~6 weeks · structural";
      f.time_to_result_days = 56;
    } else {
      f.effort_estimate = "High";
      f.effort_detail = "~8+ weeks · systemic";
      f.time_to_result_days = 70;
    }

    // Leverage count — for convergences, it's the branch count
    if (f.convergence_data) {
      f.leverage_count = f.convergence_data.converging_branches.length;
    } else {
      // For non-convergence findings, count how many related findings share entities
      const myEntitySet = new Set(f.source_entity_ids);
      let related = 0;
      for (const other of findings) {
        if (other.id === f.id) continue;
        if (other.source_entity_ids.some((eid) => myEntitySet.has(eid))) related++;
      }
      f.leverage_count = Math.max(1, related);
    }

    // Goal closure — how much of the remaining gap this finding closes
    if (goalGap && goalGap > 0) {
      f.goal_closure_pct = Math.round(
        Math.min(100, (f.impact_pct / goalGap) * 100)
      );
      f.goal_closure_detail = `closes ${f.goal_closure_pct}% of ${goalGap.toFixed(1)}% gap`;
    }
  }

  return findings;
}

/**
 * Compute impact percentage for leverage/risk/bottleneck findings.
 * Composite of: centrality rank (inverted), confidence, goal relevance, and layer depth.
 */
function computeImpact(
  centrality_or_blast: number,
  confidence: number,
  onCriticalPath: boolean,
  layer: ConvergenceDepth,
): number {
  // Normalize centrality: rank 0 (highest) → 1.0, rank 10+ → 0.1
  const centralityScore = Math.max(0.1, 1 - (centrality_or_blast / 12));
  const goalMultiplier = onCriticalPath ? 1.2 : 0.7;
  const layerMultiplier = LAYER_VALUE[layer];

  const raw = centralityScore * confidence * goalMultiplier * layerMultiplier * 10;
  return Math.round(Math.min(raw, 10) * 10) / 10; // 0-10, one decimal
}

/**
 * Compute impact for convergence findings — based on structural value and branch count.
 */
function computeConvergenceImpact(conv: ConvergenceInsight): number {
  const depthBonus = LAYER_VALUE[conv.depth];
  const branchBonus = Math.min(1, conv.converging_branches.length / 3);
  const raw = conv.structural_value * depthBonus * branchBonus * 10;
  return Math.round(Math.min(raw, 10) * 10) / 10;
}
