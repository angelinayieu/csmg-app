// ── Seed chat signal ─────────────────────────────────────────────────
//
// Tiny event bus so the objective card can open the SeedChat panel without a
// prop drill. Kept out of board-bus.ts (co-edited by parallel sessions) to
// avoid clobber. CLIENT-ONLY (guards window).

export const OPEN_SEED_CHAT_EVENT = "objective-seed:open-chat";

export interface OpenSeedChatDetail {
  spaceId: string;
}

/** Fire from the objective card to open the chat for this space. */
export function openSeedChat(spaceId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SEED_CHAT_EVENT, { detail: { spaceId } }));
}

/** Subscribe (the mount). Returns an unsubscribe. */
export function onOpenSeedChat(cb: (spaceId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const id = (e as CustomEvent<OpenSeedChatDetail>).detail?.spaceId;
    if (id) cb(id);
  };
  window.addEventListener(OPEN_SEED_CHAT_EVENT, handler);
  return () => window.removeEventListener(OPEN_SEED_CHAT_EVENT, handler);
}
