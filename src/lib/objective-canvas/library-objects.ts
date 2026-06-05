// ── Library Objects — the object-flow curation layer (Phase 0) ────────
//
// Thin helpers over the `library_objects` + `object_links` tables
// (OBJECT_FLOW_PHASE0_DATAMODEL.md + 20260908_library_objects.sql).
//
// The blob (`entities.expanded_detail`) stays the CONTENT; a library_objects
// row is the addressable HANDLE + §4 metadata + selection + the back-half
// object graph. This module is the single write/read path so every surface
// (card actions, whiteboard, library, final-spec compiler) shares one model.
//
// Every fn is SOFT-FAIL (try/catch → null/[]) so callers + imports are safe
// even before the migration is applied — they get null/[] instead of a throw.
// Creation is LAZY + IDEMPOTENT: upsert keys on the natural key
// (space_id, source_entity_id, object_type, source_ref), handling NULL parts.

import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export type LibraryObjectType =
  | "experiment"
  | "mechanism"
  | "feature"
  | "deliverable"
  | "insight"
  | "ui_idea"
  | "recommendation"
  | "variation"
  | "variable"
  | "brainstorm_cluster"
  // Context-frontier (CONTEXT_FRONTIER_PLAN.md): the per-space intake
  // context anchor + one object per extracted prior-idea/reference concept.
  | "context_anchor"
  | "context_concept";

export type SelectionStatus = "candidate" | "selected" | "rejected";

export type ObjectRelation =
  | "validates" // experiment → mechanism
  | "delivers" // deliverable → experiment
  | "depends_on" // feature → feature
  | "feeds" // → layer / spec
  | "derived_from";

export interface UpsertObjectInput {
  spaceId: string;
  userId: string;
  objectType: LibraryObjectType;
  title: string;
  summary?: string | null;
  /** The parent feature/pain/outcome entity, when applicable. */
  sourceEntityId?: string | null;
  /** The source room / IV (sub-objective). */
  sourceSubObjectiveId?: string | null;
  /** Blob-local id (variation id, prototype_brief id, …). Null for entity-level objects. */
  sourceRef?: string | null;
  contentSnapshot?: unknown;
  blueprintLayerOrdinal?: number | null;
  /** AI-refined board-card face { name, body, from_updated_at }. Set only
   *  when provided so a metadata-driven refresh doesn't clobber other cols. */
  cardFace?: unknown;
  /** Object-type-specific eval blob. For converge cards: the compression tree. */
  evaluation?: unknown;
  /** The LLM-assigned subsystem cluster ("Onboarding", "Retention Loop", …).
   *  Set only when provided so a non-decompose upsert can't clobber it. */
  subsystem?: string | null;
}

export interface LibraryObjectRow {
  id: string;
  space_id: string;
  object_type: string;
  title: string;
  summary: string | null;
  source_entity_id: string | null;
  source_sub_objective_id: string | null;
  source_ref: string | null;
  blueprint_layer_ordinal: number | null;
  rank_score: number | null;
  selection_status: string;
  included_in_spec: boolean;
  in_strategy_brief: boolean;
  on_whiteboard: boolean;
  board_shape_id: string | null;
  /** Optional JSONB blob the upserter may have stashed. Object-type
   *  specific shape — e.g. brainstorm_cluster carries
   *  { session_id, target_kind, ranking_summary, top_3:[...] } for the
   *  LibraryPanel's hover preview. Always optional + unknown so existing
   *  consumers that don't read it stay unaffected. */
  content_snapshot?: unknown;
  /** AI-refined board-card face { name, body, from_updated_at }. */
  card_face?: unknown;
  /** Object-type-specific eval blob; for converge cards, the compression tree. */
  evaluation?: unknown;
  /** The subsystem cluster this object belongs to (decompose-assigned). */
  subsystem?: string | null;
}

/** A deferred sub-objective proposal, surfaced read-only in the
 *  Library's "Deferred" category. These are NOT library_objects rows —
 *  they live in synthesis_data (the disposition route is the writer).
 *  The library read path returns them alongside `objects` so the panel
 *  can show parked ideas without duplicating them into this table. */
export interface DeferredProposalLite {
  id: string;
  title: string;
  summary: string | null;
  rationale: string | null;
}

const SELECT_COLS =
  "id, space_id, object_type, title, summary, source_entity_id, source_sub_objective_id, source_ref, blueprint_layer_ordinal, rank_score, selection_status, included_in_spec, in_strategy_brief, on_whiteboard, board_shape_id, content_snapshot, card_face, evaluation, subsystem";

/**
 * Lazy, idempotent upsert by the natural key. Re-"saving" the same blob item
 * returns the same row id (updates its metadata). Returns the object id, or
 * null on soft-fail (e.g. table not yet migrated).
 */
export async function upsertLibraryObject(
  db: AnyDb,
  input: UpsertObjectInput,
): Promise<string | null> {
  try {
    // Find an existing row on the natural key, handling NULL key parts.
    let q = db
      .from("library_objects")
      .select("id")
      .eq("space_id", input.spaceId)
      .eq("object_type", input.objectType);
    q = input.sourceEntityId
      ? q.eq("source_entity_id", input.sourceEntityId)
      : q.is("source_entity_id", null);
    q = input.sourceRef
      ? q.eq("source_ref", input.sourceRef)
      : q.is("source_ref", null);
    const { data: existing } = await q.maybeSingle();

    const patch: Record<string, unknown> = {
      title: input.title,
      summary: input.summary ?? null,
      source_sub_objective_id: input.sourceSubObjectiveId ?? null,
      content_snapshot: input.contentSnapshot ?? null,
      blueprint_layer_ordinal: input.blueprintLayerOrdinal ?? null,
      updated_at: new Date().toISOString(),
    };
    // Only set the card fields when explicitly provided, so a later
    // name/summary refresh never clobbers an existing face or converge tree.
    if (input.cardFace !== undefined) patch.card_face = input.cardFace;
    if (input.evaluation !== undefined) patch.evaluation = input.evaluation;
    if (input.subsystem !== undefined) patch.subsystem = input.subsystem ?? null;

    if (existing?.id) {
      await db.from("library_objects").update(patch).eq("id", existing.id);
      return existing.id as string;
    }

    const { data: inserted } = await db
      .from("library_objects")
      .insert({
        space_id: input.spaceId,
        user_id: input.userId,
        object_type: input.objectType,
        source_entity_id: input.sourceEntityId ?? null,
        source_ref: input.sourceRef ?? null,
        ...patch,
      })
      .select("id")
      .single();
    return (inserted as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[library-objects] upsert failed (soft):", err);
    return null;
  }
}

/** Set candidate/selected/rejected. */
export async function setSelectionStatus(
  db: AnyDb,
  objectId: string,
  status: SelectionStatus,
): Promise<void> {
  try {
    await db
      .from("library_objects")
      .update({ selection_status: status, updated_at: new Date().toISOString() })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setSelectionStatus failed (soft):", err);
  }
}

/** Toggle inclusion in the final spec — the flag the compiler reads. */
export async function setIncludedInSpec(
  db: AnyDb,
  objectId: string,
  included: boolean,
): Promise<void> {
  try {
    await db
      .from("library_objects")
      .update({ included_in_spec: included, updated_at: new Date().toISOString() })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setIncludedInSpec failed (soft):", err);
  }
}

/** Record placement on the whiteboard (the canonical shape↔object link). */
export async function setOnWhiteboard(
  db: AnyDb,
  objectId: string,
  boardShapeId: string | null,
): Promise<void> {
  try {
    await db
      .from("library_objects")
      .update({
        on_whiteboard: boardShapeId != null,
        board_shape_id: boardShapeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setOnWhiteboard failed (soft):", err);
  }
}

/** Assign / move a curation FOLDER — the `subsystem` cluster the Library
 *  groups by. This is the SAME column the decompose LLM seeds (the AI
 *  auto-folder); the user can move/rename via this write path. Pass null to
 *  unfile. Capped to 40 chars to match the decompose-assigned width. */
export async function setObjectSubsystem(
  db: AnyDb,
  objectId: string,
  subsystem: string | null,
): Promise<void> {
  try {
    const clean =
      typeof subsystem === "string" && subsystem.trim()
        ? subsystem.trim().slice(0, 40)
        : null;
    await db
      .from("library_objects")
      .update({ subsystem: clean, updated_at: new Date().toISOString() })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setObjectSubsystem failed (soft):", err);
  }
}

/** Assign / move a blueprint layer (the per-object slot — enables layer swap). */
export async function setBlueprintLayer(
  db: AnyDb,
  objectId: string,
  layerOrdinal: number | null,
): Promise<void> {
  try {
    await db
      .from("library_objects")
      .update({ blueprint_layer_ordinal: layerOrdinal, updated_at: new Date().toISOString() })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setBlueprintLayer failed (soft):", err);
  }
}

export interface ListFilter {
  objectType?: LibraryObjectType;
  selectionStatus?: SelectionStatus;
  includedInSpec?: boolean;
  blueprintLayerOrdinal?: number;
}

/** List a space's objects, optionally filtered (the Library + spec read path). */
export async function listLibraryObjects(
  db: AnyDb,
  spaceId: string,
  filter: ListFilter = {},
): Promise<LibraryObjectRow[]> {
  try {
    let q = db.from("library_objects").select(SELECT_COLS).eq("space_id", spaceId);
    if (filter.objectType) q = q.eq("object_type", filter.objectType);
    if (filter.selectionStatus) q = q.eq("selection_status", filter.selectionStatus);
    if (typeof filter.includedInSpec === "boolean")
      q = q.eq("included_in_spec", filter.includedInSpec);
    if (typeof filter.blueprintLayerOrdinal === "number")
      q = q.eq("blueprint_layer_ordinal", filter.blueprintLayerOrdinal);
    const { data } = await q.order("rank_score", { ascending: false, nullsFirst: false });
    return (data as LibraryObjectRow[] | null) ?? [];
  } catch (err) {
    console.warn("[library-objects] list failed (soft):", err);
    return [];
  }
}

/** Link two objects in the back-half graph (idempotent on the unique key). */
export async function linkObjects(
  db: AnyDb,
  args: {
    spaceId: string;
    fromObjectId: string;
    toObjectId: string;
    relation: ObjectRelation;
  },
): Promise<void> {
  try {
    await db.from("object_links").upsert(
      {
        space_id: args.spaceId,
        from_object_id: args.fromObjectId,
        to_object_id: args.toObjectId,
        relation: args.relation,
      },
      { onConflict: "from_object_id,to_object_id,relation" },
    );
  } catch (err) {
    console.warn("[library-objects] linkObjects failed (soft):", err);
  }
}

/** Fetch a single object by id (the card-detail / refine read path). */
export async function getLibraryObject(
  db: AnyDb,
  objectId: string,
): Promise<LibraryObjectRow | null> {
  try {
    const { data } = await db
      .from("library_objects")
      .select(SELECT_COLS)
      .eq("id", objectId)
      .maybeSingle();
    return (data as LibraryObjectRow | null) ?? null;
  } catch (err) {
    console.warn("[library-objects] getLibraryObject failed (soft):", err);
    return null;
  }
}

/** Write the AI-refined card face ({ name, body, from_updated_at }). */
export async function setCardFace(
  db: AnyDb,
  objectId: string,
  face: { name: string; body: string; from_updated_at: string },
): Promise<void> {
  try {
    await db
      .from("library_objects")
      .update({ card_face: face, updated_at: new Date().toISOString() })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] setCardFace failed (soft):", err);
  }
}

/** Shallow-MERGE a patch into the object's `content_snapshot` (never
 *  overwrite the whole blob — the metadata gallery + converge tree
 *  accrete over time). */
export async function mergeObjectContentSnapshot(
  db: AnyDb,
  objectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { data } = await db
      .from("library_objects")
      .select("content_snapshot")
      .eq("id", objectId)
      .maybeSingle();
    const current =
      data?.content_snapshot && typeof data.content_snapshot === "object"
        ? (data.content_snapshot as Record<string, unknown>)
        : {};
    await db
      .from("library_objects")
      .update({
        content_snapshot: { ...current, ...patch },
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId);
  } catch (err) {
    console.warn("[library-objects] mergeObjectContentSnapshot failed (soft):", err);
  }
}
