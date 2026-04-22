/**
 * Wave A — ground decomposed entities in detected objectives.
 *
 * Called once at the tail of /api/pipeline/decompose/route.ts, right
 * after the synthesis_data write. Three steps:
 *
 *   1. Materialize synthesis_data.preliminary_objectives as
 *      improvement_goals rows with status='proposed', source='auto_detected'.
 *      Metric fields are left null — user fills them during approve.
 *
 *   2. If entities AND goals both exist, call the objective-tagging LLM
 *      with the cohort. Parse the response, filter out hallucinated ids,
 *      clamp confidence to [0, 1].
 *
 *   3. Insert entity_objectives junction rows from the validated tags.
 *      ON CONFLICT (entity_id, goal_id) DO NOTHING — re-runs of decompose
 *      don't accumulate duplicate links.
 *
 * Non-fatal: every step is wrapped. A failure in any stage logs + returns,
 * letting decompose succeed end-to-end. The review UI will show whatever
 * grounding DID land, and a subsequent re-run will add missing links.
 *
 * Memory indexing: each materialized goal is also upserted into
 * memory_items (kind='objective', scope='objective', scope_ref_id=goal.id)
 * so ambient retrieval can surface objectives.
 */

import { llmJSON } from "@/lib/llm";
import {
  OBJECTIVE_TAGGING_SYSTEM_PROMPT,
  type ObjectiveTaggingOutput,
} from "@/lib/prompts/objective-tagging";
import {
  upsertMemoryItemsBatch,
  buildObjectiveInput,
} from "@/lib/memory/writer";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface PreliminaryObjectiveInput {
  title: string;
  objective_type: string;
  rationale: string;
  confidence: "high" | "moderate" | "low";
  input_type_basis: string;
}

export interface EntityForTagging {
  id: string; // UUID in DB
  name: string;
  description: string | null;
  entity_category: string | null;
  importance: string | null;
}

export interface GroundObjectivesInput {
  db: AnyDb;
  spaceId: string;
  userId: string;
  preliminaryObjectives: PreliminaryObjectiveInput[];
  entities: EntityForTagging[];
}

export interface GroundObjectivesResult {
  goals_created: number;
  links_created: number;
  memory_indexed: number;
  llm_called: boolean;
  errors: string[];
}

// Map objective_type values the LLM might emit to the DB enum (which
// only accepts 5 values). We preserve the nuance in the title/rationale
// but coerce to the enum for storage.
const OBJECTIVE_TYPE_MAP: Record<string, string> = {
  maximize: "maximize",
  minimize: "minimize",
  maintain: "maintain",
  explore: "explore",
  avoid: "avoid",
  validate: "explore",  // validate → explore (closest DB match)
  build: "maximize",    // build → maximize
  defend: "maintain",   // defend → maintain
};

function coerceObjectiveType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return OBJECTIVE_TYPE_MAP[lower] ?? "explore";
}

export async function groundObjectives(
  input: GroundObjectivesInput,
): Promise<GroundObjectivesResult> {
  const { db, spaceId, userId, preliminaryObjectives, entities } = input;
  const result: GroundObjectivesResult = {
    goals_created: 0,
    links_created: 0,
    memory_indexed: 0,
    llm_called: false,
    errors: [],
  };

  if (preliminaryObjectives.length === 0) {
    // Nothing to materialize. Entities alone aren't enough; the user may
    // manually create goals later and we'll re-ground then (future Wave).
    return result;
  }

  // ── Step 1: materialize goals as 'proposed' rows ──
  const goalInserts = preliminaryObjectives.map((obj) => ({
    space_id: spaceId,
    user_id: userId,
    title: obj.title.slice(0, 500),
    description: null,
    metric_name: null,
    metric_unit: null,
    target_value: null,
    baseline_value: null,
    objective_type: coerceObjectiveType(obj.objective_type),
    source: "auto_detected" as const,
    status: "proposed" as const,
    auto_detection_rationale: obj.rationale.slice(0, 5000),
    auto_detection_confidence: obj.confidence,
    auto_detection_input_type: obj.input_type_basis.slice(0, 200),
    proposed_at: new Date().toISOString(),
  }));

  const { data: insertedGoals, error: goalErr } = (await db
    .from("improvement_goals")
    .insert(goalInserts)
    .select("id, title, description, auto_detection_rationale")) as {
    data: Array<{
      id: string;
      title: string;
      description: string | null;
      auto_detection_rationale: string | null;
    }> | null;
    error: unknown;
  };

  if (goalErr) {
    const msg = goalErr instanceof Error ? goalErr.message : String(goalErr);
    console.warn("[ground-objectives] goal insert failed:", msg);
    result.errors.push(`goal_insert: ${msg}`);
    return result;
  }

  const goals = insertedGoals ?? [];
  result.goals_created = goals.length;
  if (goals.length === 0) return result;

  // ── Step 2: memory-index each materialized goal so ambient + retrieval
  // can surface them immediately (no need to wait for the backfill). ──
  try {
    const memInputs = goals.map((g) =>
      buildObjectiveInput(userId, {
        id: g.id,
        title: g.title,
        description: g.description ?? g.auto_detection_rationale,
      }),
    );
    const memResult = await upsertMemoryItemsBatch(db, memInputs);
    result.memory_indexed = memResult.upserted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ground-objectives] memory index failed:", msg);
    result.errors.push(`memory_index: ${msg}`);
  }

  // ── Step 3: tag entities → goals via LLM ──
  if (entities.length === 0) {
    // No entities to tag against. Goals land without linkages; user can
    // add them manually during review.
    return result;
  }

  // Trim entity context to keep the LLM prompt bounded. We send up to 80
  // entities; a typical intake produces 20-60, so this covers the common
  // case without truncation. For hierarchical decomposes (~240), we
  // still truncate — the top-importance slice is usually sufficient for
  // objective linkage.
  const MAX_ENTITIES = 80;
  const prioritizedEntities = [...entities]
    .sort((a, b) => importanceRank(b.importance) - importanceRank(a.importance))
    .slice(0, MAX_ENTITIES);

  const promptPayload = {
    ENTITIES: prioritizedEntities.map((e) => ({
      entity_id: e.id,
      name: e.name,
      description: e.description ?? "",
      category: e.entity_category,
      importance: e.importance,
    })),
    OBJECTIVES: goals.map((g) => ({
      goal_id: g.id,
      title: g.title,
      rationale: g.auto_detection_rationale,
    })),
  };

  let tagged: ObjectiveTaggingOutput | null = null;
  try {
    tagged = await llmJSON<ObjectiveTaggingOutput>({
      system: OBJECTIVE_TAGGING_SYSTEM_PROMPT,
      user: JSON.stringify(promptPayload, null, 2),
      maxTokens: 2500,
      temperature: 0.2,
    });
    result.llm_called = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ground-objectives] LLM tagging failed:", msg);
    result.errors.push(`llm_tagging: ${msg}`);
    return result;
  }

  if (!tagged || !Array.isArray(tagged.links) || tagged.links.length === 0) {
    return result;
  }

  // Validate: every entity_id + goal_id must belong to the cohort we
  // sent. This is the hallucination filter.
  const validEntityIds = new Set(prioritizedEntities.map((e) => e.id));
  const validGoalIds = new Set(goals.map((g) => g.id));

  const validLinks = tagged.links.filter(
    (l) =>
      typeof l?.entity_id === "string" &&
      typeof l?.goal_id === "string" &&
      validEntityIds.has(l.entity_id) &&
      validGoalIds.has(l.goal_id) &&
      typeof l.confidence === "number",
  );

  if (validLinks.length === 0) return result;

  const junctionRows = validLinks.map((l) => ({
    entity_id: l.entity_id,
    goal_id: l.goal_id,
    confidence: Math.max(0, Math.min(1, l.confidence)),
    source: "auto_detected" as const,
    rationale:
      typeof l.rationale === "string" ? l.rationale.slice(0, 1000) : null,
  }));

  // ON CONFLICT (entity_id, goal_id) DO NOTHING — re-runs of decompose on
  // the same space don't accumulate duplicate links. The user can edit
  // during review; edits flip source='refined' to preserve audit.
  const { data: insertedLinks, error: linkErr } = await db
    .from("entity_objectives")
    .upsert(junctionRows, { onConflict: "entity_id,goal_id", ignoreDuplicates: true })
    .select("id");

  if (linkErr) {
    const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
    console.warn("[ground-objectives] junction insert failed:", msg);
    result.errors.push(`junction_insert: ${msg}`);
    return result;
  }

  result.links_created = (insertedLinks ?? []).length;
  return result;
}

function importanceRank(imp: string | null | undefined): number {
  switch (imp) {
    case "fundamental":
      return 4;
    case "critical":
      return 3;
    case "important":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}
