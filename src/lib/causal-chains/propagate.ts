// Causal Chain Propagator (deterministic, no LLM).
// Input: synthesis_data + entities + edges + active goal.
// Output: CausalChain[] — each chain starts from an L4 convergence and walks
// forward through research, deliverables, applications, outcomes to the goal.

import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { CausalChain, CausalStage } from "@/types/causal-chains";

const MAX_CHAINS = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Convergence = Record<string, any>;

interface BuildArgs {
  synthesisData: SynthesisData | null;
  entities: Entity[];
  activeGoal: ImprovementGoal | null;
}

function findEntityByName(entities: Entity[], name?: string): Entity | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return entities.find(
    (e) => e.name.toLowerCase() === lower || e.entity_id?.toLowerCase() === lower,
  );
}

function findEntityById(entities: Entity[], id?: string | null): Entity | undefined {
  if (!id) return undefined;
  return entities.find((e) => e.id === id || e.entity_id === id);
}

/**
 * Pull the top-K L4 convergences from synthesis data, each becoming one chain seed.
 * Falls back to top leverage points if convergences are absent.
 */
function pickChainSeeds(synthData: SynthesisData | null): Array<{
  kind: "convergence" | "leverage";
  index: number;
  name: string;
  structural_value: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
}> {
  const seeds: Array<{
    kind: "convergence" | "leverage";
    index: number;
    name: string;
    structural_value: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw: any;
  }> = [];

  if (!synthData) return seeds;

  // Prefer L4 convergences
  const convergences = ((synthData as unknown as Record<string, unknown>).convergences ??
    []) as Convergence[];
  const l4s = convergences
    .filter((c) => (c.depth ?? "").toString().toUpperCase() === "L4")
    .sort((a, b) => (b.structural_value ?? 0) - (a.structural_value ?? 0))
    .slice(0, MAX_CHAINS);

  l4s.forEach((c, i) => {
    seeds.push({
      kind: "convergence",
      index: i,
      name: c.shared_element_name ?? `L4 Invariant ${i + 1}`,
      structural_value: c.structural_value ?? 0.5,
      raw: c,
    });
  });

  // If no convergences, fall back to leverage points
  if (seeds.length === 0 && Array.isArray(synthData.leverage_points)) {
    synthData.leverage_points.slice(0, MAX_CHAINS).forEach((lp, i) => {
      seeds.push({
        kind: "leverage",
        index: i,
        name: lp.entity_name ?? `Leverage ${i + 1}`,
        structural_value: 0.5,
        raw: lp,
      });
    });
  }

  return seeds;
}

function buildConceptStage(
  seedName: string,
  seedEntity: Entity | undefined,
  structuralValue: number,
): CausalStage {
  return {
    kind: "concept",
    title: seedName.length > 40 ? seedName.slice(0, 37) + "…" : seedName,
    meta: seedEntity?.entity_category ?? "invariant",
    entity_id: seedEntity?.id ?? null,
    confidence: Math.max(0.6, structuralValue),
    value_label: `L${Math.round(structuralValue * 4) || 4}`,
  };
}

function buildResearchStage(
  synthData: SynthesisData | null,
  seedName: string,
  entities: Entity[],
): CausalStage {
  // Find a worth-considering framework that relates to the seed, or external entity
  const wc = (synthData?.worth_considering ?? []) as Array<{
    name?: string;
    source?: string;
    source_url?: string;
    confidence?: string;
    relevance_score?: number;
    relevance?: number;
    web_verified?: boolean;
  }>;

  const lowerSeed = seedName.toLowerCase();
  const match = wc.find((w) =>
    (w.name ?? "").toLowerCase().includes(lowerSeed.split(" ")[0] ?? ""),
  );

  if (match) {
    const conf =
      match.confidence === "high" ? 0.9 : match.confidence === "moderate" ? 0.7 : 0.5;
    return {
      kind: "research",
      title: match.name ?? "Supporting research",
      meta: match.source ?? "literature",
      confidence: conf,
      verified: match.web_verified === true,
      source_url: match.source_url,
      value_label: conf >= 0.85 ? "high conf" : conf >= 0.65 ? "mod conf" : "speculative",
    };
  }

  // Fallback: find any external entity with the seed name
  const extEntity = entities.find(
    (e) =>
      e.knowledge_layer === "external" &&
      e.name.toLowerCase().includes((lowerSeed.split(" ")[0] ?? "")),
  );
  if (extEntity) {
    return {
      kind: "research",
      title: extEntity.name,
      meta: "external evidence",
      confidence: extEntity.confidence ?? 0.6,
      entity_id: extEntity.id,
      value_label: "linked",
    };
  }

  return {
    kind: "research",
    title: "Training knowledge",
    meta: "unverified",
    confidence: 0.5,
    verified: false,
    value_label: "needs web-verify",
  };
}

function buildDeliverableStage(
  synthData: SynthesisData | null,
  chainIndex: number,
  seedName: string,
): { stage: CausalStage; tactic_ids: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = (synthData as any)?.strategic_recommendation as any;
  const tactics = (strategicRec?.micro_tactics ?? []) as Array<{
    id: string;
    title: string;
    description?: string;
    entity_id?: string;
    entity_name?: string;
    metric?: { name?: string; target?: string };
  }>;

  // Try to find a tactic that mentions the seed concept
  const lowerSeed = seedName.toLowerCase();
  const match =
    tactics.find(
      (t) =>
        (t.entity_name ?? "").toLowerCase().includes(lowerSeed.split(" ")[0] ?? "") ||
        (t.title ?? "").toLowerCase().includes(lowerSeed.split(" ")[0] ?? ""),
    ) ?? tactics[chainIndex];

  if (match) {
    return {
      stage: {
        kind: "deliverable",
        title: match.title,
        meta: `Rule R-${String(chainIndex + 1).padStart(3, "0")}`,
        value_label: match.metric?.target ?? undefined,
      },
      tactic_ids: [match.id],
    };
  }

  return {
    stage: {
      kind: "deliverable",
      title: `Rule R-${String(chainIndex + 1).padStart(3, "0")}`,
      meta: "pending tactic",
      value_label: "to derive",
    },
    tactic_ids: [],
  };
}

function buildApplicationStage(
  synthData: SynthesisData | null,
  chainIndex: number,
  entities: Entity[],
): { stage: CausalStage; entity_ids: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategicRec = (synthData as any)?.strategic_recommendation as any;
  const perspectives = (strategicRec?.perspectives ?? []) as Array<{
    name?: string;
    supporting_entities?: string[];
    actions?: Array<{ text?: string; entity_id?: string }>;
  }>;
  const p = perspectives[chainIndex % Math.max(1, perspectives.length)];

  const supportingEntityIds = (p?.supporting_entities ?? [])
    .map((eid) => findEntityByName(entities, eid)?.id)
    .filter((x): x is string => !!x);

  const asset = p?.actions?.[0]?.text ?? p?.name ?? "asset layer";
  return {
    stage: {
      kind: "application",
      title: asset.length > 40 ? asset.slice(0, 37) + "…" : asset,
      meta: `${supportingEntityIds.length || 1} application${supportingEntityIds.length === 1 ? "" : "s"}`,
      value_label: supportingEntityIds.length
        ? `${supportingEntityIds.length} assets`
        : undefined,
    },
    entity_ids: supportingEntityIds,
  };
}

function buildOutcomeStage(activeGoal: ImprovementGoal | null): CausalStage {
  // Without the Effect Propagator, we don't have a measured number yet.
  // We show "pending trace" until the Effect Propagator fills this in.
  return {
    kind: "outcome",
    title: "Projected outcome",
    meta: activeGoal?.metric_name ? `measured in ${activeGoal.metric_name}` : "trace pending",
    value_label: "run trace →",
  };
}

function buildGoalStage(
  activeGoal: ImprovementGoal | null,
  contributionPct: number,
): CausalStage {
  if (!activeGoal) {
    return {
      kind: "goal",
      title: "No master goal",
      meta: "set an objective to activate",
      value_label: "—",
    };
  }
  return {
    kind: "goal",
    title: activeGoal.title,
    meta: "→ master goal",
    value_label: `+${contributionPct.toFixed(1)}%`,
  };
}

/**
 * Distribute a total expected contribution across chains, weighted by structural value.
 * Until the Effect Propagator runs, this is the heuristic estimate.
 */
function distributeContribution(
  seeds: Array<{ structural_value: number }>,
  totalAvailablePct: number,
): number[] {
  const sum = seeds.reduce((s, x) => s + Math.max(0.1, x.structural_value), 0);
  if (sum === 0) return seeds.map(() => 0);
  return seeds.map(
    (x) =>
      Math.round(((Math.max(0.1, x.structural_value) / sum) * totalAvailablePct) * 10) /
      10,
  );
}

export function propagateCausalChains({
  synthesisData,
  entities,
  activeGoal,
}: BuildArgs): CausalChain[] {
  const seeds = pickChainSeeds(synthesisData);
  if (seeds.length === 0) return [];

  // Heuristic: if no goal, total pool = 40% (matches your template's target).
  // If goal exists, use goal's range as the pool (remaining progress to target).
  const totalPool = activeGoal
    ? Math.max(
        20,
        Math.min(
          60,
          ((Number(activeGoal.target_value) - Number(activeGoal.current_value)) /
            Math.max(1, Number(activeGoal.target_value) - Number(activeGoal.baseline_value))) *
            40,
        ),
      )
    : 40;
  const contributions = distributeContribution(seeds, totalPool);

  const chains: CausalChain[] = seeds.map((seed, i) => {
    const seedEntity = seed.raw.entity_id
      ? findEntityById(entities, seed.raw.entity_id)
      : findEntityByName(entities, seed.name);

    const conceptStage = buildConceptStage(seed.name, seedEntity, seed.structural_value);
    const researchStage = buildResearchStage(synthesisData, seed.name, entities);
    const { stage: deliverableStage, tactic_ids } = buildDeliverableStage(
      synthesisData,
      i,
      seed.name,
    );
    const { stage: applicationStage, entity_ids: appEntityIds } = buildApplicationStage(
      synthesisData,
      i,
      entities,
    );
    const outcomeStage = buildOutcomeStage(activeGoal);
    const goalStage = buildGoalStage(activeGoal, contributions[i] ?? 0);

    const confidence =
      (conceptStage.confidence ?? 0.6) * 0.3 +
      (researchStage.confidence ?? 0.6) * 0.4 +
      0.3;

    const allEntityIds = [
      seedEntity?.id,
      conceptStage.entity_id,
      researchStage.entity_id,
      ...appEntityIds,
    ].filter((x): x is string => !!x);

    const chain: CausalChain = {
      id: `chain-${i + 1}-${seed.kind}`,
      rank: i + 1,
      name: seed.name,
      stages: [
        conceptStage,
        researchStage,
        deliverableStage,
        applicationStage,
        outcomeStage,
        goalStage,
      ],
      goal_contribution_pct: contributions[i] ?? 0,
      l4_structural_value: seed.structural_value,
      confidence: Math.round(confidence * 100) / 100,
      generated_at: new Date().toISOString(),
      l4_convergence_id:
        seed.kind === "convergence" ? `convergence-${seed.index}` : undefined,
      primary_goal_id: activeGoal?.id ?? "",
      micro_tactic_ids: tactic_ids,
      entity_ids: Array.from(new Set(allEntityIds)),
      needs_baseline: true, // Effect Propagator fills stages 5-6 and clears this flag
    };
    return chain;
  });

  // Rank by contribution desc
  chains.sort((a, b) => b.goal_contribution_pct - a.goal_contribution_pct);
  chains.forEach((c, i) => {
    c.rank = i + 1;
  });

  return chains;
}

/**
 * Combined contribution helper for the goal callout at the bottom of the page.
 */
export function sumChainContributions(chains: CausalChain[]): number {
  return Math.round(chains.reduce((s, c) => s + c.goal_contribution_pct, 0) * 10) / 10;
}
