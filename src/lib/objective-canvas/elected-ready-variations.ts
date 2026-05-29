// ── Elected-ready-variations aggregator ────────────────────────────
//
// Server-side helper for the auto-generate-deliverables feature. Walks
// the canvas data model (spaces → improvement_goals → entities) and
// returns every variation that has passed the 5 auto-gen gates:
//
//   Gate A: parent room is generated
//             (improvement_goals.room_layers_generated_at !== null)
//   Gate B: parent entity has been expanded
//             (entities.expanded_detail.generated_at !== null)
//   Gate C: variation has been scored
//             (variation.effectiveness_score is a finite number)
//   Gate D: variation's scoring method is declared
//             (variation.evaluation_method is one of the 5 tiers)
//   Gate E: variation is elected
//             (variation.disposition === "elected")
//
// A variation that passes all 5 is "ready" — the deliverables strip on
// the main canvas lights it green and lets the user fire auto-gen for
// it. A variation that's elected but fails any of A-D shows up greyed
// with the missing prereq surfaced ("needs scoring", "needs room",
// etc.) so the user knows what step to run first.
//
// One DB round-trip per space (improvement_goals + a single entities
// query filtered to those room ids). JSONB unrolling happens in
// application code — Postgres would handle this faster via jsonb_path
// but the current scale doesn't justify the SQL complexity.

import type {
  ExpandedItemDetail,
  ItemVariation,
} from "./expand-item-detail";

export type AutoGenGate = "room" | "expanded" | "scored" | "method" | "elected";

export interface ReadyVariationRow {
  /** Parent entity (mechanism / feature). */
  entity_id: string;
  entity_name: string;
  /** Parent room (sub_objective). */
  sub_objective_id: string;
  sub_objective_title: string;
  /** The variation itself. */
  variation_id: string;
  variation_name: string;
  variation_description: string;
  /** Score-side fields — populated for any variation that passed Gate C. */
  effectiveness_score?: number;
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested"
    | "ensemble";
  /** Disposition mirror (always "elected" for rows returned with all 5
   *  gates green; needed for the "elected but missing prereqs" rows
   *  filtered in via includeNotReady). */
  disposition: "elected" | "rejected" | "deferred" | null;
  /** Which gates this variation passes. All 5 true = green / ready
   *  to auto-gen. Anything false surfaces in the UI as a "needs X"
   *  hint and disables the per-row Generate-all button. */
  gates: Record<AutoGenGate, boolean>;
  /** True when ALL of gates.{room,expanded,scored,method,elected} pass. */
  ready: boolean;
  /** Cached deliverable artifact presence — drives the four status
   *  dots in the strip. */
  has_description_doc: boolean;
  has_mockup_fullscreen: boolean;
  has_mockup_thumbnail: boolean;
  has_export_prompt: boolean;
  /** When export_prompt_history is populated, the user's seen the
   *  round-trip tested + judged version. */
  has_export_prompt_optimized: boolean;
}

interface SubObjectiveRow {
  id: string;
  title: string;
  room_layers_generated_at: string | null;
}

interface EntityRow {
  id: string;
  name: string;
  parent_sub_objective_id: string | null;
  expanded_detail: ExpandedItemDetail | null;
}

export interface GetReadyArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  /** When true, also return elected variations that DON'T pass all
   *  5 gates (so the UI can surface the missing prereqs). Defaults
   *  to true — the strip wants to teach the user what's missing,
   *  not silently hide work-in-progress. */
  includeNotReady?: boolean;
}

export async function getElectedReadyVariations(
  args: GetReadyArgs,
): Promise<ReadyVariationRow[]> {
  const { db, spaceId, userId, includeNotReady = true } = args;

  // ── 1. Sub-objectives (children of the space's root goal) ──
  // We pull room_layers_generated_at for Gate A; title for display.
  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, room_layers_generated_at, parent_goal_id")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .not("parent_goal_id", "is", null);
  const subs = (subRows ?? []) as Array<
    SubObjectiveRow & { parent_goal_id: string | null }
  >;
  if (subs.length === 0) return [];

  const subById = new Map<string, SubObjectiveRow>();
  for (const s of subs) subById.set(s.id, s);

  // ── 2. Entities scoped to those sub-objectives ──
  const subIds = subs.map((s) => s.id);
  const { data: entRows } = await db
    .from("entities")
    .select("id, name, parent_sub_objective_id, expanded_detail")
    .in("parent_sub_objective_id", subIds);
  const entities = (entRows ?? []) as EntityRow[];

  // ── 3. Walk variations, apply gates ──
  const out: ReadyVariationRow[] = [];
  for (const e of entities) {
    if (!e.parent_sub_objective_id) continue;
    const sub = subById.get(e.parent_sub_objective_id);
    if (!sub) continue;
    const detail = e.expanded_detail;
    if (!detail || !Array.isArray(detail.variations)) continue;

    const gateRoom = !!sub.room_layers_generated_at;
    const gateExpanded = !!detail.generated_at;

    for (const v of detail.variations as ItemVariation[]) {
      if (!v.id) continue;
      const gateElected = v.disposition === "elected";
      // Skip non-elected entirely — the strip is for the user's
      // committed direction, not the full lineup. Caller can switch
      // semantics later by adding an opts.includeAllDisposed flag.
      if (!gateElected) continue;

      const gateScored = typeof v.effectiveness_score === "number" &&
        Number.isFinite(v.effectiveness_score);
      const gateMethod = !!v.evaluation_method;
      const ready = gateRoom && gateExpanded && gateScored && gateMethod;

      if (!ready && !includeNotReady) continue;

      out.push({
        entity_id: e.id,
        entity_name: e.name,
        sub_objective_id: sub.id,
        sub_objective_title: sub.title,
        variation_id: v.id,
        variation_name: v.name,
        variation_description: v.description,
        effectiveness_score: gateScored ? v.effectiveness_score : undefined,
        evaluation_method: gateMethod ? v.evaluation_method : undefined,
        disposition: v.disposition ?? null,
        gates: {
          room: gateRoom,
          expanded: gateExpanded,
          scored: gateScored,
          method: gateMethod,
          elected: gateElected,
        },
        ready,
        has_description_doc:
          typeof v.description_doc === "string" &&
          v.description_doc.length > 0,
        has_mockup_fullscreen:
          typeof v.mockup_html === "string" && v.mockup_html.length > 0,
        has_mockup_thumbnail:
          typeof v.mockup_thumbnail_html === "string" &&
          v.mockup_thumbnail_html.length > 0,
        has_export_prompt:
          typeof v.export_prompt === "string" && v.export_prompt.length > 0,
        has_export_prompt_optimized:
          v.export_prompt_history !== undefined &&
          v.export_prompt_history !== null,
      });
    }
  }

  // Sort: ready rows first (by score desc), then not-ready rows
  // (alphabetical by entity_name). This keeps the "you can fire
  // these now" set at the top.
  out.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    if (a.ready && b.ready) {
      const sa = a.effectiveness_score ?? 0;
      const sb = b.effectiveness_score ?? 0;
      if (sa !== sb) return sb - sa;
    }
    return a.entity_name.localeCompare(b.entity_name);
  });

  return out;
}

// ── Per-sub progress (the canvas flashcard progress bar) ────────────
//
// Collapses the same 5-gate pipeline above into a single 0–5 readiness
// signal for ONE sub-objective, so a card can show "how far this
// feature is from being export-ready" at a glance. Reuses the exact
// gate semantics (single source of truth) but rolls them up to the sub
// level: a stage is "reached" if ANY entity / variation under the sub
// satisfies it.

export type SubProgressStage =
  | "generated"
  | "expanded"
  | "scored"
  | "elected"
  | "delivered";

export interface SubProgressStageDef {
  key: SubProgressStage;
  /** Full label for the tooltip. */
  label: string;
  /** Short caption shown inline next to the bar. */
  short: string;
}

// Ordered low→high. The bar fills cumulatively up to the highest stage
// reached, so a sub that's "elected" still reads as having cleared
// "scored" even if score data was backfilled out of order — the
// product flow only reaches election THROUGH experimentation.
export const SUB_PROGRESS_STAGES: SubProgressStageDef[] = [
  { key: "generated", label: "Function analyzed — room generated", short: "Analyzed" },
  { key: "expanded", label: "Items deepened — causal detail expanded", short: "Deepened" },
  { key: "scored", label: "Variations experimented — scored", short: "Tested" },
  { key: "elected", label: "Direction confirmed — variation elected", short: "Confirmed" },
  { key: "delivered", label: "Export-ready — deliverables generated", short: "Ready" },
];

export interface SubProgress {
  /** Cumulative fill per stage (true up to the highest reached). */
  stages: Record<SubProgressStage, boolean>;
  /** Count of filled stages, 0–5. */
  completed: number;
  /** Highest stage reached; null before anything starts. */
  current: SubProgressStage | null;
  /** Supporting counts for the tooltip. */
  counts: {
    entities: number;
    expandedEntities: number;
    scoredVariations: number;
    electedVariations: number;
    deliveredVariations: number;
  };
}

function rollUp(reached: Record<SubProgressStage, boolean>): {
  stages: Record<SubProgressStage, boolean>;
  completed: number;
  current: SubProgressStage | null;
} {
  let maxIdx = -1;
  SUB_PROGRESS_STAGES.forEach((s, i) => {
    if (reached[s.key]) maxIdx = i;
  });
  const stages = {
    generated: false,
    expanded: false,
    scored: false,
    elected: false,
    delivered: false,
  } as Record<SubProgressStage, boolean>;
  SUB_PROGRESS_STAGES.forEach((s, i) => {
    stages[s.key] = i <= maxIdx;
  });
  return {
    stages,
    completed: maxIdx + 1,
    current: maxIdx >= 0 ? SUB_PROGRESS_STAGES[maxIdx]!.key : null,
  };
}

/** Compute a sub-objective's pipeline progress from data already
 *  loaded on the canvas (room timestamp + its entities' expanded
 *  detail). Pure — no DB. */
export function computeSubProgress(
  generatedAt: string | null,
  entities: Array<{ expanded_detail: unknown }>,
): SubProgress {
  let expandedEntities = 0;
  let scoredVariations = 0;
  let electedVariations = 0;
  let deliveredVariations = 0;

  for (const e of entities) {
    const detail = e.expanded_detail as ExpandedItemDetail | null;
    if (!detail || typeof detail !== "object" || !Array.isArray(detail.variations)) {
      continue;
    }
    if (detail.generated_at) expandedEntities += 1;
    for (const v of detail.variations as ItemVariation[]) {
      const scored =
        typeof v.effectiveness_score === "number" &&
        Number.isFinite(v.effectiveness_score) &&
        !!v.evaluation_method;
      if (scored) scoredVariations += 1;
      const elected = v.disposition === "elected";
      if (elected) electedVariations += 1;
      if (
        elected &&
        typeof v.description_doc === "string" && v.description_doc.length > 0 &&
        typeof v.mockup_html === "string" && v.mockup_html.length > 0 &&
        typeof v.export_prompt === "string" && v.export_prompt.length > 0
      ) {
        deliveredVariations += 1;
      }
    }
  }

  const { stages, completed, current } = rollUp({
    generated: !!generatedAt,
    expanded: expandedEntities > 0,
    scored: scoredVariations > 0,
    elected: electedVariations > 0,
    delivered: deliveredVariations > 0,
  });

  return {
    stages,
    completed,
    current,
    counts: {
      entities: entities.length,
      expandedEntities,
      scoredVariations,
      electedVariations,
      deliveredVariations,
    },
  };
}

/** Lightweight builder for previews / tests — fills the first `n`
 *  stages. Real callers should use computeSubProgress. */
export function subProgressFromCompleted(n: number): SubProgress {
  const clamped = Math.max(0, Math.min(SUB_PROGRESS_STAGES.length, Math.round(n)));
  const reached = {
    generated: clamped >= 1,
    expanded: clamped >= 2,
    scored: clamped >= 3,
    elected: clamped >= 4,
    delivered: clamped >= 5,
  } as Record<SubProgressStage, boolean>;
  const { stages, completed, current } = rollUp(reached);
  return {
    stages,
    completed,
    current,
    counts: {
      entities: 0,
      expandedEntities: 0,
      scoredVariations: 0,
      electedVariations: 0,
      deliveredVariations: 0,
    },
  };
}
