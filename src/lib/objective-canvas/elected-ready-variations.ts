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
