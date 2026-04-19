// ── Convergence Prediction Prompt ──
//
// Predicts the convergent outcome of a focal entity combined with 1-N
// interactors under specified external conditions. This is the chemistry-
// analogy prompt: given a reactant and its interactors, what does the
// combination produce, with what mechanism, over what time horizon, and how
// reversibly.

export const CONVERGENCE_PREDICTION_SYSTEM_PROMPT = `You are a convergence-prediction analyst. You are given:

  - A FOCAL entity (the "reactant" being analyzed)
  - 1-3 INTERACTOR entities (what the focal is combining with)
  - EXTERNAL CONDITIONS that frame the interaction
  - Known ROLES the focal plays (derived from its graph position)
  - Known ROLES each interactor plays (derived from its graph position)
  - Optional: RELEVANT EXISTING EDGES between these entities (empirical evidence)
  - Optional: KNOWN PATTERNS that may apply (pattern-library retrievals)

Your job: predict the CONVERGENT OUTCOME — what happens when these entities interact under these conditions.

## Rules

1. PICK ONE OUTCOME. Do not list alternatives. Do not hedge with "it depends." If the outcome genuinely depends on sub-conditions, pick the MOST LIKELY one and note the condition variance in the mechanism.

2. OUTCOME MUST BE SPECIFIC. "Negative effects" is not an outcome. "Customer trust degrades as the response latency from the fraud model exceeds 400ms" is an outcome.

3. MECHANISM MUST BE NAMEABLE. You must state the causal chain in 1-2 sentences. If you cannot name the mechanism, your confidence should be below 0.5 and you should say so.

4. POLARITY HONESTLY. "positive" = outcome advances a typical purpose of the focal entity. "negative" = outcome degrades or forecloses. "neutral" = the combination happens but produces no net change. "conditional" = polarity depends on which sub-condition holds — pick this ONLY if genuinely polarity-ambiguous.

5. REVERSIBILITY HONESTLY. Ask: after the outcome manifests, can the entities return to their prior state with bounded cost? "easily_reversible" = yes, cheap, fast. "costly_to_reverse" = possible but expensive or slow. "irreversible" = cannot unwind (e.g., information leaked, relationship broken, resource consumed without recovery).

6. TIME HORIZON is when the outcome MATERIALIZES, not when it starts. "immediate" = under an hour. "hours" to "years" otherwise.

7. PROPAGATION: "local" = contained to focal + interactors. "cascading" = affects adjacent entities but not distant ones. "systemic" = changes the whole system's behavior.

8. PROBABILITY is how likely this outcome is given the interactor combination. Do not confuse with CONFIDENCE (how sure you are this outcome is well-described).

## Anti-patterns to reject

- "May or may not cause X" → pick one, commit
- "Various effects depending on context" → the context IS specified; use it
- "Could lead to..." chained without mechanism → needs mechanism or downgrade confidence
- Tautological outcomes ("the combination produces the outcome of the combination")
- Generic outcomes that would apply to any (focal, interactor) pair

## Output format

Strict JSON:

{
  "outcome": {
    "description": "string — 1-2 sentences, specific",
    "polarity": "positive | negative | neutral | conditional",
    "mechanism": "string — 1-2 sentences naming the causal chain",
    "time_horizon": "immediate | hours | days | months | years",
    "reversibility": "easily_reversible | costly_to_reverse | irreversible",
    "propagation": "local | cascading | systemic"
  },
  "probability": 0.0-1.0,
  "confidence": 0.0-1.0,
  "pattern_tag": "string or null — if this matches a known pattern archetype (e.g. 'resource_contention_tradeoff', 'feedback_loop_overshoot', 'threshold_unlock', 'competing_claims'), name it; otherwise null",
  "evidence_basis": [
    {
      "type": "direct_edge | 2hop_path | cycle_membership | fault_reference | llm_inference",
      "claim": "string — why this supports the outcome"
    }
  ]
}

Pattern tags are short snake_case archetypal names. Don't invent a new one if the outcome is novel — return null. Common starter archetypes: resource_contention_tradeoff, feedback_loop_overshoot, feedback_loop_dampen, threshold_unlock, threshold_block, competing_claims, complementary_amplification, substitution, displacement, phase_transition, information_leak, trust_erosion, moat_formation, moat_erosion, capability_multiplier, bottleneck_exposure.`;

// ── Context-block builder ──

export interface ConvergencePredictionContext {
  focal: {
    entity_id: string;
    name: string;
    description: string;
    layer?: string | null;
    roles: Array<{ key: string; label: string; question: string }>;
    manifold?: Record<string, unknown> | null;
  };
  interactors: Array<{
    entity_id: string;
    name: string;
    description: string;
    layer?: string | null;
    tier: number;
    role_keys?: string[];
  }>;
  // External conditions supplied by the caller (not entity-grounded).
  external_conditions: string[];
  // Edges between focal and any interactor, or among interactors (empirical).
  relevant_edges: Array<{
    source_name: string;
    target_name: string;
    relationship_type: string;
    dimension?: string;
    topology?: string | null;
    reasoning?: string | null;
    confidence?: number;
  }>;
  // Known faults/contradictions implicating these entities.
  relevant_faults: Array<{
    name: string;
    description: string;
  }>;
  // Known patterns that MIGHT apply (retrieved from pattern_library). Empty in Phase 1.
  known_patterns: Array<{
    tag: string;
    canonical_mechanism: string;
    typical_polarity: string;
  }>;
  // User's objectives, for the prompt to keep in mind (but NOT to rank yet — ranking is a separate stage).
  user_objectives: Array<{ title: string }>;
}

export function buildConvergencePredictionUserPrompt(ctx: ConvergencePredictionContext): string {
  const focalRoles = ctx.focal.roles
    .map((r) => `  - ${r.label} (${r.key}): ${r.question}`)
    .join("\n");

  const focalManifold = ctx.focal.manifold
    ? `\n  MANIFOLD: ${JSON.stringify(ctx.focal.manifold)}`
    : "";

  const interactorBlock = ctx.interactors
    .map((i, idx) => {
      const roles = i.role_keys && i.role_keys.length > 0 ? ` [roles: ${i.role_keys.join(", ")}]` : "";
      const tier = i.tier === 1 ? "EMPIRICAL" : i.tier === 2 ? "STRUCTURAL (2-hop)" : i.tier === 3 ? "ANALOGICAL" : "INFERRED";
      return `  Interactor ${idx + 1} [tier ${i.tier}: ${tier}]${roles}
    ${i.entity_id}: ${i.name}${i.layer ? ` (layer: ${i.layer})` : ""}
    ${i.description}`;
    })
    .join("\n");

  const conditionsBlock = ctx.external_conditions.length > 0
    ? ctx.external_conditions.map((c) => `  - ${c}`).join("\n")
    : "  (none specified)";

  const edgesBlock = ctx.relevant_edges.length > 0
    ? ctx.relevant_edges
        .map((e) => {
          const topo = e.topology ? `, topology=${e.topology}` : "";
          const conf = typeof e.confidence === "number" ? `, conf=${e.confidence.toFixed(2)}` : "";
          const reasoning = e.reasoning ? ` — ${e.reasoning}` : "";
          return `  - ${e.source_name} → ${e.target_name} [${e.relationship_type}${topo}${conf}]${reasoning}`;
        })
        .join("\n")
    : "  (no direct edges between these entities — this is inferential)";

  const faultsBlock = ctx.relevant_faults.length > 0
    ? ctx.relevant_faults.map((f) => `  - ${f.name}: ${f.description}`).join("\n")
    : "  (none)";

  const patternsBlock = ctx.known_patterns.length > 0
    ? ctx.known_patterns
        .map((p) => `  - ${p.tag} [${p.typical_polarity}]: ${p.canonical_mechanism}`)
        .join("\n")
    : "  (none retrieved — you may propose a new pattern_tag or set it null)";

  const objectivesBlock = ctx.user_objectives.length > 0
    ? ctx.user_objectives.map((o) => `  - ${o.title}`).join("\n")
    : "  (no objectives specified)";

  return `FOCAL ENTITY
  ${ctx.focal.entity_id}: ${ctx.focal.name}${ctx.focal.layer ? ` (layer: ${ctx.focal.layer})` : ""}
  ${ctx.focal.description}
  ROLES:
${focalRoles}${focalManifold}

INTERACTOR(S) — ${ctx.interactors.length}:
${interactorBlock}

EXTERNAL CONDITIONS:
${conditionsBlock}

RELEVANT EMPIRICAL EDGES (what the graph already knows):
${edgesBlock}

KNOWN FAULTS INVOLVING THESE ENTITIES:
${faultsBlock}

KNOWN PATTERNS THAT MAY APPLY:
${patternsBlock}

USER OBJECTIVES (for context — do NOT score alignment here; that's a separate pass):
${objectivesBlock}

Predict the single convergent outcome. Return strict JSON as specified in the system prompt.`;
}
