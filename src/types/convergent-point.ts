// ── Convergent Point (Node Probability Space) types ──
//
// A convergent point is a tuple (focal_entity, interactors, conditions) that
// resolves to a predicted outcome. For a given focal node, the set of all its
// convergent points is its "probability space" — the enumeration of what that
// node becomes, produces, or fails as under different interactor combinations.
//
// This is orthogonal to the edge-level ProbabilitySpace (which models mediators
// *inside* a single edge). They compose: an edge-level space describes how
// *one* interaction mechanism works; the node-level space enumerates *which*
// interactions are worth considering.

export type OutcomePolarity = "positive" | "negative" | "neutral" | "conditional";
export type OutcomeTimeHorizon = "immediate" | "hours" | "days" | "months" | "years";
export type OutcomeReversibility = "easily_reversible" | "costly_to_reverse" | "irreversible";
export type OutcomePropagation = "local" | "cascading" | "systemic";

export type GenerationMethod =
  | "empirical_edge"         // direct existing edge — highest confidence
  | "structural_derivation"  // 2-hop path through intermediary
  | "analogical_mapping"     // role-pattern match from another system
  | "domain_inference"       // LLM-added interactor not in graph
  | "adversarial";           // deliberate counterexample

// ── The outcome of a convergent point ──

export interface ConvergentOutcome {
  description: string;                    // what happens — 1-2 sentences
  polarity: OutcomePolarity;              // sign of the outcome
  mechanism: string;                      // the causal story, 1-2 sentences
  time_horizon: OutcomeTimeHorizon;       // when it manifests
  reversibility: OutcomeReversibility;    // can you undo it?
  propagation: OutcomePropagation;        // how far does it spread?
}

// ── Structural signature ──
// Abstracted shape of the convergent point so it can be clustered across
// different focal nodes. Two convergent points with the same signature are
// different instances of the same underlying pattern.

export interface StructuralSignature {
  focal_role: string;                     // e.g. "constrained"
  interactor_roles: string[];             // e.g. ["enabler", "resource"]
  outcome_polarity: OutcomePolarity;
  outcome_reversibility: OutcomeReversibility;
  outcome_time_horizon: OutcomeTimeHorizon;
}

// ── Objective alignment (per objective) ──

export interface ObjectiveAlignment {
  objective_id: string;
  objective_title: string;
  // -1 (actively harms objective) to +1 (actively advances objective). 0 = neutral.
  score: number;
  reasoning: string;                      // 1 sentence explaining the score
}

// ── Evidence for why this convergent point exists ──

export interface ConvergentEvidence {
  type: "direct_edge" | "2hop_path" | "cycle_membership" | "fault_reference" | "llm_inference";
  source_entity_ids?: string[];
  source_edge_ids?: string[];
  claim: string;
}

// ── The full convergent point record (matches DB row shape) ──

export interface ConvergentPoint {
  id: string;
  space_id: string;
  focal_entity_id: string;
  interactor_entity_ids: string[];
  external_conditions: string[];
  outcome: ConvergentOutcome;
  probability: number;                    // 0-1
  confidence: number;                     // 0-1
  generation_method: GenerationMethod;
  pattern_tag: string | null;
  structural_signature: StructuralSignature | null;
  objective_alignment: ObjectiveAlignment[];
  evidence_basis: ConvergentEvidence[];
  generated_at: string;
  generated_by?: string | null;
}

// ── Role (extracted from incident edges) ──
// Roles are the functional positions a focal node occupies given its current
// edge pattern. A node can play multiple roles simultaneously.

export type RoleDirection = "outgoing" | "incoming" | "bidirectional";

export interface Role {
  key: string;                            // stable identifier, e.g. "enabler"
  label: string;                          // human-readable
  dimension: string;                      // which edge dimension this role maps to
  direction: RoleDirection;
  topology?: string;                      // optional topology constraint
  // Evidence: which of the focal node's edges triggered this role
  edge_count: number;
  sample_edge_ids: string[];
  // The "question" this role asks about interactions
  question: string;
}

// ── Interactor candidate (before convergence generation) ──

export type InteractorTier = 1 | 2 | 3 | 4 | 5;

export interface InteractorCandidate {
  entity_id: string;                      // UUID of candidate
  entity_display_id?: string;             // like "C5" / "SYS3"
  entity_name: string;
  tier: InteractorTier;
  confidence: number;                     // 0-1 confidence in relevance
  reason: string;                         // why this was surfaced
  via_entity_ids?: string[];              // intermediaries for tier 2 (2-hop)
  analog_entity_ids?: string[];           // source of analogy for tier 3
  // Which role pairing this interactor is a candidate for
  role_key?: string;
}

// ── Combinatorial plan ──
// Which subsets of interactors to actually submit to the convergence engine.
// At 10 interactors the power set is 1024 — we prune aggressively.

export interface InteractorCombination {
  interactor_ids: string[];               // 1-N UUIDs
  tier_mix: InteractorTier[];             // parallel array of tiers
  reason: string;                         // why this combination is worth exploring
}

// ── Pattern library types (Phase 2) ──
//
// A Pattern is the accumulated canonical form of a StructuralSignature after
// enough convergent_points have been observed to warrant promotion.

export interface TagCount {
  tag: string;
  count: number;
}

export interface Pattern {
  id: string;
  signature: string;                       // canonical string form
  signature_detail: StructuralSignature;
  canonical_tag: string;                   // most common LLM-proposed tag
  tag_distribution: TagCount[];
  canonical_description: string | null;
  example_descriptions: string[];          // up to 5
  canonical_mechanism: string | null;
  typical_polarity: OutcomePolarity | null;
  typical_reversibility: OutcomeReversibility | null;
  typical_time_horizon: OutcomeTimeHorizon | null;
  typical_propagation: OutcomePropagation | null;
  occurrence_count: number;
  avg_probability: number | null;
  avg_confidence: number | null;
  avg_composite_score: number | null;
  seen_in_space_ids: string[];
  seen_on_focal_entity_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

// Lightweight shape used at retrieval-time (fed into convergence prompt).
export interface RetrievedPattern {
  tag: string;
  signature: string;
  canonical_mechanism: string;
  typical_polarity: string;
  typical_reversibility: string;
  example_descriptions: string[];
  occurrence_count: number;
}

/**
 * Serialize a StructuralSignature into a deterministic canonical string.
 * Same input always produces same output. Sorting interactor roles ensures
 * {A, B} == {B, A}.
 */
export function signatureToString(sig: StructuralSignature): string {
  const interactors = [...sig.interactor_roles].sort().join(",");
  return `${sig.focal_role}|${interactors}|${sig.outcome_polarity}|${sig.outcome_reversibility}|${sig.outcome_time_horizon}`;
}

/**
 * A weaker signature used for retrieval: just focal_role × interactor_roles,
 * ignoring outcome fields. Lets us retrieve patterns that match the STRUCTURE
 * of a planned combination before we know the outcome (which is what the LLM
 * is about to generate).
 */
export function signaturePrefix(focal_role: string, interactor_roles: string[]): string {
  return `${focal_role}|${[...interactor_roles].sort().join(",")}`;
}

// ── Full request + response shapes for the route ──

export interface ProbabilitySpaceRequest {
  space_id: string;
  focal_entity_id: string;                // UUID
  // Which objectives to rank against. If omitted, uses space's improvement_goals.
  objective_ids?: string[];
  options?: {
    // Maximum interactor candidates to explore per tier. Default: 8/6/4 for tiers 1/2/3.
    max_per_tier?: Partial<Record<InteractorTier, number>>;
    // Skip specific tiers (e.g. to get fastest empirical-only results)
    skip_tiers?: InteractorTier[];
    // Only generate singletons (N + one interactor), never pairs/triples. Default: false.
    singletons_only?: boolean;
    // Max convergent points to generate overall. Default: 30.
    max_points?: number;
  };
}

export interface ProbabilitySpaceResponse {
  space_id: string;
  focal_entity_id: string;
  focal_entity_name: string;
  roles: Role[];
  interactor_candidates: InteractorCandidate[];
  combinations_explored: number;
  convergent_points: ConvergentPoint[];   // sorted by ranked score
  stats: {
    tier_1_interactors: number;
    tier_2_interactors: number;
    tier_3_interactors: number;
    llm_calls: number;
    duration_ms: number;
  };
}
