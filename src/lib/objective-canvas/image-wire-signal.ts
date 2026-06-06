// ── image-wire-signal ──────────────────────────────────────────────
//
// Module-level signal for the image-to-concept wire interaction.
// Lets the image card initiate "wire mode" from inside its tldraw
// shape, and the board-level overlay both:
//   - draw a live cursor-tracking line from the source image
//   - listen for a click on a target oc-card to persist the link
//
// Pattern mirrors board-panel-signal: subscribe-based, no React
// context needed — both the image card (inside tldraw's shape layer)
// and the overlay (a sibling layer) can read/write without prop
// drilling.

type WireState = {
  /** ingested_files.id of the source image. null = no active wire. */
  ingestedFileId: string | null;
  /** Page-space x of the source handle (for the live preview). */
  fromX: number;
  /** Page-space y of the source handle. */
  fromY: number;
  /** Monotonic counter — bump to trigger overlay refetch (e.g. after
   *  a successful POST /link-objects). */
  refreshTick: number;
};

const state: WireState = {
  ingestedFileId: null,
  fromX: 0,
  fromY: 0,
  refreshTick: 0,
};

type Listener = (s: WireState) => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(state);
}

export function startImageWire(args: {
  ingestedFileId: string;
  fromX: number;
  fromY: number;
}): void {
  state.ingestedFileId = args.ingestedFileId;
  state.fromX = args.fromX;
  state.fromY = args.fromY;
  emit();
}

export function cancelImageWire(): void {
  if (state.ingestedFileId == null) return;
  state.ingestedFileId = null;
  emit();
}

export function bumpImageWireRefresh(): void {
  state.refreshTick += 1;
  emit();
}

export function getImageWireState(): WireState {
  return { ...state };
}

export function subscribeImageWire(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
