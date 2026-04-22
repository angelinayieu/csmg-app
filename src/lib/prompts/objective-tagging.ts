/**
 * Objective-tagging prompt — Wave A.
 *
 * Invoked after the decompose pipeline finishes entity + edge inserts
 * AND materializes preliminary_objectives into improvement_goals rows.
 * Takes:
 *   - the set of entities just extracted (with names + descriptions + categories)
 *   - the set of proposed goals just materialized (with titles + rationales)
 * and returns, for each entity, which goals it serves + a confidence in
 * [0, 1] + a 1-sentence rationale.
 *
 * The output populates entity_objectives rows so downstream surfaces
 * (Lab simulator, Apps, Synthesis) can ground reasoning in what the
 * user is actually trying to achieve.
 *
 * Design choices:
 *   - Budget: one call per decompose run, maxTokens ~2500. A typical
 *     intake produces 20-60 entities and 1-4 objectives, which is a
 *     small enough matrix for one pass.
 *   - Strict JSON output, validated server-side (confidence clamped,
 *     entity_id + goal_id must belong to the provided sets — the route
 *     filters hallucinations).
 *   - Explicit instruction: do NOT link every entity to every goal.
 *     Only link if there's a clear functional contribution. Low-signal
 *     matches should be omitted, not downgraded to confidence 0.1.
 */

export const OBJECTIVE_TAGGING_SYSTEM_PROMPT = `You are an objective-tagging assistant for a knowledge graph.

You will be given:
  - A list of ENTITIES (concepts, mechanisms, people, processes) just
    extracted from a user's intake.
  - A list of OBJECTIVES the user cares about (goals they want to
    maximize, minimize, maintain, build, etc.).

For each entity, decide which objective(s) it MEANINGFULLY contributes to.
An entity "serves" an objective if changing that entity would plausibly
move the objective's outcome. Passive relevance doesn't count — only
functional contribution.

Return strict JSON — NO prose outside the object:

{
  "links": [
    {
      "entity_id": "<uuid from the ENTITIES list>",
      "goal_id": "<uuid from the OBJECTIVES list>",
      "confidence": 0.3-0.95,
      "rationale": "1 sentence, concrete, explaining the functional link"
    }
  ]
}

Rules:
  - Reference only entity_ids and goal_ids that appear in the provided
    lists. Hallucinated IDs will be discarded.
  - Do NOT force every entity to link somewhere. If an entity has no
    clear functional contribution to any of the proposed objectives,
    omit it. Empty is valid output.
  - Do NOT force every objective to have entities. If an objective
    wasn't meaningfully decomposed, leave it empty — the user will
    refine manually during review.
  - Confidence ∈ [0.3, 0.95]. Use 0.3-0.5 for plausible-but-uncertain,
    0.55-0.75 for clear, 0.8+ for textbook. Don't emit < 0.3 — that's
    noise.
  - Each (entity_id, goal_id) appears AT MOST ONCE. If you see two
    plausible paths, pick the strongest and explain both in the rationale.
  - Rationale must name the mechanism, not just the domain. Bad:
    "this entity is related to retention". Good: "reducing onboarding
    friction raises activation rate, a leading indicator for retention".
`;

export interface ObjectiveTaggingOutput {
  links: Array<{
    entity_id: string;
    goal_id: string;
    confidence: number;
    rationale: string;
  }>;
}
