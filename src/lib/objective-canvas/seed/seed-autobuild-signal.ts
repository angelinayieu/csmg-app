// ── Seed auto-build signal ───────────────────────────────────────────
//
// "Build it for me." The objective card (or chat) fires this; SeedMount runs the
// Crucible to convergence WITHOUT asking the founder — auto-resolving each open
// question via best-of-N → rank → pick — then enriches the seed. Kept out of
// board-bus.ts (co-edited) to avoid clobber. CLIENT-ONLY (guards window).

export const START_SEED_AUTOBUILD_EVENT = "objective-seed:autobuild";

export interface StartSeedAutoBuildDetail {
  spaceId: string;
}

/** Fire to kick off autonomous build for this objective. */
export function startSeedAutoBuild(spaceId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(START_SEED_AUTOBUILD_EVENT, { detail: { spaceId } }));
}

/** Subscribe (SeedMount). Returns an unsubscribe. */
export function onStartSeedAutoBuild(cb: (spaceId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const id = (e as CustomEvent<StartSeedAutoBuildDetail>).detail?.spaceId;
    if (id) cb(id);
  };
  window.addEventListener(START_SEED_AUTOBUILD_EVENT, handler);
  return () => window.removeEventListener(START_SEED_AUTOBUILD_EVENT, handler);
}
