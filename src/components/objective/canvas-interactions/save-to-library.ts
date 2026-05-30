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
  objectType: "feature" | "insight" | "mechanism" | "deliverable";
  title: string;
  /** The source entity (feature/pain/outcome) when the card is entity-backed. */
  sourceEntityId?: string | null;
  /** The source room (sub-objective) when known. */
  sourceSubObjectiveId?: string | null;
}

export interface SaveResult {
  saved: number;
  failed: number;
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
            sourceEntityId: card.sourceEntityId ?? null,
            sourceSubObjectiveId: card.sourceSubObjectiveId ?? null,
          }),
        },
      );
      if (res.ok) saved++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { saved, failed };
}
