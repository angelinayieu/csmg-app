// ── Spec objects from the Library — the read-side bridge (Phase 0) ────
//
// The final-spec compiler (`compile-agent-build-spec.ts`) today scans
// `entities.expanded_detail.variations` for `disposition === "elected"`.
// This helper returns the SAME intent from the curation layer instead: the
// objects the user has marked `included_in_spec`, each with a STABLE id +
// a real blueprint-layer slot (which the blob path lacks — the diagnosis
// found features resolve to an empty layer string today).
//
// New file BY DESIGN — the compiler adopts it with a ONE-LINE swap when its
// owner is ready; no contested edit now. Soft-fail → [] so it never breaks
// the compiler if the table is empty / pre-migration.

import { listLibraryObjects } from "./library-objects";
import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface SpecObject {
  id: string;
  objectType: string;
  title: string;
  /** The blueprint layer the object sits at (null = unassigned). The thing
   *  the blob path can't give the spec today. */
  blueprintLayerOrdinal: number | null;
  /** Back-references — let the spec trace each section to its origin. */
  sourceEntityId: string | null;
  sourceRef: string | null;
  sourceSubObjectiveId: string | null;
  rankScore: number | null;
}

/**
 * The curated, in-spec objects the final spec should assemble from —
 * id-stable + layer-tagged. Drop-in replacement for the elected-variation
 * blob scan in the compiler.
 */
export async function getSpecObjects(
  db: AnyDb,
  spaceId: string,
): Promise<SpecObject[]> {
  const rows = await listLibraryObjects(db, spaceId, { includedInSpec: true });
  return rows.map((r) => ({
    id: r.id,
    objectType: r.object_type,
    title: r.title,
    blueprintLayerOrdinal: r.blueprint_layer_ordinal,
    sourceEntityId: r.source_entity_id,
    sourceRef: r.source_ref,
    sourceSubObjectiveId: r.source_sub_objective_id,
    rankScore: r.rank_score,
  }));
}

/**
 * Same, grouped by blueprint-layer ordinal (null bucketed at 0) — for the
 * §7/§8 layer-driven assembly + swap (each layer's selected objects in one
 * place, so removing/swapping one regenerates that layer's spec section).
 */
export async function getSpecObjectsByLayer(
  db: AnyDb,
  spaceId: string,
): Promise<Map<number, SpecObject[]>> {
  const objs = await getSpecObjects(db, spaceId);
  const byLayer = new Map<number, SpecObject[]>();
  for (const o of objs) {
    const key = o.blueprintLayerOrdinal ?? 0;
    const bucket = byLayer.get(key);
    if (bucket) bucket.push(o);
    else byLayer.set(key, [o]);
  }
  return byLayer;
}
