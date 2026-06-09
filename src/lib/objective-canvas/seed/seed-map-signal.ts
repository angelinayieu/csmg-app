// ── Seed map signal ──────────────────────────────────────────────────
//
// Open the SeedMap peek (the sandboxed reasoning engine) from the objective
// card. Kept out of board-bus (co-edited). CLIENT-ONLY.

export const OPEN_SEED_MAP_EVENT = "objective-seed:open-map";

export function openSeedMap(spaceId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SEED_MAP_EVENT, { detail: { spaceId } }));
}

export function onOpenSeedMap(cb: (spaceId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const id = (e as CustomEvent<{ spaceId: string }>).detail?.spaceId;
    if (id) cb(id);
  };
  window.addEventListener(OPEN_SEED_MAP_EVENT, handler);
  return () => window.removeEventListener(OPEN_SEED_MAP_EVENT, handler);
}
