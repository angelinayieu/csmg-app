// ── Notebook → Card tie-back channel ───────────────────────────────
//
// The Lab Notebook lives in the objective layout; the room view that
// owns the card detail drawers lives in the routed page — two separate
// React trees that share only the URL. Routing a focus request through
// the URL would re-run the room page's `force-dynamic` server queries
// on every notebook click, so instead we hand off through a
// module-level singleton + a window event:
//
//   • same-room  — the mounted room view hears the event and reacts now
//   • cross-room — the request parks in `pending`; the destination room
//     view consumes it on mount (module state survives client nav)

// Field shape mirrors the notebook's NotebookNavigateTarget (all
// optional) so a target can be handed straight through.
export interface CardFocusRequest {
  entityId?: string | null;
  variationId?: string | null;
  subObjectiveId?: string | null;
}

const FOCUS_EVENT = "notebook:focus-card";

let pending: CardFocusRequest | null = null;

/** Fire a tie-back. Parks the request (for a cross-room hand-off the
 *  destination room consumes on mount) AND dispatches a live event (so
 *  an already-mounted same-room view reacts immediately). */
export function requestCardFocus(req: CardFocusRequest): void {
  pending = req;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: req }));
  }
}

/** Read + clear the parked request. A room view calls this on mount so a
 *  cross-room hand-off lands after navigation. Returns null when nothing
 *  is waiting. */
export function consumePendingCardFocus(): CardFocusRequest | null {
  const req = pending;
  pending = null;
  return req;
}

/** Subscribe to live focus events (the same-room hand-off). Clears the
 *  parked request too, so a later remount won't replay it. Returns an
 *  unsubscribe fn. */
export function onCardFocus(
  handler: (req: CardFocusRequest) => void,
): () => void {
  const listener = (e: Event) => {
    pending = null;
    handler((e as CustomEvent<CardFocusRequest>).detail);
  };
  window.addEventListener(FOCUS_EVENT, listener);
  return () => window.removeEventListener(FOCUS_EVENT, listener);
}
