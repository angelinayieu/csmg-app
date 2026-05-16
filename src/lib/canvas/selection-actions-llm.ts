// ── Selection-action LLM helpers ──
//
// Shared LLM-calling functions for the canvas selection popover's
// Variations / Make-a-plan / Rank actions. Each function:
//   - Validates the entity context (loads from DB).
//   - Calls llmJSON with an action-specific prompt.
//   - Returns a structured result the route handler persists.
//
// Persistence (inserting new entities + edges, updating ranks) is
// kept in the route handler — this file is pure prompt + parsing
// so the unit-tests can mock the LLM and verify the output shape
// without DB plumbing.

import { llmJSON } from "@/lib/llm";
import type { Entity } from "@/types";

// ── Variations ───────────────────────────────────────────────────

export interface VariationOutput {
  /** A new framing of the parent entity. NOUN PHRASE. */
  name: string;
  /** 1-sentence: how this differs from the original. */
  description: string;
  /** entity_category for the new entity row. */
  entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic";
}

const VARIATIONS_SYSTEM = `You generate alternative framings of an idea. Given one entity (name + description), produce 3 distinct alternatives.

Each alternative is:
- A NOUN PHRASE that re-frames the original (not a verb, not a question).
- Meaningfully different from the original AND from the other alternatives — no synonyms, no rewording.
- More specific OR more general OR sideways (different lens) — but not vaguer.

Return strictly valid JSON: { "variations": [{ "name": "...", "description": "...", "entity_category": "..." }] }`;

export async function generateVariations(
  entity: Pick<Entity, "name" | "description">,
): Promise<VariationOutput[]> {
  const result = await llmJSON<{ variations: VariationOutput[] }>({
    system: VARIATIONS_SYSTEM,
    user: `Original entity:\nName: ${entity.name}\nDescription: ${entity.description ?? "(no description)"}\n\nProduce 3 alternatives.`,
    maxTokens: 800,
    temperature: 0.8,
    fallback: { variations: [] },
  });
  return (result.variations ?? []).slice(0, 3);
}

// ── Make-a-plan ──────────────────────────────────────────────────

export interface PlanStepOutput {
  /** Numbered step name — short, action-oriented. */
  name: string;
  /** 1-sentence: what this step actually does. */
  description: string;
  /** Which of the input entity_ids this step depends on / draws
   *  from. Optional — empty array means "starts from scratch". */
  depends_on: string[];
}

const PLAN_SYSTEM = `You generate sequenced action plans from a set of related ideas. Given N entities (names + descriptions), produce 3-5 plan steps that tie them together into an executable sequence.

Each step is:
- An action (verb-led), not a description.
- Bounded — completable in days or weeks, not years.
- Linked to which input entities it draws from via "depends_on" (use the entity_ids provided).

Steps should COMBINE the input entities, not just enumerate them. The plan should produce something the user couldn't have built from any single entity alone.

Return strictly valid JSON: { "steps": [{ "name": "...", "description": "...", "depends_on": ["entity_id", ...] }] }`;

export async function generatePlan(
  entities: Array<Pick<Entity, "entity_id" | "name" | "description">>,
): Promise<PlanStepOutput[]> {
  const list = entities
    .map(
      (e) =>
        `- entity_id="${e.entity_id}", name="${e.name}", description="${e.description ?? "(none)"}"`,
    )
    .join("\n");
  const result = await llmJSON<{ steps: PlanStepOutput[] }>({
    system: PLAN_SYSTEM,
    user: `Input entities:\n${list}\n\nProduce a 3-5 step plan that uses these together.`,
    maxTokens: 1200,
    temperature: 0.6,
    fallback: { steps: [] },
  });
  return (result.steps ?? []).slice(0, 5);
}

// ── Extract (Focus mode Stage 2) ──────────────────────────────────

export type ExtractionKind =
  | "core_idea"
  | "upstream_dependency"
  | "downstream_output"
  | "polished_product"
  | "alternative";

export interface ExtractionResult {
  entity_id: string;
  kind: ExtractionKind;
  /** 1-sentence rationale for the classification. */
  rationale: string;
}

const EXTRACT_KIND_DEFINITIONS: Record<ExtractionKind, string> = {
  core_idea:
    "Sits at the conceptual center. Other items derive from it; if it changed, half the others would shift.",
  upstream_dependency:
    "Something the project NEEDS but doesn't own. A precondition, input, or external supplier.",
  downstream_output:
    "Something the project PRODUCES that flows OUT. A deliverable, side effect, or downstream consumer.",
  polished_product:
    "A near-final artifact the user could ship or hand off today. Concrete, complete-feeling.",
  alternative:
    "A competing framing or rival approach. Useful for comparison; not the chosen path.",
};

const EXTRACT_SYSTEM = `You classify entities into one of five canonical "extracted component" kinds. Apply the definitions strictly — when an entity could fit two kinds, pick the most distinctive one.

Kinds:
${Object.entries(EXTRACT_KIND_DEFINITIONS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

For each entity:
- kind: one of the five above
- rationale: one sentence (≤ 20 words) explaining why this kind fits best

Return strictly valid JSON: { "classifications": [{ "entity_id": "...", "kind": "...", "rationale": "..." }] }`;

export async function extractComponents(
  entities: Array<Pick<Entity, "entity_id" | "name" | "description">>,
): Promise<ExtractionResult[]> {
  const list = entities
    .map(
      (e) =>
        `- entity_id="${e.entity_id}", name="${e.name}", description="${e.description ?? "(none)"}"`,
    )
    .join("\n");
  const result = await llmJSON<{ classifications: ExtractionResult[] }>({
    system: EXTRACT_SYSTEM,
    user: `Entities to classify:\n${list}`,
    maxTokens: 1400,
    temperature: 0.3,
    fallback: { classifications: [] },
  });
  return result.classifications ?? [];
}

// ── Rank ─────────────────────────────────────────────────────────

export type RankCriterion =
  | "importance"
  | "novelty"
  | "feasibility"
  | "urgency"
  | "surprise";

export interface RankResult {
  entity_id: string;
  /** 0..100 score on the chosen criterion. */
  score: number;
  /** 1-sentence rationale for this position. */
  rationale: string;
}

const RANK_CRITERIA_PROMPTS: Record<RankCriterion, string> = {
  importance:
    "How structurally important is each entity — does it sit at a load-bearing junction (high importance) or is it a leaf detail (low importance)?",
  novelty:
    "How novel is each entity — would a domain expert say this is fresh insight (high novelty) or well-trodden (low novelty)?",
  feasibility:
    "How feasible is each entity to act on RIGHT NOW with current resources (high feasibility) vs requiring long buildup (low feasibility)?",
  urgency:
    "How urgent is each entity — would delay materially worsen the situation (high urgency) or is timing flexible (low urgency)?",
  surprise:
    "How surprising is each entity given the rest of the set — does it cut against the grain (high surprise) or fit expectations (low surprise)?",
};

const RANK_SYSTEM = `You score entities on a single criterion and return them ordered by score (descending). The criterion is provided below; apply it consistently across all entities.

For each entity:
- score: integer 0–100. Use the FULL range — don't bunch in the middle.
- rationale: one sentence (max 20 words) explaining the score.

Return strictly valid JSON: { "ranking": [{ "entity_id": "...", "score": 0-100, "rationale": "..." }] }`;

export async function rankEntities(
  entities: Array<Pick<Entity, "entity_id" | "name" | "description">>,
  criterion: RankCriterion,
): Promise<RankResult[]> {
  const list = entities
    .map(
      (e) =>
        `- entity_id="${e.entity_id}", name="${e.name}", description="${e.description ?? "(none)"}"`,
    )
    .join("\n");
  const result = await llmJSON<{ ranking: RankResult[] }>({
    system: RANK_SYSTEM,
    user: `Criterion: ${criterion}\n${RANK_CRITERIA_PROMPTS[criterion]}\n\nEntities to rank:\n${list}`,
    maxTokens: 1200,
    temperature: 0.3,
    fallback: { ranking: [] },
  });
  // Sort by score descending so the caller doesn't need to.
  return [...(result.ranking ?? [])].sort((a, b) => b.score - a.score);
}
