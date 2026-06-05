// ── Canvas interaction: Save to Library ───────────────────────────
//
// First of the ported "Synergism" canvas interactions (see
// CANVAS_INTERACTIONS_PORT_PLAN.md). Turns selected whiteboard cards into
// persistent library_objects via the shared route
// `/api/brainstorm/space/[spaceId]/library/objects` (action: "upsert").
// This is the canvas→object→Library bridge from OBJECT_FLOW_ARCHITECTURE.md:
// a placed card stops being trapped on the board and becomes a saved,
// selectable, spec-assemblable object.
//
// Pure client helper (no tldraw types) so it's testable + reusable by any
// surface that can produce SaveableCard descriptors. Soft-fails per card.

export interface SaveableCard {
  /** Maps to library_objects.object_type. */
  objectType: "feature" | "variable" | "insight" | "mechanism" | "deliverable";
  title: string;
  /** One-line summary → library_objects.summary (the card subtitle). */
  summary?: string | null;
  /** The source entity (feature/pain/outcome) when the card is entity-backed. */
  sourceEntityId?: string | null;
  /** The source room (sub-objective) when known. */
  sourceSubObjectiveId?: string | null;
  /** Blob-local unique id. REQUIRED for non-entity cards so distinct cards
   *  don't collide on the (space, type, null, null) natural key. */
  sourceRef?: string | null;
  /** Arbitrary structured payload → library_objects.content_snapshot (JSONB).
   *  Used for mechanism-step rows to stash { consumes, produces } tokens so
   *  the tech-spec read path can pick them up as interface contracts. Kept
   *  unstructured on purpose — no schema migration until consumers stabilize. */
  contentSnapshot?: Record<string, unknown> | null;
}

export interface SaveResult {
  saved: number;
  failed: number;
  /** The created/updated library_objects id per input card, in order (null on
   *  failure). Lets callers thread the objectId back onto the board shape so it
   *  opens the object detail drawer. */
  objectIds: (string | null)[];
}

/**
 * Upsert each card as a library_object. Idempotent on the server (natural
 * key), so re-saving the same card is a no-op update. Soft-fails per card —
 * one failure never blocks the rest.
 */
export async function saveCardsToLibrary(
  spaceId: string,
  cards: SaveableCard[],
): Promise<SaveResult> {
  let saved = 0;
  let failed = 0;
  const objectIds: (string | null)[] = [];
  for (const card of cards) {
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/library/objects`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "upsert",
            objectType: card.objectType,
            title: card.title,
            summary: card.summary ?? null,
            sourceEntityId: card.sourceEntityId ?? null,
            sourceSubObjectiveId: card.sourceSubObjectiveId ?? null,
            sourceRef: card.sourceRef ?? null,
            contentSnapshot: card.contentSnapshot ?? null,
          }),
        },
      );
      if (res.ok) {
        saved++;
        const j = (await res.json().catch(() => null)) as { id?: string } | null;
        objectIds.push(typeof j?.id === "string" ? j.id : null);
      } else {
        failed++;
        objectIds.push(null);
      }
    } catch {
      failed++;
      objectIds.push(null);
    }
  }
  return { saved, failed, objectIds };
}
