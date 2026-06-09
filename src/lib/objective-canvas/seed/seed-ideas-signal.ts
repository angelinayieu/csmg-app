// ── Seed ideas signal ────────────────────────────────────────────────
//
// Opens the ranked idea-field panel for an objective. Fired from the objective
// card ("⚖ Rank my ideas"). Kept out of board-bus.ts (co-edited) to avoid
// clobber. CLIENT-ONLY (guards window).

export const OPEN_SEED_IDEAS_EVENT = "objective-seed:open-ideas";

export interface OpenSeedIdeasDetail {
  spaceId: string;
}

/** Fire from the objective card to open the idea-field panel. */
export function openSeedIdeas(spaceId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SEED_IDEAS_EVENT, { detail: { spaceId } }));
}

/** Subscribe (the mount). Returns an unsubscribe. */
export function onOpenSeedIdeas(cb: (spaceId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const id = (e as CustomEvent<OpenSeedIdeasDetail>).detail?.spaceId;
    if (id) cb(id);
  };
  window.addEventListener(OPEN_SEED_IDEAS_EVENT, handler);
  return () => window.removeEventListener(OPEN_SEED_IDEAS_EVENT, handler);
}
