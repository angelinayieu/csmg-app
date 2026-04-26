// ── Canvas combination — shared LLM helper ────────────────────────────
//
// One source of truth for "given 2-4 entity ids, ask the LLM what their
// combination implies." Lifted out of the /api/canvas/combination route
// so the same logic can be invoked from BOTH:
//
//   • the user-facing route (POST /api/canvas/combination — debounced
//     by use-canvas-combination.ts when the user drags entities into
//     the combination slot on the whiteboard)
//   • the strategizer's executor (Phase 4 §5.3 nominates
//     `combo:{a}+{b}` work items; without this helper, the executor
//     either has to make its own HTTP call to its own API — fragile,
//     auth-coupled — or duplicate the LLM logic — drift-prone)
//
// Returns the same shape both callers need. The DB client is passed in
// so this works with both per-session and service-role Supabase
// clients (cron drains run service-role).
//
// Soft-fail philosophy: the helper never throws on LLM hiccups — it
// returns a fallback shape with novelty="trivial" so callers can still
// persist *something* and the queue/work-item completes. Hard errors
// (entities not found, < 2 valid ids) return null and the caller decides.

import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJSON } from "@/lib/llm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type CombinationNovelty = "emergent" | "reinforcing" | "tension" | "trivial";

export interface CombinationResult {
  title: string;
  implication: string;
  novelty: CombinationNovelty;
  mechanism: string;
  probes: string[];
  source_entities: Array<{ id: string; name: string }>;
}

const SYSTEM_PROMPT = `You are a research partner helping a user identify what the intersection of a small set of concepts implies. Given 2-4 entities from the user's knowledge graph, interpret their combination.

Return strict JSON:
{
  "title": "short headline for the combined insight (<= 10 words)",
  "implication": "1-2 sentences stating what the combination implies in the user's domain. Be concrete.",
  "novelty": "emergent | reinforcing | tension | trivial",
  "mechanism": "1 sentence on the mechanism that links them",
  "probes": ["question the user should probe next (<=12 words)", ...]  // 2-3 questions
}

Rules:
- novelty="emergent" when the combination produces something not in the individual parts.
- "reinforcing" when they mutually strengthen a shared claim.
- "tension" when they conflict.
- "trivial" when one trivially follows from the other — include a short reason in the mechanism.
- Mention entity names by their provided names.
- No preamble. No markdown. Strict JSON only.`;

/**
 * Run the canvas combination interpretation against a set of entity ids.
 *
 * @returns CombinationResult on success, or null when the inputs are
 *   degenerate (fewer than 2 valid entities resolved, or DB read failed).
 *   LLM failures degrade to a fallback CombinationResult with
 *   novelty="trivial" rather than null — callers always get a shape
 *   they can persist.
 */
export async function runCanvasCombination(
  db: AnyDb,
  entityIds: string[],
): Promise<CombinationResult | null> {
  // Cap at 4: the prompt assumes "2-4 entities" and longer combinations
  // start producing rambling LLM output without buying signal.
  const ids = entityIds.slice(0, 4);
  if (ids.length < 2) return null;

  // Cross-space allowed — owner is enforced upstream (route does
  // verifySpaceOwnership; executor only acts on entities it just
  // decoded from a plan it owns). This helper itself is auth-agnostic.
  const { data: rawEntities, error } = await db
    .from("entities")
    .select("id, name, description, entity_category, layer")
    .in("id", ids);
  if (error) {
    console.warn("[canvas-combination] entities fetch failed:", error);
    return null;
  }

  const entities = (rawEntities ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    entity_category: string | null;
    layer: string | null;
  }>;
  if (entities.length < 2) return null;

  const entityBlock = entities
    .map(
      (e) =>
        `- ${e.name}${e.entity_category ? ` [${e.entity_category}]` : ""}${e.layer ? ` (${e.layer})` : ""}${e.description ? `: ${e.description.slice(0, 140)}` : ""}`,
    )
    .join("\n");

  const userPrompt = `Entities to combine:\n${entityBlock}\n\nInterpret their combination.`;

  const sourceEntities = entities.map((e) => ({ id: e.id, name: e.name }));
  const fallback: CombinationResult = {
    title: "Combined view",
    implication: entities.map((e) => e.name).join(" × "),
    novelty: "trivial",
    mechanism: "Unable to infer a mechanism from these entities.",
    probes: [],
    source_entities: sourceEntities,
  };

  const result = await llmJSON<Omit<CombinationResult, "source_entities">>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 500,
    temperature: 0.4,
    fallback,
  });

  return {
    title: result.title ?? fallback.title,
    implication: result.implication ?? fallback.implication,
    novelty: (result.novelty ?? fallback.novelty) as CombinationNovelty,
    mechanism: result.mechanism ?? fallback.mechanism,
    probes: Array.isArray(result.probes) ? result.probes.slice(0, 3) : [],
    source_entities: sourceEntities,
  };
}
