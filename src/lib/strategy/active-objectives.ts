// ── Active objectives resolver (Tier 2 of strategy rework) ─────────────
//
// Tells the strategy generator what to fan out over. Single source of
// truth so app-generator, baseline capture, and the strategy refresh
// route all agree on which objectives are "live" right now.
//
// Resolution order — from most authoritative to least:
//   1. Top-level active improvement_goal + its child improvement_goals
//      (where parent_goal_id matches). The user has explicitly authored
//      these via the goal hierarchy UI.
//   2. Top-N suggested_objectives for the space if no goal hierarchy
//      exists yet — gives multi-strategy generation a cold-start signal
//      the first time a user runs analysis on a fresh space.
//   3. Empty array — caller should fall back to single-strategy
//      generation against whatever activeGoal exists (or none).
//
// Why this lives in lib/strategy and not in the route:
//   - Reused by app-generator (batch entry point) + by future strategy
//     updater (per-objective regen)
//   - Easier to unit-test than route handlers
//   - Centralizes the K-cap (we can't fan out infinitely; LLM bill)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ImprovementGoal } from "@/types/goals";

// Supabase generic collapse — match the convention used elsewhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<Database> | any;

/**
 * Maximum number of objectives we'll fan out strategy generation across
 * in a single batch. Each objective costs ~one full strategy LLM chain
 * (diagnosis → synthesis → verification → final), so this cap directly
 * bounds the cost of a refresh.
 *
 * Picked 5 because:
 *   - 1 top-level + 4 children covers most realistic goal hierarchies
 *   - Beyond 5, the value-per-objective drops fast (the user can't
 *     meaningfully act on 8 simultaneous strategies)
 *   - Bumping later is one-line if real users hit the ceiling
 */
export const MAX_OBJECTIVES_PER_BATCH = 5;

/**
 * One target the strategy generator should produce a focused strategy for.
 * `goal_id` is the canonical FK; `title`/`metric_name` are denormalized so
 * the prompt can construct grounded language without an extra DB lookup.
 */
export interface ActiveObjective {
  /** improvement_goals.id when source === "goal_hierarchy"; suggested_objectives.id when "suggestion" */
  source_id: string;
  source: "goal_hierarchy" | "suggestion";
  /** improvement_goals.id when present — the FK we tag apps + strategies with */
  goal_id: string | null;
  /** Top-level goal this objective belongs to. Equals goal_id for the root. */
  parent_goal_id: string | null;
  title: string;
  description?: string | null;
  metric_name?: string;
  metric_unit?: string | null;
  baseline_value?: number | null;
  target_value?: number | null;
  /** Stable ordering in the batch — root first, then children, then suggestions. */
  rank: number;
  /** When true, this is the user's primary goal (root). Surfaces in UI as "Main strategy". */
  is_primary: boolean;
  /** Wave D L0.3 — top entities (by LLM-tagged confidence) that Wave A's
   *  entity_objectives junction linked to this goal. Populated for
   *  goal_hierarchy sources only; undefined for suggestions. Strategy
   *  prompts can reference these by name to ground recommendations in
   *  the actual KG. Capped at 8 per goal so prompts stay token-bounded. */
  served_by_entities?: Array<{
    entity_id: string;
    name: string;
    entity_category: string | null;
    confidence: number;
    rationale: string | null;
  }>;
}

export interface ResolveObjectivesArgs {
  db: DB;
  spaceId: string;
  /** Cap on returned objectives; defaults to MAX_OBJECTIVES_PER_BATCH. */
  limit?: number;
  /**
   * When true, returns an empty array instead of falling back to
   * suggestions if no goal hierarchy exists. Used by callers that only
   * want explicit user-authored objectives (e.g. agent regen flows that
   * shouldn't invent goals).
   */
  goalsOnly?: boolean;
}

export interface ResolveObjectivesResult {
  objectives: ActiveObjective[];
  source: "goal_hierarchy" | "suggestions" | "none";
  /** Total number of candidate objectives before the cap was applied. */
  total_candidates: number;
}

/**
 * Resolve the set of objectives to fan strategy generation over.
 *
 * Cheap to call: 1-2 indexed queries, no LLM. Safe to invoke from the
 * strategy-refresh route on every refresh — no caching needed.
 */
export async function resolveActiveObjectives(
  args: ResolveObjectivesArgs,
): Promise<ResolveObjectivesResult> {
  const { db, spaceId, limit = MAX_OBJECTIVES_PER_BATCH, goalsOnly = false } = args;

  // ── 1. Goal hierarchy path ─────────────────────────────────────────
  const { data: goalRows } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const allActiveGoals = (goalRows ?? []) as ImprovementGoal[];

  if (allActiveGoals.length > 0) {
    // Find the root: top-level active goal (no parent).
    // If multiple top-level active goals exist, we pick the most recently
    // created one — matches space-data-context.tsx:135-141 behavior so the
    // strategy fan-out lines up with what the UI considers "the active goal".
    const topLevels = allActiveGoals.filter((g) => !g.parent_goal_id);
    const root = topLevels[topLevels.length - 1] ?? allActiveGoals[0];

    // Children whose parent_goal_id matches the root.
    const children = allActiveGoals
      .filter((g) => g.parent_goal_id === root.id)
      // Stable order — by created_at ascending so reruns produce the
      // same batch ordering and downstream apps don't reshuffle.
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    const ordered: ActiveObjective[] = [
      goalToObjective(root, 0, true, null),
      ...children.map((c, i) =>
        goalToObjective(c, i + 1, false, root.id),
      ),
    ];

    // Wave D L0.3 — hydrate served_by_entities from the entity_objectives
    // junction (Wave A) so the strategy prompt can reference actual KG
    // entities linked to each goal. One batch query covers all goals in
    // this batch; soft-fail leaves `served_by_entities` undefined on any
    // error (strategy engine handles the undefined path).
    const capped = ordered.slice(0, limit);
    try {
      const goalIds = capped
        .map((o) => o.goal_id)
        .filter((id): id is string => !!id);
      if (goalIds.length > 0) {
        const { data: junction } = (await db
          .from("entity_objectives")
          .select("entity_id, goal_id, confidence, rationale")
          .in("goal_id", goalIds)
          .order("confidence", { ascending: false })) as {
          data: Array<{
            entity_id: string;
            goal_id: string;
            confidence: number;
            rationale: string | null;
          }> | null;
        };
        const links = junction ?? [];
        const entityIds = Array.from(
          new Set(links.map((l) => l.entity_id)),
        );
        let entityById = new Map<
          string,
          { name: string; entity_category: string | null }
        >();
        if (entityIds.length > 0) {
          const { data: ents } = (await db
            .from("entities")
            .select("id, name, entity_category")
            .in("id", entityIds)) as {
            data: Array<{
              id: string;
              name: string;
              entity_category: string | null;
            }> | null;
          };
          entityById = new Map(
            (ents ?? []).map((e) => [
              e.id,
              { name: e.name, entity_category: e.entity_category },
            ]),
          );
        }
        const linksByGoal = new Map<string, typeof links>();
        for (const l of links) {
          const arr = linksByGoal.get(l.goal_id) ?? [];
          arr.push(l);
          linksByGoal.set(l.goal_id, arr);
        }
        for (const obj of capped) {
          if (!obj.goal_id) continue;
          const goalLinks = linksByGoal.get(obj.goal_id) ?? [];
          // Top 8 by confidence, already sorted descending.
          obj.served_by_entities = goalLinks
            .slice(0, 8)
            .map((l) => {
              const e = entityById.get(l.entity_id);
              if (!e) return null;
              return {
                entity_id: l.entity_id,
                name: e.name,
                entity_category: e.entity_category,
                confidence: l.confidence,
                rationale: l.rationale,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
        }
      }
    } catch (err) {
      console.warn(
        "[active-objectives] entity_objectives hydration failed (non-fatal):",
        err,
      );
    }

    return {
      objectives: capped,
      source: "goal_hierarchy",
      total_candidates: ordered.length,
    };
  }

  // ── 2. Suggestion fallback ─────────────────────────────────────────
  if (goalsOnly) {
    return { objectives: [], source: "none", total_candidates: 0 };
  }

  const { data: suggestionRows } = await db
    .from("suggested_objectives")
    .select("*")
    .eq("space_id", spaceId)
    .order("rank", { ascending: true })
    .limit(limit);

  const suggestions = (suggestionRows ?? []) as Array<{
    id: string;
    title: string;
    rationale?: string | null;
    metric_name?: string | null;
    metric_unit?: string | null;
    baseline_estimate?: number | null;
    target_estimate?: number | null;
    rank?: number | null;
  }>;

  if (suggestions.length === 0) {
    return { objectives: [], source: "none", total_candidates: 0 };
  }

  return {
    objectives: suggestions.map((s, i) => ({
      source_id: s.id,
      source: "suggestion" as const,
      goal_id: null,                    // no FK until the user promotes the suggestion to a goal
      parent_goal_id: null,
      title: s.title,
      description: s.rationale ?? null,
      metric_name: s.metric_name ?? undefined,
      metric_unit: s.metric_unit ?? undefined,
      baseline_value: s.baseline_estimate ?? undefined,
      target_value: s.target_estimate ?? undefined,
      rank: s.rank ?? i + 1,
      is_primary: i === 0,
    })),
    source: "suggestions",
    total_candidates: suggestions.length,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function goalToObjective(
  g: ImprovementGoal,
  rank: number,
  isPrimary: boolean,
  parentId: string | null,
): ActiveObjective {
  return {
    source_id: g.id,
    source: "goal_hierarchy",
    goal_id: g.id,
    parent_goal_id: parentId,
    title: g.title,
    description: g.description ?? null,
    metric_name: g.metric_name,
    metric_unit: g.metric_unit ?? null,
    baseline_value: g.baseline_value ?? null,
    target_value: g.target_value ?? null,
    rank,
    is_primary: isPrimary,
  };
}

/**
 * Turn an ActiveObjective into an ImprovementGoal-shaped object for
 * downstream code that expects the goal type. Used by strategy-engine
 * which currently takes `activeGoal: ImprovementGoal | null`.
 *
 * For suggestion-sourced objectives, returns null because no real goal
 * row exists yet — strategy-engine handles the null path cleanly via
 * its `suggestedObjectives` fallback.
 */
export function asImprovementGoal(
  obj: ActiveObjective,
): ImprovementGoal | null {
  if (obj.source !== "goal_hierarchy" || !obj.goal_id) return null;
  return {
    id: obj.goal_id,
    space_id: "",                     // filled in by caller from context
    user_id: "",
    title: obj.title,
    description: obj.description ?? null,
    metric_name: obj.metric_name ?? "",
    metric_unit: obj.metric_unit ?? null,
    target_value: obj.target_value ?? 0,
    baseline_value: obj.baseline_value ?? 0,
    current_value: obj.baseline_value ?? 0,
    deadline: null,
    status: "active",
    created_at: "",
    updated_at: "",
    parent_goal_id: obj.parent_goal_id,
  } as unknown as ImprovementGoal;
}
