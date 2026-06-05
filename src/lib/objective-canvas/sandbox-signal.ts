// ── Sandbox open-signal ───────────────────────────────────────────
//
// A tiny window-event bridge so the board's "New sandbox" button can open
// the floating SandboxPanel without a hard import cycle — and WITHOUT
// touching the collision-hot board-bus.ts. Mirrors the board-bus pattern
// (event name + typed dispatcher), scoped to this one feature.

export const OPEN_SANDBOX_EVENT = "oc:open-sandbox";

export interface OpenSandboxDetail {
  /** The sandbox child space to embed in the panel. */
  sandboxId: string;
  /** The parent objective that owns it — the panel keys its per-board
   *  geometry + open-state off this, and ignores events for other boards. */
  parentSpaceId: string;
}

/** Fire from the board chrome to pop the floating sandbox whiteboard open. */
export function openSandbox(detail: OpenSandboxDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenSandboxDetail>(OPEN_SANDBOX_EVENT, { detail }),
  );
}
