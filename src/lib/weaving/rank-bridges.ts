// Goal-aware bridge ranker.
// Takes a list of Bridge rows + the user's active goal + the current space's
// causal chains + entities, and re-scores each bridge by strategic relevance.
//
// Score formula (deterministic, no LLM):
//   base       = coupling_strength × confidence
//   chain_hit  = +1.0 if source/target entity appears in any CausalChain
//   goal_hit   = +0.8 if entity is in strategy's supporting_entities for active goal's perspective
//   loop_hit   = +0.5 if entity participates in a feedback_loop the goal overlay depends on
//   convergence = +0.4 if entity is a convergence shared_element at L3/L4 depth
//
// Final score is clamped 0..3. Output is sorted desc.

import type { Bridge, Entity, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { CausalChain } from "@/types/causal-chains";
import type { ImprovementGoal } from "@/types/goals";

export interface RankedBridge {
  bridge: Bridge;
  score: number;
  reasons: string[];
  chain_id?: string;       // which CausalChain this bridge amplifies
  perspective_name?: string; // which strategy perspective it serves
  side: "source" | "target" | "both";  // which side of the bridge is in the current space
  entity_in_current_space: string; // entity UUID that's in the current dashboard's space
}

const COUPLING_BASE: Record<string, number> = {
  strong: 1.0,
  moderate: 0.6,
  weak: 0.3,
};

interface Args {
  bridges: Bridge[];
  currentSpaceId: string;
  entities: Entity[];            // entities of the current space
  cycles: Cycle[];
  synthesisData: SynthesisData | null;
  activeGoal: ImprovementGoal | null;
}

export function rankBridgesByGoalRelevance({
  bridges,
  currentSpaceId,
  entities,
  cycles,
  synthesisData,
  activeGoal,
}: Args): RankedBridge[] {
  if (bridges.length === 0) return [];

  // ── Precompute lookup sets ──

  const entityIdSet = new Set(entities.map((e) => e.id));
  const entityByUuid = new Map(entities.map((e) => [e.id, e]));

  // Causal-chain entities
  const chainEntityMap = new Map<string, string>(); // entityUuid → chainId
  for (const chain of synthesisData?.causal_chains ?? []) {
    for (const eid of chain.entity_ids) {
      if (!chainEntityMap.has(eid)) chainEntityMap.set(eid, chain.id);
    }
  }

  // Strategy perspective supporting_entities
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = (synthesisData as any)?.strategic_recommendation;
  const perspectiveEntitySet = new Map<string, string>(); // entity UUID → perspective name
  const perspectives = (strategicRec?.perspectives ?? []) as Array<{
    name?: string;
    supporting_entities?: string[];
    entity_refs?: string[];
  }>;
  for (const p of perspectives) {
    const refs = [...(p.supporting_entities ?? []), ...(p.entity_refs ?? [])];
    for (const ref of refs) {
      // refs can be either entity UUIDs or entity_id codes like "C1"
      const match = entities.find((e) => e.id === ref || e.entity_id === ref);
      if (match) perspectiveEntitySet.set(match.id, p.name ?? "perspective");
    }
  }

  // Feedback-loop entities (cycles)
  const loopEntitySet = new Set<string>();
  for (const cycle of cycles) {
    for (const eid of cycle.entity_ids ?? []) {
      loopEntitySet.add(eid);
    }
  }

  // Convergence shared elements at L3/L4
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convergences = ((synthesisData as any)?.convergences ?? []) as Array<{
    depth?: string;
    shared_element?: { entity_id?: string };
  }>;
  const convergenceEntitySet = new Set<string>();
  for (const c of convergences) {
    const depth = (c.depth ?? "").toUpperCase();
    if ((depth === "L3" || depth === "L4") && c.shared_element?.entity_id) {
      const match = entities.find(
        (e) =>
          e.id === c.shared_element!.entity_id ||
          e.entity_id === c.shared_element!.entity_id,
      );
      if (match) convergenceEntitySet.add(match.id);
    }
  }

  // ── Score each bridge ──

  const ranked: RankedBridge[] = [];
  for (const b of bridges) {
    const isSourceInCurrent = b.source_space_id === currentSpaceId;
    const isTargetInCurrent = b.target_space_id === currentSpaceId;
    if (!isSourceInCurrent && !isTargetInCurrent) continue; // bridge not related to current space

    const currentSideEntityId = isSourceInCurrent ? b.source_entity_id : b.target_entity_id;
    if (!entityIdSet.has(currentSideEntityId)) continue;

    let score = COUPLING_BASE[b.coupling_strength] ?? 0.3;
    score *= b.confidence ?? 0.5;
    const reasons: string[] = [];

    let chain_id: string | undefined;
    if (chainEntityMap.has(currentSideEntityId)) {
      score += 1.0;
      chain_id = chainEntityMap.get(currentSideEntityId);
      const chainName = (synthesisData?.causal_chains ?? []).find(
        (c) => c.id === chain_id,
      )?.name;
      reasons.push(`touches causal chain "${chainName ?? chain_id}"`);
    }

    let perspective_name: string | undefined;
    if (perspectiveEntitySet.has(currentSideEntityId)) {
      score += 0.8;
      perspective_name = perspectiveEntitySet.get(currentSideEntityId);
      reasons.push(`in strategy perspective "${perspective_name}"`);
    }

    if (loopEntitySet.has(currentSideEntityId)) {
      score += 0.5;
      reasons.push("participates in a feedback loop");
    }

    if (convergenceEntitySet.has(currentSideEntityId)) {
      score += 0.4;
      reasons.push("L3/L4 convergence point");
    }

    if (activeGoal && b.shared_variable_name) {
      const goalText = `${activeGoal.title} ${activeGoal.metric_name ?? ""}`.toLowerCase();
      if (goalText.includes(b.shared_variable_name.toLowerCase())) {
        score += 0.3;
        reasons.push("shares variable name with active goal");
      }
    }

    if (b.bridge_type === "identity") {
      score += 0.15;
      reasons.push("identity bridge (cleanest merge)");
    }

    // Base rationale if no boosters hit
    if (reasons.length === 0) {
      reasons.push(`${b.coupling_strength} coupling on "${b.shared_variable_name}"`);
    }

    score = Math.min(3, Math.max(0, score));

    ranked.push({
      bridge: b,
      score: Math.round(score * 100) / 100,
      reasons,
      chain_id,
      perspective_name,
      side: isSourceInCurrent && isTargetInCurrent ? "both" : isSourceInCurrent ? "source" : "target",
      entity_in_current_space: currentSideEntityId,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
