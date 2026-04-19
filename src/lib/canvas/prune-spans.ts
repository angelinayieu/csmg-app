/**
 * Sprint 0 debt — on canvas autosave (PATCH /api/canvases/:id with snapshot),
 * we need to mark note_entity_spans whose note_id no longer exists in the
 * snapshot as 'stale'. Otherwise the ProposalRail (Sprint 3) would try to
 * highlight spans in notes that the user deleted.
 *
 * This module:
 *   1. Extracts the set of sticky-note shape ids from a tldraw snapshot.
 *   2. Walks note_entity_spans for the canvas and flips orphans to 'stale'.
 *
 * The canvas-editor (tldraw) persists every shape under
 * snapshot.store[shape_key] where shape_key looks like "shape:abc123" and
 * each shape record carries { id, type, props, ... }. Sticky notes use
 * type === "note" (or a custom "kg-note" / "sticky-note" type — we match
 * the family defensively). Any shape whose id is in use is considered
 * live regardless of type, because a span can in principle anchor to a
 * text field on any shape.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/**
 * Pull every shape id out of a tldraw document snapshot. Defensive to
 * schema drift — the snapshot shape may change across tldraw versions.
 * Returns an empty set if the snapshot is missing or malformed.
 */
export function extractShapeIdsFromSnapshot(snapshot: unknown): Set<string> {
  const ids = new Set<string>();
  if (!snapshot || typeof snapshot !== "object") return ids;

  // tldraw stores records under snapshot.store (or snapshot.document.store
  // in some versions). We walk both.
  const roots: Array<Record<string, unknown>> = [];
  const snap = snapshot as Record<string, unknown>;
  if (snap.store && typeof snap.store === "object") {
    roots.push(snap.store as Record<string, unknown>);
  }
  const doc = snap.document;
  if (
    doc &&
    typeof doc === "object" &&
    (doc as Record<string, unknown>).store &&
    typeof (doc as Record<string, unknown>).store === "object"
  ) {
    roots.push((doc as Record<string, unknown>).store as Record<string, unknown>);
  }

  for (const store of roots) {
    for (const key of Object.keys(store)) {
      // tldraw record keys are typically "shape:<id>". We match any
      // record whose key starts with "shape:" — that's what a span's
      // note_id stores.
      if (!key.startsWith("shape:")) continue;
      const rec = store[key];
      if (rec && typeof rec === "object") {
        const recId = (rec as Record<string, unknown>).id;
        if (typeof recId === "string") {
          ids.add(recId);
        } else {
          // Fall back to the key itself
          ids.add(key);
        }
      }
    }
  }
  return ids;
}

/**
 * After a snapshot write for a canvas, mark any note_entity_spans whose
 * note_id is no longer present in the snapshot as 'stale'. Idempotent —
 * re-running it on an unchanged snapshot is a no-op.
 *
 * Returns the number of spans marked stale (for logging/metrics).
 */
export async function pruneOrphanSpans(
  db: AnyDb,
  canvasId: string,
  snapshot: unknown,
): Promise<number> {
  const liveIds = extractShapeIdsFromSnapshot(snapshot);

  // Pull all active spans on this canvas so we can compute the diff.
  // An active span is status in ('proposed','accepted').
  const { data: spans } = (await db
    .from("note_entity_spans")
    .select("id, note_id, status")
    .eq("canvas_id", canvasId)
    .in("status", ["proposed", "accepted"])) as {
    data: Array<{ id: string; note_id: string; status: string }> | null;
  };

  const orphanIds = (spans ?? [])
    .filter((s) => !liveIds.has(s.note_id))
    .map((s) => s.id);

  if (orphanIds.length === 0) return 0;

  const { error } = await db
    .from("note_entity_spans")
    .update({ status: "stale" })
    .in("id", orphanIds);

  if (error) {
    console.warn("[pruneOrphanSpans] update failed:", error);
    return 0;
  }

  // Also mark matching pending proposals superseded so the ProposalRail
  // doesn't show proposals pointing at dead spans.
  try {
    await db
      .from("concept_proposals")
      .update({ status: "superseded" })
      .eq("canvas_id", canvasId)
      .eq("status", "pending")
      .in("span_id", orphanIds);
  } catch (err) {
    console.warn(
      "[pruneOrphanSpans] proposal supersede failed (non-fatal):",
      err,
    );
  }

  return orphanIds.length;
}
