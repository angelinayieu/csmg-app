// ── Agent ID registry ────────────────────────────────────────────────
//
// Canonical identifiers for every agent in the pipeline that ever
// PROPOSES an entity or edge. This exists because convergence-of-opinion
// is itself a signal — a node that five independent agents all
// identified is structurally different from one that exactly one agent
// produced, even when the topo-merged graph shows them as the same row.
//
// We measure agent convergence AFTER the fact, by walking
// entity.provenance across the whole space. That means every agent
// doesn't have to call a central "register this" helper — we just need
// a STABLE mapping from the free-form strings each agent already writes
// into provenance (e.g. "hierarchical_pass_a", "why_chain",
// "intelligence_feedback") onto a canonical AgentId so
// signal-computation can count them consistently.
//
// The registry also supplies the PROFILE list for the multi-perspective
// ranker — each agent has a distinct weighting of the 12 strategizer
// signals, so "which candidate would the critic pick" is actually a
// different ranking from "which candidate would the causal-reasoner
// pick". Variance between those rankings is the contentious-set signal.

import type { SignalProfile } from "@/types/space-plan";

// ── Canonical agent identifiers ──────────────────────────────────────
//
// Ordered roughly by pipeline temporal slot (intake → synthesis →
// strategizing). Adding new ones is cheap; removing them would break
// the on-disk provenance of historical entities, so we never do that
// — we deprecate in-place instead.

export const AGENT_IDS = [
  // Intake / decomposition phase — the agents that first identify entities.
  "hierarchical_systems",        // Pass A of hierarchical decomposition
  "hierarchical_domains",        // Pass B
  "hierarchical_threads",        // Pass C
  "flat_decomposer",             // single-pass /decompose fallback
  "why_chain_deepener",          // recursive causal driver generator
  "frame_extractor",             // probability-space axis identifier
  "axis_generator",              // per-axis entity generator
  // Enrichment phase — second-pass agents that refine or connect.
  "bridge_discoverer",           // cross-space structural analogs
  "intelligence_feedback",       // discovery-sourced additions
  "expansion_materializer",      // on-demand expansions
  "ground_objectives",           // objective grounding
  "gap_analyzer",                // missing-piece identifier
  // Critical / consensus phase — these reason ABOUT other agents' output.
  "edge_auditor",                // endorses/disputes edges
  "critic",                      // post-hoc graph critic
  "causal_auditor",              // edge-direction auditor
  // Strategy phase — propose candidates for work.
  "space_strategizer",
  "strategy_engine",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

// ── Provenance-string → AgentId mapping ──────────────────────────────
//
// Agents historically wrote free-form strings into provenance. Rather
// than force a mass rewrite (risky — each agent's test surface is
// different), we normalize at READ time. Keys are lowercased and
// whitespace-trimmed before lookup; unknown strings bucket to null so
// unknown agents don't pollute the convergence count.
//
// When adding a new agent: put its canonical id in AGENT_IDS above,
// then add every free-form string it writes into provenance here. If
// the agent is new enough to write the canonical id directly, it
// still shows up in this map (identity row) so the lookup always
// succeeds.

const PROVENANCE_ALIASES: Record<string, AgentId> = {
  // Identity mappings (new agents write canonical ids directly)
  ...Object.fromEntries(AGENT_IDS.map((id) => [id, id] as const)),

  // Hierarchical decomposition free-form strings
  hierarchical_pass_a: "hierarchical_systems",
  hierarchical_pass_b: "hierarchical_domains",
  hierarchical_pass_c: "hierarchical_threads",

  // Why-chain deepener (writes `source: "why_chain"`)
  why_chain: "why_chain_deepener",

  // Flat decomposer (writes source_type undefined or "decompose")
  decompose: "flat_decomposer",

  // Frame extractor / axis generator strings
  frame: "frame_extractor",
  axis: "axis_generator",
  per_axis_generator: "axis_generator",

  // Bridge / intelligence / expansion
  bridge: "bridge_discoverer",
  cross_space_bridge: "bridge_discoverer",
  intelligence: "intelligence_feedback",
  discovery: "intelligence_feedback",
  expansion: "expansion_materializer",
  expand: "expansion_materializer",

  // Grounding / gap
  grounding: "ground_objectives",
  objective_grounding: "ground_objectives",
  gap: "gap_analyzer",
};

/**
 * Given an arbitrary provenance-like object, extract the set of canonical
 * agent ids that appear to have contributed. Defensive — inputs can be
 * malformed JSONB from old rows, undefined, or totally-unstructured strings.
 *
 * Returns a Set (not array) because we care about DISTINCT contributors;
 * a single agent writing itself into provenance three times still counts
 * as one proposer for convergence purposes.
 *
 * Lookup priority:
 *   1. `provenance.proposing_agents: string[]`  ← future canonical shape
 *   2. `provenance.proposed_by_agent: string`   ← singular variant
 *   3. `provenance.source: string`              ← used by why-chain deepener
 *   4. `provenance.source_type: string`         ← used by hierarchical pass
 *   5. `provenance.discovery_source: string`    ← used by intelligence_feedback
 *
 * None of these are required; a provenance with no known keys returns empty.
 */
export function extractProposingAgents(
  provenance: Record<string, unknown> | null | undefined,
): Set<AgentId> {
  const agents = new Set<AgentId>();
  if (!provenance || typeof provenance !== "object") return agents;

  // ── 1. Explicit canonical array ──────────────────────────────────
  const pa = provenance.proposing_agents;
  if (Array.isArray(pa)) {
    for (const s of pa) {
      if (typeof s !== "string") continue;
      const mapped = PROVENANCE_ALIASES[s.toLowerCase().trim()];
      if (mapped) agents.add(mapped);
    }
  }

  // ── 2-5. Fallback single-string keys. We probe in order; any hit counts.
  const probeKeys: Array<keyof typeof provenance> = [
    "proposed_by_agent",
    "source",
    "source_type",
    "discovery_source",
  ];
  for (const key of probeKeys) {
    const v = provenance[key];
    if (typeof v !== "string") continue;
    const mapped = PROVENANCE_ALIASES[v.toLowerCase().trim()];
    if (mapped) agents.add(mapped);
  }

  return agents;
}

/**
 * Convenience: given a list of entities, build a Map<entityUuid, Set<AgentId>>
 * so downstream signal code can lookup contributor sets in O(1).
 *
 * Uses `id` (the UUID) as the map key, matching SignalInputBundle
 * conventions (which already key other maps on entity UUID).
 */
export function buildProposingAgentsMap(
  entities: Array<{ id: string; provenance?: Record<string, unknown> | null }>,
): Map<string, Set<AgentId>> {
  const map = new Map<string, Set<AgentId>>();
  for (const e of entities) {
    const set = extractProposingAgents(e.provenance ?? null);
    if (set.size > 0) map.set(e.id, set);
  }
  return map;
}

// ── Agent weight profiles for multi-perspective ranking ─────────────
//
// Each profile is a full SignalProfile-shaped weight vector summing to 1.0.
// The ranker computes one composite per profile; the FINAL plan score is
// their mean, and the STD DEV across profiles becomes `score_variance` —
// a first-class field on CandidateScore that UIs can surface as
// "contentiousness".
//
// Picking these weights is judgment + first principles:
//
//   - `causal_reasoner` overweights root-cause signals because its whole
//     job is to ask "what upstream thing drives this". This profile will
//     push for deeper interventions.
//
//   - `critic` overweights coverage_gap + uncertainty because its job is
//     to spotlight the places we're under-investigating, not the already-
//     well-characterized central nodes.
//
//   - `intervention_planner` overweights goal_proximity + controllability
//     because it cares about near-term actionable levers, not deep
//     philosophical root causes.
//
//   - `systems_thinker` overweights centrality + intersection_density +
//     layer_crossing because its view is "what connects the most things",
//     the classic structural-leverage lens.
//
// These weights should sum to 1.0 inside each profile; we assert at load.
// Variance BETWEEN profiles is the entire point, so don't smooth them.

export interface AgentWeightProfile {
  agent_id: AgentId | "default";
  /** Short human-readable summary for UIs and audit trails. */
  rationale: string;
  weights: Record<keyof SignalProfile, number>;
}

// Shared signal-key list so mass-setting weights doesn't drift if a new
// signal gets added. Every profile re-uses this shape; per-profile
// weights below override the zero-baseline selectively.
const ZERO_WEIGHTS: Record<keyof SignalProfile, number> = {
  convergence_count: 0,
  coverage_gap: 0,
  goal_proximity: 0,
  causal_depth_normalized: 0,
  uncertainty: 0,
  centrality: 0,
  intersection_density: 0,
  layer_crossing: 0,
  axis_calibration: 0,
  controllability_spread: 0,
  novelty: 0,
  agent_convergence_count: 0,
  user_controllable_lever: 0,
  outcome_alignment: 0,
  interaction_density: 0,
  cost_efficiency: 0,
  calibration_drift: 0,
  consequence_breadth: 0,
};

function mergeWeights(
  overrides: Partial<Record<keyof SignalProfile, number>>,
): Record<keyof SignalProfile, number> {
  return { ...ZERO_WEIGHTS, ...overrides };
}

// The "default" profile replicates the existing single-perspective
// DEFAULT_WEIGHTS so if nothing else is registered we're identical
// to the old behavior (important: ranker backward-compat).
// NOTE: exact numbers match ranker.ts:DEFAULT_WEIGHTS + agent_convergence.
// Changing one without the other will violate the sum==1.0 invariant.
export const AGENT_WEIGHT_PROFILES: AgentWeightProfile[] = [
  {
    agent_id: "default",
    rationale:
      "Neutral baseline. Mirrors the single-perspective weights so runs with a 1-agent ensemble behave identically to pre-multiagent behavior.",
    weights: mergeWeights({
      convergence_count: 0.16,
      coverage_gap: 0.13,
      causal_depth_normalized: 0.11,
      agent_convergence_count: 0.10,
      goal_proximity: 0.08,        // was 0.12 — shaved 0.04 for outcome_alignment
      outcome_alignment: 0.08,     // new — focal-outcome proximity (this run's lever)
      uncertainty: 0.07,           // was 0.09 — shaved 0.02 for outcome_alignment
      centrality: 0.06,
      user_controllable_lever: 0.06,
      intersection_density: 0.04,  // was 0.05 — shaved 0.01
      layer_crossing: 0.04,        // was 0.05 — shaved 0.01
      axis_calibration: 0.04,
      controllability_spread: 0.02,
      novelty: 0.01,
    }),
  },
  {
    agent_id: "causal_auditor",
    rationale:
      "Root-cause-first. Overweights convergence + causal depth + uncertainty because this profile hunts keystone upstream drivers. Moderately weights user-controllable drivers — a convergent root that's ALSO actionable is the ideal target.",
    weights: mergeWeights({
      convergence_count: 0.22,
      causal_depth_normalized: 0.18,
      uncertainty: 0.10,          // was 0.12 — shaved 0.02 for outcome_alignment
      coverage_gap: 0.10,
      agent_convergence_count: 0.10,
      user_controllable_lever: 0.08,
      goal_proximity: 0.06,        // was 0.08 — shaved 0.02 for outcome_alignment
      outcome_alignment: 0.04,     // new — modest; root-cause hunting cares more about depth than outcome proximity
      centrality: 0.04,
      intersection_density: 0.03,
      layer_crossing: 0.03,
      axis_calibration: 0.01,
      controllability_spread: 0.01,
      novelty: 0.00,
    }),
  },
  {
    agent_id: "critic",
    rationale:
      "Gap-focused. Overweights coverage_gap + uncertainty to spotlight under-investigated regions, not already-well-characterized central nodes. Low user_controllable_lever weight — the critic audits holes, doesn't pick levers.",
    weights: mergeWeights({
      coverage_gap: 0.21,         // was 0.24 — shaved 0.03 for outcome_alignment
      uncertainty: 0.17,          // was 0.19 — shaved 0.02 for outcome_alignment
      novelty: 0.10,
      agent_convergence_count: 0.10,
      convergence_count: 0.08,
      goal_proximity: 0.08,
      causal_depth_normalized: 0.06,
      outcome_alignment: 0.05,    // new — moderate; gap-finder cares about under-investigated outcome surroundings
      layer_crossing: 0.05,
      axis_calibration: 0.04,
      user_controllable_lever: 0.03,
      centrality: 0.01,
      intersection_density: 0.01,
      controllability_spread: 0.01,
    }),
  },
  {
    agent_id: "strategy_engine",
    rationale:
      "Intervention-planner lens. Heavily overweights user_controllable_lever + goal_proximity + controllability because this profile cares about near-term actionable levers. A user-controllable driver upstream of a goal IS the strategy.",
    weights: mergeWeights({
      user_controllable_lever: 0.15, // DOMINANT — actionable lever
      outcome_alignment: 0.12,    // new — STRONG; intervention-planner cares deeply about THIS run's focal outcome
      goal_proximity: 0.12,       // was 0.18 — shaved 0.06 for outcome_alignment (focal outcome subsumes some goal-proximity work here)
      convergence_count: 0.10,
      coverage_gap: 0.08,
      causal_depth_normalized: 0.08,
      agent_convergence_count: 0.08,
      controllability_spread: 0.05, // was 0.07 — shaved 0.02 for D3 cost_efficiency
      centrality: 0.04,           // was 0.06 — shaved 0.02 for D3 cost_efficiency
      cost_efficiency: 0.04,      // D3 phase 3: intervention-planner cares about cost — cheap-vs-expensive levers
      uncertainty: 0.05,
      intersection_density: 0.04, // was 0.05 — shaved 0.01
      axis_calibration: 0.03,
      layer_crossing: 0.02,
      novelty: 0.00,
    }),
  },
  {
    agent_id: "hierarchical_systems",
    rationale:
      "Structural-leverage lens. Overweights centrality + intersection_density + layer_crossing — the classic systems-thinking view of 'what connects the most things'. Low user_controllable_lever — structural leverage is about topology, not actionability.",
    weights: mergeWeights({
      centrality: 0.17,           // was 0.19 — shaved 0.02 for outcome_alignment
      intersection_density: 0.16, // was 0.17 — shaved 0.01 for outcome_alignment
      layer_crossing: 0.14,
      convergence_count: 0.10,
      agent_convergence_count: 0.08,
      goal_proximity: 0.08,
      coverage_gap: 0.06,
      causal_depth_normalized: 0.05,
      uncertainty: 0.04,
      user_controllable_lever: 0.03,
      outcome_alignment: 0.03,    // new — minor; structural lens cares about topology, not run-specific outcome
      axis_calibration: 0.03,
      controllability_spread: 0.02,
      novelty: 0.01,
    }),
  },
];

// Assert every profile sums to 1.0 (within tolerance) at module load.
// Getting this wrong silently produces biased composites, so we fail loud.
(function assertProfileWeightsSumToOne() {
  for (const p of AGENT_WEIGHT_PROFILES) {
    const sum = Object.values(p.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.001) {
      throw new Error(
        `[agents/registry] Profile "${p.agent_id}" weights must sum to 1.0, got ${sum.toFixed(4)}`,
      );
    }
  }
})();

/**
 * Get the default profile. Callers that want a single-perspective ranking
 * (backward compat) should pass only this one.
 */
export function getDefaultProfile(): AgentWeightProfile {
  const p = AGENT_WEIGHT_PROFILES.find((pr) => pr.agent_id === "default");
  if (!p) throw new Error("[agents/registry] Default profile missing — should never happen");
  return p;
}
