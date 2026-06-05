"use client";

// ── MinimalObjectiveRedirect ──
//
// Renders as the page body for /app/objective/[id] in minimal mode. The
// surface the user actually sees is the whiteboard floor + objective card
// (shell + PromptSharpeningMount), so this component is a no-op placeholder.
//
// IMPORTANT — do NOT auto-redirect to ?full=1 here. ?full=1 mounts the
// deprecated legacy canvas (MainCanvasView + sub-objective picker), retired
// per project_old_build_deprecation. An earlier version of this component
// fired `window.location.assign(?full=1)` from a useEffect, which meant any
// brief race that opened the room window on the objective root (eg. ⌘↑ from
// a sub room: navTo(0) sets collapsed=false then router.push) immediately
// flipped the user into the retired legacy UI. The shell's pathname effect
// re-collapses the window on its own; rendering null is enough.
//
// ?full=1 is still reachable by manually appending it to the URL — the
// intentional escape hatch into the legacy canvas.

export function MinimalObjectiveRedirect() {
  return null;
}
