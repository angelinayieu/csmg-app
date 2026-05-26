// ── Generation Context Helpers ─────────────────────────────────────
//
// Three helpers that consolidate the 13-route copy-paste of context
// resolution. Each route used to inline:
//
//   1. "resolve the objective text" (try space.description, fall back
//      to space.input_text, fall back to parent goal description/title)
//   2. "resolve the parent objective + annotations" (if/else on
//      parent_sub_objective_id, double fallback to root goal)
//   3. "resolve the entity layer slug" (read layer_ontology, guard
//      against unknown slugs, default to "features")
//
// Pre-audit, the first pattern appeared in 13 routes, the second in
// 5, the third in 4. This module is Phase 1 of the systems-engineer
// cleanup — same behavior, single source of truth, easier to evolve.
//
// Soft-fail by design: each helper returns the safest default on any
// failure. Callers should NOT need defensive null-checks for the
// happy path. When a value is genuinely required (e.g., a sub-
// objective must exist to render a room), the caller checks at the
// route boundary, not here.

import { normalizeAnnotations } from "./normalize-annotations";
import type { ObjectiveAnnotation } from "./generate-annotations";

// ── Layer slug guard ──────────────────────────────────────────────

export const LAYER_SLUGS = [
  "pain",
  "features",
  "outcomes",
  "objective",
] as const;
export type LayerSlug = (typeof LAYER_SLUGS)[number];

function isLayerSlug(s: string): s is LayerSlug {
  return (LAYER_SLUGS as readonly string[]).includes(s);
}

// ── 1. resolveCoreObjectiveText ───────────────────────────────────

/** Resolves the objective text the LLM should see for a space-scoped
 *  generation call. Priority (each step falls through on empty):
 *    1. parentGoal.description (when caller already loaded it)
 *    2. parentGoal.title
 *    3. space.description
 *    4. space.input_text
 *    5. "" (empty string — caller's responsibility to guard)
 *
 *  The dual signature reflects how the codebase actually loads:
 *  most routes have the space row already; some also load a parent
 *  improvement_goal first. Passing parentGoal as the optional second
 *  arg keeps the helper's API tight without forcing every caller
 *  to fetch the parent. */
export function resolveCoreObjectiveText(
  space: {
    description?: string | null;
    input_text?: string | null;
  } | null,
  parentGoal?: {
    description?: string | null;
    title?: string | null;
  } | null,
): string {
  const candidates: Array<string | null | undefined> = [
    parentGoal?.description,
    parentGoal?.title,
    space?.description,
    space?.input_text,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c.trim();
    }
  }
  return "";
}

// ── 2. resolveParentObjectiveContext ──────────────────────────────

export interface ParentObjectiveContext {
  /** Title of the sub-objective the entity belongs to. "" when the
   *  entity is space-scoped (no parent_sub_objective_id). */
  subObjectiveTitle: string;
  /** Final resolved core objective text — see resolveCoreObjectiveText
   *  for the priority order. */
  coreObjectiveText: string;
  /** Normalized parent-goal annotations. Empty array when no
   *  annotations exist (legacy spaces / annotation generation
   *  hasn't run yet). */
  annotations: ObjectiveAnnotation[];
}

/** Resolves the full parent-objective context for an entity:
 *  the sub-objective title, the core objective text, and the parent
 *  goal's annotations. Walks the canonical chain:
 *
 *    entity.parent_sub_objective_id
 *      → improvement_goals (sub-objective)
 *      → improvement_goals (parent goal — for description + annotations)
 *
 *  When the entity has NO sub-objective parent (space-scoped entity),
 *  falls back to the space's root goal (parent_goal_id IS NULL) for
 *  annotations. The fallback is what 5 routes used to inline as a
 *  separate if/else block.
 *
 *  Soft-fail: missing rows return empty defaults. Caller decides
 *  whether emptiness is a hard error in its specific flow. */
export async function resolveParentObjectiveContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  entity: {
    space_id: string;
    parent_sub_objective_id?: string | null;
  },
  space: {
    description?: string | null;
    input_text?: string | null;
  } | null,
): Promise<ParentObjectiveContext> {
  let subObjectiveTitle = "";
  let parentGoalRow: { description?: string | null; title?: string | null } | null = null;
  let annotationsRaw: unknown = null;

  if (entity.parent_sub_objective_id) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub) {
      subObjectiveTitle = typeof sub.title === "string" ? sub.title : "";
      if (sub.parent_goal_id) {
        const { data: parent } = await db
          .from("improvement_goals")
          .select("title, description, annotations")
          .eq("id", sub.parent_goal_id)
          .maybeSingle();
        if (parent) {
          parentGoalRow = {
            description: parent.description,
            title: parent.title,
          };
          annotationsRaw = parent.annotations ?? null;
        }
      }
    }
  }

  // Fallback: when no parent_sub_objective_id OR when the chain
  // didn't yield annotations, pull from the space's root goal
  // (parent_goal_id IS NULL). This is the canonical recovery path
  // every duplicate copy used to inline.
  if (!annotationsRaw) {
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("title, description, annotations")
      .eq("space_id", entity.space_id)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rootGoal) {
      // Only use the root for objective text when we didn't already
      // get text from the parent chain — preserves precedence.
      if (!parentGoalRow) {
        parentGoalRow = {
          description: rootGoal.description,
          title: rootGoal.title,
        };
      }
      annotationsRaw = rootGoal.annotations ?? null;
    }
  }

  return {
    subObjectiveTitle,
    coreObjectiveText: resolveCoreObjectiveText(space, parentGoalRow),
    annotations: normalizeAnnotations(annotationsRaw),
  };
}

// ── 3. resolveEntityLayer ─────────────────────────────────────────

/** Resolves the layer slug for an entity from its layer_ontology_id.
 *  Default: "features" when the row is missing or the slug isn't one
 *  of the canonical LAYER_SLUGS. This default has been the
 *  established behavior across the 4 routes that duplicated this
 *  pattern; not changing it here.
 *
 *  Returns "features" without any DB call when layer_ontology_id is
 *  null — saves a query in the common space-scoped-entity case. */
export async function resolveEntityLayer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  layer_ontology_id: string | null | undefined,
): Promise<LayerSlug> {
  if (!layer_ontology_id) return "features";
  const { data: layerRow } = await db
    .from("layer_ontology")
    .select("slug")
    .eq("id", layer_ontology_id)
    .maybeSingle();
  if (!layerRow || typeof layerRow.slug !== "string") return "features";
  return isLayerSlug(layerRow.slug) ? layerRow.slug : "features";
}
