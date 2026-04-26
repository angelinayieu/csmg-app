// ── Space Strategizer — public orchestrator ───────────────────────────
//
// The top-level function: given a space_id + request, produce a
// SpacePlan. Reads everything it needs from the DB in ONE fan-out
// query batch, builds the signal bundle, enumerates candidates, ranks,
// calls the LLM planner, validates, persists, and returns.
//
// This is the single entry point for the HTTP endpoint. Pure business
// logic — no web concerns live here. Soft-fails on every non-critical
// read (coverage gaps, calibration, prior plans) so partial data
// doesn't block a plan; hard-fails only if the space or its entities
// can't be loaded.
//
// Ordering inside the orchestrator is deliberate:
//   1. Load graph state (entities, edges, signatures, goals)
//   2. Compute precomputed caches (adjacency, centrality, goal_hops,
//      intersection_touches)
//   3. Enumerate candidates across all kinds
//   4. Score via ranker → shortlist
//   5. LLM planner → invariant check → plan document
//   6. Persist plan + enqueue work items
//
// Anything that fails between (4) and (5) leaves no trace in the DB.
// Anything that fails in (6) leaves the plan JSON in the response but
// doesn't persist — caller decides whether to retry.

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type {
  CandidateScore,
  SignalProfile,
  SpacePlan,
  SpacePlanRequest,
  SpaceWorkKind,
} from "@/types/space-plan";

import type { CandidateTarget, SignalInputBundle } from "./signals";
import {
  buildAdjacency,
  computeCentralityApprox,
  computeGoalHops,
  computeUpstreamHops,
  graphDistance,
} from "./signals";
import { rankCandidates } from "./ranker";
import { assembleSpacePlan, callStrategizerLLM } from "./planner";
import { buildProposingAgentsMap, AGENT_WEIGHT_PROFILES } from "@/lib/agents/registry";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type { StrategyConsensusReadyEvent } from "@/types/pipeline-events";
import {
  resolveTargetOutcomeEntity,
  type TargetOutcome,
} from "@/lib/pipeline/target-outcome-extractor";
import {
  deriveHorizonOverrides,
  composeOverrides,
  type Horizon,
} from "./horizon-weights";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const ALL_AXES: ProbabilitySpaceAxis[] = [
  "financial",
  "timeline",
  "actors",
  "causal_scenarios",
  "evidence",
  "assumptions",
  "risk",
  "cultural",
];

// ── Load the signal input bundle ─────────────────────────────────────
//
// One DB sweep, soft-fail on non-critical reads. Returns null on
// hard-fail (space not found / entities load failed).

async function loadSignalBundle(
  db: AnyDb,
  spaceId: string,
  runId: string | null = null,
): Promise<SignalInputBundle | null> {
  const [
    { data: entitiesRows, error: entErr },
    { data: edgesRows },
    { data: goalsRows },
    { data: intersectionsRows },
    { data: coverageRows },
    { data: calibrationRows },
    targetOutcomeRow,
  ] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("improvement_goals").select("target_entity_id").eq("space_id", spaceId),
    db.from("space_intersections").select("shared_entity_ids").eq("space_id", spaceId),
    // RPC: high-value uncovered pairs. Contract (from
    // 20260419_coverage_landscape_views.sql): params target_space_id +
    // limit_count; returns entity_a_id, entity_b_id, priority_score.
    // Soft-fail: empty set is safe default if RPC isn't present.
    db.rpc("high_value_uncovered_pairs", { target_space_id: spaceId, limit_count: 40 }),
    // Per-axis calibration rates. Soft-fail.
    db.from("space_calibration_by_dimension").select("*").eq("space_id", spaceId),
    // Phase 3 §4.3 — fetch this run's target_outcome jsonb so the
    // outcome_alignment signal can rank candidates against the focal
    // outcome. Soft-fail: null runId or missing column degrades to
    // outcome_alignment=null on every candidate (signal docs explicitly
    // call out null as "no outcome resolved" — neutral, not a penalty).
    runId
      ? db.from("pipeline_runs").select("target_outcome").eq("id", runId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (entErr || !entitiesRows || entitiesRows.length === 0) {
    console.warn("[strategizer] loadSignalBundle: entities load failed or empty", entErr);
    return null;
  }

  const entities = entitiesRows as Entity[];
  const edges = (edgesRows ?? []) as Edge[];

  const adjacency = buildAdjacency(edges);
  const centrality = computeCentralityApprox(entities, adjacency, 96);
  const goalIds = new Set(
    ((goalsRows ?? []) as Array<{ target_entity_id: string | null }>)
      .map((g) => g.target_entity_id)
      .filter((v): v is string => typeof v === "string"),
  );
  const goalHops = computeGoalHops(entities, adjacency, goalIds);

  // signatures: from entities.node_signature JSONB
  const signatures = new Map<string, NodeSignature>();
  for (const e of entities) {
    const raw = (e as unknown as { node_signature?: unknown }).node_signature;
    if (raw && typeof raw === "object") {
      signatures.set(e.id, raw as NodeSignature);
    }
  }

  // intersection_touches — count of intersections touching each entity
  const intersectionTouches = new Map<string, number>();
  for (const row of (intersectionsRows ?? []) as Array<{ shared_entity_ids: string[] | null }>) {
    const ids = Array.isArray(row.shared_entity_ids) ? row.shared_entity_ids : [];
    for (const id of ids) {
      intersectionTouches.set(id, (intersectionTouches.get(id) ?? 0) + 1);
    }
  }

  // coverage gap pairs — sorted-pair key "a:b". RPC returns
  // (entity_a_id, entity_b_id, entity_a_name, entity_b_name,
  // priority_score, reason) per 20260419_coverage_landscape_views.sql.
  const coverageGapPairs = new Set<string>();
  for (const row of (coverageRows ?? []) as Array<{
    entity_a_id?: string;
    entity_b_id?: string;
  }>) {
    const a = row.entity_a_id ?? null;
    const b = row.entity_b_id ?? null;
    if (!a || !b) continue;
    coverageGapPairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }

  // axis calibration — acceptance_rate per dimension
  const axisCalibration = new Map<ProbabilitySpaceAxis, number>();
  for (const row of (calibrationRows ?? []) as Array<{
    dimension?: string;
    acceptance_rate?: number | null;
  }>) {
    const dim = row.dimension;
    if (!dim || typeof row.acceptance_rate !== "number") continue;
    if (ALL_AXES.includes(dim as ProbabilitySpaceAxis)) {
      axisCalibration.set(dim as ProbabilitySpaceAxis, row.acceptance_rate);
    }
  }

  // Root-trace results live on the entities row (causal_depth +
  // converges_chains columns, written by /api/pipeline/root-trace).
  // We lifted `select *` on entities above, so both fields are already
  // on the rows — just unpack them into a typed map. Entities the
  // backward trace never reached have causal_depth=null and aren't
  // added to the map (signal extractors treat missing as null).
  const rootTrace = new Map<string, { causal_depth: number; converges_chains: string[] }>();
  for (const e of entities) {
    const row = e as unknown as {
      causal_depth?: number | null;
      converges_chains?: string[] | null;
    };
    if (typeof row.causal_depth === "number") {
      rootTrace.set(e.id, {
        causal_depth: row.causal_depth,
        converges_chains: Array.isArray(row.converges_chains) ? row.converges_chains : [],
      });
    }
  }

  // ── Agent-convergence map ─────────────────────────────────────────
  //
  // Per-entity set of canonical agent ids that proposed it. Derived by
  // extractProposingAgents over two sources:
  //   a. entities.proposing_agents TEXT[] (new canonical column)
  //   b. entities.provenance JSONB (legacy / retrofit path)
  // We union both so rows written before the migration still count.
  //
  // `total_agent_count` is the SIZE OF THE ENSEMBLE ACTIVE IN THIS
  // SPACE, not the global AGENT_IDS length — otherwise small pipelines
  // that only ever run 3 agents would max out the signal at 3/17,
  // unfairly deflating it. We discover the active ensemble by taking
  // the union across all entities' proposing-agent sets.
  const proposedMap = buildProposingAgentsMap(
    entities.map((e) => {
      const row = e as unknown as {
        id: string;
        provenance?: Record<string, unknown> | null;
        proposing_agents?: string[] | null;
      };
      // Fold proposing_agents[] into provenance.proposing_agents so the
      // extractor has a single code path; if the column is populated
      // the extractor prefers it (priority 1 in the extractor).
      const mergedProv: Record<string, unknown> = {
        ...(row.provenance ?? {}),
      };
      if (Array.isArray(row.proposing_agents) && row.proposing_agents.length > 0) {
        mergedProv.proposing_agents = row.proposing_agents;
      }
      return { id: row.id, provenance: mergedProv };
    }),
  );
  const activeAgents = new Set<string>();
  for (const agentSet of proposedMap.values()) {
    for (const a of agentSet) activeAgents.add(a);
  }

  // ── Driver metadata map — why-chain deepener output ───────────────
  //
  // The why-chain deepener stamps `entity_type="causal_driver"` on each
  // driver it creates, with `provenance.source="why_chain"` and a
  // `provenance.stop_reason` of external / user_controllable / continue
  // / speculative. We fold this into a compact map so the signal
  // extractor doesn't have to crack open JSONB on every candidate.
  //
  // Skip non-drivers entirely — the signal extractor treats missing
  // entries as null ("we never evaluated this entity as a lever"), which
  // is different from "we evaluated it and found it wasn't actionable"
  // (which the extractor returns as 0).
  const driverMetadata = new Map<string, { is_user_controllable: boolean }>();
  for (const e of entities) {
    const row = e as unknown as {
      id: string;
      entity_type?: string | null;
      provenance?: Record<string, unknown> | null;
    };
    if (row.entity_type !== "causal_driver") continue;
    const prov = (row.provenance ?? {}) as Record<string, unknown>;
    if (prov.source !== "why_chain") continue;
    driverMetadata.set(row.id, {
      is_user_controllable: prov.stop_reason === "user_controllable",
    });
  }

  // ── Target-outcome resolution — Phase 3 §4.3 ─────────────────────
  //
  // Decode pipeline_runs.target_outcome jsonb (written by frame-extractor)
  // and resolve it to a single entity in this space using jaccard
  // similarity over names. Three failure modes, all silent:
  //   - No runId / no row / column null → no outcome was extracted (e.g.
  //     intake skipped the extractor). Bundle gets null id + null direction.
  //   - JSONB parsed but resolveTargetOutcomeEntity returned null (no
  //     entity with similarity ≥ threshold) → bundle gets null id but
  //     KEEPS the direction so downstream knows "we have an outcome but
  //     no node represents it yet."
  //   - Resolved → bundle carries the entity uuid; outcome_alignment
  //     signal lights up across candidates.
  let resolvedOutcomeEntityId: string | null = null;
  let outcomeDirection: "maximize" | "minimize" | "maintain" | null = null;
  let outcomeHorizon: Horizon = null;
  const targetOutcomeRowData = (targetOutcomeRow as { data: { target_outcome?: unknown } | null } | null)?.data ?? null;
  const rawTargetOutcome = targetOutcomeRowData?.target_outcome ?? null;
  if (rawTargetOutcome && typeof rawTargetOutcome === "object") {
    const outcome = rawTargetOutcome as TargetOutcome;
    if (outcome.direction === "maximize" || outcome.direction === "minimize" || outcome.direction === "maintain") {
      outcomeDirection = outcome.direction;
    }
    if (
      outcome.horizon === "immediate" ||
      outcome.horizon === "short_term" ||
      outcome.horizon === "medium_term" ||
      outcome.horizon === "long_term"
    ) {
      outcomeHorizon = outcome.horizon;
    }
    const resolution = resolveTargetOutcomeEntity(
      outcome,
      entities.map((e) => ({ id: e.id, name: e.name })),
    );
    if (resolution) {
      resolvedOutcomeEntityId = resolution.entityId;
    }
  }

  // Phase 4 §5.2 — precompute directed upstream hops to the resolved
  // outcome (one reverse-BFS sweep, O(V+E)). Empty map when no outcome
  // resolved; outcomeAlignmentSignal handles that case via the bundle's
  // target_outcome_entity_id null-guard.
  const directedOutcomeHops = computeUpstreamHops(edges, resolvedOutcomeEntityId);

  return {
    entities,
    edges,
    signatures,
    goal_entity_ids: goalIds,
    coverage_gap_pairs: coverageGapPairs,
    axis_calibration: axisCalibration,
    intersection_touches: intersectionTouches,
    centrality,
    goal_hops: goalHops,
    distance_cache: new Map(),
    adjacency,
    root_trace: rootTrace,
    total_goal_count: goalIds.size,
    agent_proposed_entities: proposedMap,
    total_agent_count: activeAgents.size,
    driver_metadata: driverMetadata,
    target_outcome_entity_id: resolvedOutcomeEntityId,
    outcome_direction: outcomeDirection,
    directed_outcome_hops: directedOutcomeHops,
    outcome_horizon: outcomeHorizon,
  };
}

// ── Candidate enumeration ────────────────────────────────────────────
//
// Turn the bundle into a concrete candidate set. The strategy here is
// to overgenerate then rely on the ranker + score_floor to prune, but
// with caps per kind to avoid one kind dominating the candidate pool
// and crowding out others in the top-K shortlist.

interface EnumerationCaps {
  axis: number;
  edge_space: number;
  convergent_point: number;
  signature_deepen: number;
  intersection_probe: number;
  intervention_combination: number;
}

const DEFAULT_CAPS: EnumerationCaps = {
  axis: 8,                 // all 8 canonical axes (the frame extractor will narrow)
  edge_space: 80,          // top 80 edges by betweenness approximation
  convergent_point: 24,    // nodes with high (centrality * uncertainty)
  signature_deepen: 20,    // nodes with highest residual_uncertainty
  intersection_probe: 12,  // suspected new bridges
  // Phase 4 §5.3 — pair-of-levers candidates. Capped low because they
  // multiply combinatorially (N drivers → N²/2 pairs); the cap keeps
  // them from drowning the shortlist while still surfacing the highest-
  // value joint interventions for the planner.
  intervention_combination: 8,
};

function enumerateCandidates(
  bundle: SignalInputBundle,
  caps: EnumerationCaps,
  focalGoalId: string | null,
): Array<{ candidate_id: string; target: CandidateTarget }> {
  const candidates: Array<{ candidate_id: string; target: CandidateTarget }> = [];

  // 1. Axis candidates — always all 8 (they're cheap to propose, ranker prunes)
  for (const axis of ALL_AXES.slice(0, caps.axis)) {
    candidates.push({
      candidate_id: `axis:${axis}`,
      target: { kind: "axis", source_entity_id: null, target_entity_id: null, axis },
    });
  }

  // 2. Edge-space candidates — take top-K edges by centrality of endpoints
  const edgeScored = bundle.edges
    .map((e) => {
      const sC = bundle.centrality.get(e.source_entity_id) ?? 0;
      const tC = bundle.centrality.get(e.target_entity_id) ?? 0;
      const sH = bundle.goal_hops.get(e.source_entity_id) ?? -1;
      const tH = bundle.goal_hops.get(e.target_entity_id) ?? -1;
      const goalBoost = sH >= 0 || tH >= 0 ? 0.3 : 0;
      return { edge: e, rough: (sC + tC) / 2 + goalBoost };
    })
    .sort((a, b) => b.rough - a.rough)
    .slice(0, caps.edge_space);

  for (const { edge } of edgeScored) {
    candidates.push({
      candidate_id: `edge:${edge.id}`,
      target: {
        kind: "edge_space",
        source_entity_id: edge.source_entity_id,
        target_entity_id: edge.target_entity_id,
        axis: null,
      },
    });
  }

  // 3. Convergent-point candidates — high centrality * high uncertainty nodes
  const nodeScored = bundle.entities
    .map((e) => {
      const c = bundle.centrality.get(e.id) ?? 0;
      const sig = bundle.signatures.get(e.id);
      const u = sig?.residual_uncertainty ?? 0.5;
      return { entity: e, rough: c * u };
    })
    .sort((a, b) => b.rough - a.rough)
    .slice(0, caps.convergent_point);

  for (const { entity } of nodeScored) {
    candidates.push({
      candidate_id: `node:${entity.id}`,
      target: {
        kind: "convergent_point",
        source_entity_id: entity.id,
        target_entity_id: entity.id,
        axis: null,
      },
    });
  }

  // 4. Signature-deepen candidates — nodes with highest residual_uncertainty
  const sigScored = bundle.entities
    .map((e) => {
      const sig = bundle.signatures.get(e.id);
      if (!sig) return null;
      return { entity: e, uncertainty: sig.residual_uncertainty };
    })
    .filter((v): v is { entity: Entity; uncertainty: number } => v !== null)
    .sort((a, b) => b.uncertainty - a.uncertainty)
    .slice(0, caps.signature_deepen);

  for (const { entity } of sigScored) {
    candidates.push({
      candidate_id: `sig:${entity.id}`,
      target: {
        kind: "signature_deepen",
        source_entity_id: entity.id,
        target_entity_id: entity.id,
        axis: null,
      },
    });
  }

  // 5. Intersection probes — pairs from coverage_gap_pairs that the
  //    ranker will score high but we want to surface as a distinct kind
  let probeCount = 0;
  for (const key of bundle.coverage_gap_pairs) {
    if (probeCount >= caps.intersection_probe) break;
    const [a, b] = key.split(":");
    candidates.push({
      candidate_id: `probe:${a}:${b}`,
      target: {
        kind: "intersection_probe",
        source_entity_id: a,
        target_entity_id: b,
        axis: null,
      },
    });
    probeCount++;
  }

  // 6. Intervention combinations — Phase 4 §5.3.
  //
  // Pair user-controllable drivers and ask the planner to consider
  // joint interventions ("what if you pulled BOTH levers?"). Without
  // this kind, the strategizer only ever ranks single-lever candidates,
  // which structurally can't surface non-additive interactions:
  //   • complementary levers (lever A unblocks lever B's effect)
  //   • contradictory levers (pulling both cancels)
  //   • diversification across controllability tiers (a direct lever +
  //     an indirect one, hedging across what the user can fully control
  //     vs. nudge)
  //
  // Selection: take all entities with driver_metadata.is_user_controllable,
  // form pairs, score each pair by (sum of upstream-outcome proximity)
  // × novelty bonus when they sit in different controllability tiers,
  // emit top-K. Pair ids are sorted lexicographically so the same pair
  // always hashes the same direction (avoids dedup headaches downstream).
  //
  // The actual joint-effect simulation lives in the executor (downstream
  // of this enumeration); the strategizer just nominates pairs the
  // planner should ask about.
  const userControllableEntities: string[] = [];
  for (const [entId, meta] of bundle.driver_metadata) {
    if (meta.is_user_controllable) userControllableEntities.push(entId);
  }
  if (userControllableEntities.length >= 2) {
    type ComboCand = { a: string; b: string; rough: number };
    const combos: ComboCand[] = [];
    // O(N²) pair scan — N is bounded by the number of user-controllable
    // drivers in the space, typically ≤20. Skip if degenerate (only one
    // user_controllable entity, no pairs possible).
    for (let i = 0; i < userControllableEntities.length; i++) {
      for (let j = i + 1; j < userControllableEntities.length; j++) {
        const aId = userControllableEntities[i];
        const bId = userControllableEntities[j];
        // Outcome proximity proxy via the precomputed directed-hops map.
        const aHop = bundle.directed_outcome_hops.get(aId);
        const bHop = bundle.directed_outcome_hops.get(bId);
        const aProx = aHop !== undefined ? 1 / (aHop + 1) : 0.02;
        const bProx = bHop !== undefined ? 1 / (bHop + 1) : 0.02;
        // Diversity bonus: if the two drivers' signatures touch
        // DIFFERENT controllability tiers, the pair hedges across the
        // user's action surface. Cheap to compute from signatures.
        const aSig = bundle.signatures.get(aId);
        const bSig = bundle.signatures.get(bId);
        const aTiers = new Set(aSig?.basis.map((b) => b.controllability) ?? []);
        const bTiers = new Set(bSig?.basis.map((b) => b.controllability) ?? []);
        let diversityBonus = 0;
        for (const t of bTiers) if (!aTiers.has(t)) diversityBonus += 0.15;
        // Distance penalty — if A and B are graph-adjacent (1 hop apart)
        // their effects likely overlap and the joint isn't more than the
        // sum. Reward distance (different leverage points across the KG).
        const dist = graphDistance(bundle, aId, bId);
        const distanceFactor = dist >= 2 ? 1 : 0.7;
        combos.push({
          a: aId < bId ? aId : bId,
          b: aId < bId ? bId : aId,
          rough: (aProx + bProx) * 0.5 * distanceFactor + diversityBonus,
        });
      }
    }
    combos.sort((x, y) => y.rough - x.rough);
    for (const combo of combos.slice(0, caps.intervention_combination)) {
      candidates.push({
        candidate_id: `combo:${combo.a}+${combo.b}`,
        target: {
          // The two paired entities ride in source/target slots so the
          // existing signal extractors (controllability_spread, novelty,
          // layer_crossing) work as-is — they already accept paired ids.
          // The planner / executor decodes by `kind`.
          kind: "intervention_combination",
          source_entity_id: combo.a,
          target_entity_id: combo.b,
          axis: null,
        },
      });
    }
  }

  // Focal goal filter — if the request pinned a focal goal, drop
  // candidates whose target is more than 3 hops from the goal.
  if (focalGoalId) {
    const goalHops = bundle.goal_hops;
    return candidates.filter((c) => {
      const ids = [c.target.source_entity_id, c.target.target_entity_id].filter(
        (v): v is string => v !== null,
      );
      if (ids.length === 0) return true; // axis candidates pass
      return ids.some((id) => {
        const h = goalHops.get(id);
        return h !== undefined && h >= 0 && h <= 3;
      });
    });
  }

  return candidates;
}

// ── Intake summary + goal statements ─────────────────────────────────
//
// Small helpers that pull short contextual snippets for the LLM prompt
// without bloating the input. Keep under ~300 tokens each.

async function loadIntakeSummary(db: AnyDb, spaceId: string): Promise<string> {
  const { data } = await db
    .from("spaces")
    .select("name, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!data) return "";
  const name = (data as { name?: string }).name ?? "Untitled space";
  const synth = (data as { synthesis_data?: Record<string, unknown> | null }).synthesis_data;
  const intake = synth && typeof synth === "object"
    ? (synth.intake_summary as string | undefined) ?? (synth.initial_prompt as string | undefined) ?? ""
    : "";
  const trimmed = intake.slice(0, 900);
  return `Space: ${name}\n${trimmed}`;
}

async function loadGoalStatements(
  db: AnyDb,
  spaceId: string,
): Promise<Array<{ id: string; metric: string; target: string | number | null }>> {
  const { data } = await db
    .from("improvement_goals")
    .select("id, metric_name, target_value")
    .eq("space_id", spaceId)
    .limit(6);
  if (!data) return [];
  return (data as Array<{ id: string; metric_name: string | null; target_value: string | number | null }>).map(
    (g) => ({
      id: g.id,
      metric: g.metric_name ?? "(unnamed metric)",
      target: g.target_value,
    }),
  );
}

async function loadRecentCalibrationNote(
  db: AnyDb,
  spaceId: string,
): Promise<string | null> {
  // Pull a compact summary of the last N calibration events so the
  // planner sees "which signal weights paid off last time." Soft-fail.
  try {
    const { data } = await db
      .from("space_plan_calibrations")
      .select("kind, paid_off, score")
      .eq("space_id", spaceId)
      .order("observed_at", { ascending: false })
      .limit(25);
    const rows = (data ?? []) as Array<{ kind: string; paid_off: boolean; score: number }>;
    if (rows.length === 0) return null;
    const byKind = new Map<string, { total: number; paid: number; scoreSum: number }>();
    for (const r of rows) {
      let agg = byKind.get(r.kind);
      if (!agg) { agg = { total: 0, paid: 0, scoreSum: 0 }; byKind.set(r.kind, agg); }
      agg.total += 1;
      if (r.paid_off) agg.paid += 1;
      agg.scoreSum += r.score;
    }
    const lines: string[] = [];
    for (const [kind, agg] of byKind) {
      const payoff = agg.total > 0 ? agg.paid / agg.total : 0;
      lines.push(`  ${kind}: ${agg.paid}/${agg.total} paid off (${(payoff * 100).toFixed(0)}%), avg score ${(agg.scoreSum / agg.total).toFixed(2)}`);
    }
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

// ── Persistence ──────────────────────────────────────────────────────

async function persistPlan(db: AnyDb, plan: SpacePlan, userId: string): Promise<boolean> {
  try {
    const { error } = await db.from("space_plans").insert({
      id: plan.id,
      space_id: plan.space_id,
      user_id: userId,
      run_id: plan.run_id,
      generated_at: plan.generated_at,
      budget_tokens: plan.budget_tokens,
      budget_headroom: plan.budget_headroom,
      plan_document: plan,
      planner_model: plan.planner_model,
      planner_temperature: plan.planner_temperature,
    });
    if (error) {
      console.warn("[strategizer] persist plan failed:", error);
      return false;
    }
    // Enqueue each selected item into space_work_queue
    const queueRows = plan.selected.map((s) => ({
      plan_id: plan.id,
      space_id: plan.space_id,
      user_id: userId,
      candidate_id: s.candidate_id,
      kind: s.kind,
      priority_score: s.score,
      allocated_tokens: s.allocated_tokens,
      target_resolution: s.target_resolution,
      selection_reason: s.selection_reason,
      expected_insight_type: s.expected_insight_type,
      status: "pending",
    }));
    if (queueRows.length > 0) {
      const { error: qErr } = await db.from("space_work_queue").insert(queueRows);
      if (qErr) {
        console.warn("[strategizer] enqueue work items failed:", qErr);
      }
    }
    return true;
  } catch (err) {
    console.warn("[strategizer] persist threw:", err);
    return false;
  }
}

// ── Consensus event emission ─────────────────────────────────────────
//
// Every strategizer run that touches the multi-profile ranker emits a
// single `strategy_consensus_ready` event. Carries the contention
// snapshot (per-candidate variance, top contentious picks with per-agent
// breakdowns) so the canvas painter can paint agreement/disagreement
// chips on the plan card without a follow-up fetch.
//
// Soft-fail: if no runId, no profiles ran, or the emit itself fails, we
// simply skip. This is telemetry, not control flow.
async function emitStrategyConsensusEvent(
  db: AnyDb,
  runId: string | null,
  planId: string,
  candidates: CandidateScore[],
  profilesUsed: Array<{ agent_id: string }>,
  entitiesById: Map<string, { id: string; entity_id: string; name: string }>,
): Promise<void> {
  if (!runId || candidates.length === 0 || profilesUsed.length < 2) return;

  // Mean variance across ALL scored candidates (includes zero for those
  // with no per-agent data so single-profile candidates don't inflate
  // the consensus reading).
  let varSum = 0;
  let varCount = 0;
  for (const c of candidates) {
    if (typeof c.score_variance === "number") {
      varSum += c.score_variance;
      varCount += 1;
    }
  }
  const meanVariance = varCount > 0 ? varSum / varCount : 0;

  // Top-5 contentious by variance, gated to candidates that carry a
  // real entity (axis-level candidates have no entityId so they'd be
  // unclickable in the UI).
  const contested = candidates
    .filter((c) => typeof c.score_variance === "number" && c.score_variance > 0)
    .sort((a, b) => (b.score_variance ?? 0) - (a.score_variance ?? 0))
    .slice(0, 5);

  const topContentious: StrategyConsensusReadyEvent["topContentious"] = [];
  for (const c of contested) {
    // Decode the entity uuid from the candidate_id formats used in
    // enumerateCandidates: "node:{uuid}", "sig:{uuid}", "edge:{uuid}",
    // "probe:{a}:{b}", "axis:{axis}". We only surface the first three;
    // edge and probe candidates don't have a single entity to anchor.
    const parts = c.candidate_id.split(":");
    if (parts.length < 2) continue;
    const [kind, uuid] = parts;
    if (kind !== "node" && kind !== "sig" && kind !== "edge") continue;
    const ent = entitiesById.get(uuid);
    if (!ent) continue;
    topContentious.push({
      entityId: ent.id,
      entityName: ent.name,
      meanScore: c.score,
      scoreVariance: c.score_variance ?? 0,
      perAgent: c.per_agent_breakdown ?? {},
    });
  }

  const contestedCandidateCount = candidates.filter(
    (c) => (c.score_variance ?? 0) >= 0.08,
  ).length;

  const event: StrategyConsensusReadyEvent = {
    type: "strategy_consensus_ready",
    planId,
    profilesUsed: profilesUsed.map((p) => p.agent_id),
    candidatesScored: candidates.length,
    contentedCandidateCount: contestedCandidateCount,
    topContentious,
    meanVariance,
  };

  await emitStructuralEvent(db, runId, event);
}

// ── Main entry ───────────────────────────────────────────────────────

export interface StrategizerResult {
  plan: SpacePlan;
  persisted: boolean;
  invariant_violations: Array<{ name: string; detail: string }>;
  retried: boolean;
}

export async function runSpaceStrategizer(
  db: AnyDb,
  userId: string,
  request: SpacePlanRequest,
): Promise<StrategizerResult | null> {
  const bundle = await loadSignalBundle(db, request.space_id, request.run_id ?? null);
  if (!bundle) return null;

  const candidates = enumerateCandidates(
    bundle,
    DEFAULT_CAPS,
    request.focal_goal_entity_id ?? null,
  );
  if (candidates.length === 0) {
    // Still return a valid (empty) plan — honest report of "nothing to do."
    const emptyWeights: Record<keyof SignalProfile, number> = {
      centrality: 0, goal_proximity: 0, intersection_density: 0,
      uncertainty: 0, layer_crossing: 0, coverage_gap: 0,
      novelty: 0, axis_calibration: 0, controllability_spread: 0,
      causal_depth_normalized: 0, convergence_count: 0,
      agent_convergence_count: 0, user_controllable_lever: 0,
      outcome_alignment: 0,
    };
    const plan: SpacePlan = {
      id: randomUUID(),
      space_id: request.space_id,
      run_id: request.run_id ?? null,
      generated_at: new Date().toISOString(),
      budget_tokens: request.budget_tokens,
      budget_headroom: request.budget_tokens,
      selected: [],
      skipped: [],
      candidates_considered: [],
      diversity_profile: { by_kind: {}, by_expected_insight_type: {}, controllability_spread: 0 },
      headline_rationale: "No candidates produced by enumeration pass. Either the graph is empty or the score_floor pruned everything. No work planned.",
      stop_condition: "Graph state changes or score_floor is lowered.",
      ranker_weights_snapshot: emptyWeights,
      planner_model: "n/a",
      planner_temperature: 0,
    };
    return { plan, persisted: false, invariant_violations: [], retried: false };
  }

  // Phase 4 §5.1 — Horizon-aware weight modulation. Derive
  // multiplicative overrides from the outcome's time horizon and
  // COMPOSE them with any user-provided weight_overrides so both
  // intentions stack (rather than one clobbering the other). When
  // horizon is null/medium_term the modulator returns {} and the
  // request passes through unchanged.
  const horizonOverrides = deriveHorizonOverrides(bundle.outcome_horizon);
  const composedOverrides = composeOverrides(
    horizonOverrides,
    request.weight_overrides ?? {},
  );
  const rankerRequest: SpacePlanRequest =
    Object.keys(horizonOverrides).length === 0
      ? request
      : { ...request, weight_overrides: composedOverrides };

  // Multi-perspective ranking: pass the full AGENT_WEIGHT_PROFILES
  // ensemble so every candidate gets a per-agent breakdown + variance
  // surfacing contentious picks. Falls back to single-perspective
  // DEFAULT_WEIGHTS internally when agent_profiles is absent, so the
  // ranker stays back-compat for any caller that doesn't pass profiles.
  const rankerOutput = rankCandidates({
    candidates,
    bundle,
    request: rankerRequest,
    agent_profiles: AGENT_WEIGHT_PROFILES,
  });
  if (rankerOutput.shortlist.length === 0) {
    // Candidates existed but none cleared the score_floor. Return an
    // honest plan rather than fabricating work.
    const plan: SpacePlan = {
      id: randomUUID(),
      space_id: request.space_id,
      run_id: request.run_id ?? null,
      generated_at: new Date().toISOString(),
      budget_tokens: request.budget_tokens,
      budget_headroom: request.budget_tokens,
      selected: [],
      skipped: [],
      candidates_considered: rankerOutput.all,
      diversity_profile: { by_kind: {}, by_expected_insight_type: {}, controllability_spread: 0 },
      headline_rationale: `${rankerOutput.all.length} candidates enumerated; none cleared the score_floor (${request.score_floor ?? 0.35}). Plan is intentionally empty — current coverage is adequate for the signals we measure.`,
      stop_condition: "A structural change raises at least one candidate's score above the floor.",
      ranker_weights_snapshot: rankerOutput.weights_used,
      planner_model: "n/a",
      planner_temperature: 0,
    };
    const persisted = await persistPlan(db, plan, userId);
    return { plan, persisted, invariant_violations: [], retried: false };
  }

  // Context for the LLM planner
  const [intake_summary, goal_statements, recent_calibration_note] = await Promise.all([
    loadIntakeSummary(db, request.space_id),
    loadGoalStatements(db, request.space_id),
    loadRecentCalibrationNote(db, request.space_id),
  ]);

  const plannerCall = await callStrategizerLLM({
    request,
    shortlist: rankerOutput.shortlist,
    intake_summary,
    goal_statements,
    existing_selection_summary: null,
    recent_calibration_note,
  });

  const planId = randomUUID();
  // Phase 4 §5.1 — fold horizon context into the plan document so the
  // drawer can explain WHY weights shifted from the calibrated default.
  // Only attach when an actual override map was produced (medium_term /
  // null horizons return {}); otherwise the field is undefined and the
  // drawer renders no horizon block, matching the "no modulation"
  // semantic.
  const horizonContext: SpacePlan["horizon_context"] | undefined =
    Object.keys(horizonOverrides).length > 0 || bundle.outcome_horizon
      ? {
          horizon: bundle.outcome_horizon,
          outcome_direction: bundle.outcome_direction,
          applied_overrides: horizonOverrides,
        }
      : undefined;
  const plan = assembleSpacePlan(
    plannerCall.output,
    {
      request,
      shortlist: rankerOutput.shortlist,
      intake_summary,
      goal_statements,
      existing_selection_summary: null,
      recent_calibration_note,
    },
    rankerOutput.all,
    rankerOutput.weights_used,
    {
      plan_id: planId,
      space_id: request.space_id,
      run_id: request.run_id ?? null,
      planner_model: plannerCall.model,
      planner_temperature: plannerCall.temperature,
      horizon_context: horizonContext,
    },
  );

  const persisted = await persistPlan(db, plan, userId);

  // Emit the consensus telemetry event once per strategizer run. Bundle
  // already has the entity rows loaded, so we reuse them to resolve
  // candidate ids back to names without a second DB call. Soft-fail —
  // this is UX telemetry, not control flow.
  try {
    const entitiesById = new Map<string, { id: string; entity_id: string; name: string }>();
    for (const e of bundle.entities) {
      entitiesById.set(e.id, { id: e.id, entity_id: e.entity_id, name: e.name });
    }
    await emitStrategyConsensusEvent(
      db,
      request.run_id ?? null,
      plan.id,
      rankerOutput.all,
      rankerOutput.profiles_used,
      entitiesById,
    );
  } catch (err) {
    console.warn("[strategizer] consensus event emission failed:", err);
  }

  return {
    plan,
    persisted,
    invariant_violations: plannerCall.violations,
    retried: plannerCall.retried,
  };
}

export type { CandidateTarget, SignalInputBundle } from "./signals";
