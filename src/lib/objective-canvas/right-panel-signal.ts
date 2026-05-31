// ── Right-edge panel presence signal ───────────────────────────────
//
// The Lab Notebook's collapsed "Notebook" pill lives in the objective
// LAYOUT (app/objective/[spaceId]/layout.tsx), anchored to the top-right
// corner. The room's right-edge detail drawers (ItemDetailDrawer, and
// any sibling that slides in from the right) live in the routed PAGE and
// anchor to the SAME corner. When a drawer is open it should own that
// corner — the pill must get out of the way.
//
// Layout and page are separate React trees that share only the URL, so
// they coordinate through a module-level ref count + a window event —
// the same singleton-plus-event hand-off pattern as notebook-focus.ts.
// Ref-counted (not a boolean) so overlapping panels and a panel that
// unmounts without an explicit close both resolve correctly: the pill
// reappears only when the LAST open panel releases.

const EVENT = "objective:right-panel";

let openCount = 0;

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { open: openCount > 0 } }),
  );
}

/** Mark a right-edge panel as open. Returns a release fn (idempotent)
 *  to call when the panel closes/unmounts. Drive it from an effect:
 *  `useEffect(() => { if (!open) return; return pushRightPanel(); }, [open])`
 *  so React's cleanup releases the count on close AND on unmount. */
export function pushRightPanel(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

/** Current presence — used for the initial render before the first
 *  event lands (module state survives client nav, so a panel opened
 *  before the layout subscribes is still reflected). */
export function isRightPanelOpen(): boolean {
  return openCount > 0;
}

/** Subscribe to presence changes. Returns an unsubscribe fn. */
export function onRightPanelChange(
  handler: (open: boolean) => void,
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<{ open: boolean }>).detail.open);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
