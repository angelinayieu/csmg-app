// Camera orchestration extracted from pipeline-event-painter.tsx.
//
// fitViewportToUnfurl is the painter's only programmatic camera mover
// during a live run. It collects every shape the painter is actively
// managing and zooms the viewport to fit them with a 600ms animated
// sweep — debounced so a burst of stage_boundary events coalesces
// into one fit instead of fighting itself.
//
// CRITICAL guard rails (do not remove without understanding why they
// were added — both prevent the "shapes disappear when I pan" bug):
//   1. Bails synchronously if the user is currently pointing
//      (editor.inputs.isPointing). The 60ms poll detector flips
//      followCamera off shortly after a pan starts, but a fit queued
//      in the gap would yank the camera mid-pan.
//   2. MAX_FIT_DIMENSION cap. zoomToBounds called with a runaway
//      bounds union (stale shape ids across multiple anchors, leftover
//      state from a prior run) zooms the user out so far every shape
//      becomes sub-pixel — the canvas reads as blank.

import type { Editor, TLShapeId } from "tldraw";
import type { PainterState } from "./painter-state";

// Camera-fit bounds sanity cap. zoomToBounds called with bounds wider
// than the user's viewport zooms out proportionally — at ~50000px
// that's roughly 3% zoom, every shape sub-pixel, canvas reads as
// blank. This cap protects against stale state (leftover shape ids
// from a prior run, anchor never reset, etc.) accidentally vanishing
// the user's view. If your real graph genuinely needs more than this,
// raise the constant; don't remove the check.
export const MAX_FIT_DIMENSION = 50000;

export function fitViewportToUnfurl(editor: Editor, state: PainterState) {
  // Sprint B.5 — if the user has opted out of follow mode (by panning/
  // zooming mid-run), respect that. They'll re-enter via the "Follow
  // downstream" chip, which calls this with state.followCamera=true
  // and an explicit camera snapshot reset below.
  if (!state.followCamera) return;
  // Synchronous pan-respect: if the user is actively pointing right now
  // (mid-pan, mid-drag), skip even scheduling a fit. The 60ms poll
  // detector below will flip followCamera off shortly, but any fit
  // queued before that flip would yank the camera while the user is
  // still touching the canvas.
  if (editor.inputs.isPointing) return;
  if (state.cameraFitTimer !== null) {
    clearTimeout(state.cameraFitTimer);
  }
  state.cameraFitTimer = setTimeout(() => {
    state.cameraFitTimer = null;
    // Re-check follow here too — the 120ms debounce window could
    // include a user pan that just flipped us out of follow mode.
    if (!state.followCamera) return;
    if (editor.inputs.isPointing) return;
    const shapeIds: TLShapeId[] = [
      ...state.ghostsByEntity.values(),
      ...state.proposalsById.values(),
      ...state.chainRibbonsByProposal.values(),
      ...(state.originPromptShapeId ? [state.originPromptShapeId] : []),
      ...state.spaceShellShapeIds.values(),
      ...(state.kgFormationShapeId ? [state.kgFormationShapeId] : []),
      ...(state.taxonomyCardShapeId ? [state.taxonomyCardShapeId] : []),
      ...(state.rootCauseTreeShapeId ? [state.rootCauseTreeShapeId] : []),
      ...state.variantCardShapeIds.values(),
      // Sprint B — include the row-banded Sprint A shapes so
      // stage_boundary re-fits sweep downward through the
      // narrative as app-result / iv-decomp / carousel / stages land.
      ...state.appResultShapesByAppId.values(),
      ...(state.ivDecompositionShapeId ? [state.ivDecompositionShapeId] : []),
      ...(state.variantCarouselShapeId ? [state.variantCarouselShapeId] : []),
      ...state.stageNodeShapesByKey.values(),
    ];
    if (shapeIds.length === 0) return;
    // Union all shape bounds. getShapePageBounds returns null for
    // shapes that were deleted mid-flight; filter those out.
    const boundsList = shapeIds
      .map((id) => editor.getShapePageBounds(id))
      .filter((b): b is NonNullable<typeof b> => b !== null);
    if (boundsList.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boundsList) {
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    // Pad generously so edges don't clip against the viewport border
    // and so the next batch of shapes has room to appear in-frame.
    const PAD = 160;
    const bounds = {
      x: minX - PAD,
      y: minY - PAD,
      w: maxX - minX + PAD * 2,
      h: maxY - minY + PAD * 2,
    };
    // Sanity cap — if the bounds union has runaway dimensions (stale
    // shape entries pointing across multiple anchors, leftover state
    // from a previous run, etc.), zoomToBounds would zoom the user
    // out to ~3% so every shape is sub-pixel and the canvas reads as
    // empty. Bail rather than vanish the user's view.
    if (bounds.w > MAX_FIT_DIMENSION || bounds.h > MAX_FIT_DIMENSION) {
      console.warn(
        `[pipeline-painter] skipping fit — bounds ${Math.round(bounds.w)}×${Math.round(bounds.h)} exceeds cap ${MAX_FIT_DIMENSION}`,
      );
      return;
    }
    try {
      // Mark the next 700ms as programmatic (600ms anim + 100ms slack)
      // so the user-pan detector below doesn't mistake our own
      // animated camera frames for user input. Without this, every
      // fit would immediately flip followCamera back off.
      state.programmaticCameraUntil = Date.now() + 700;
      editor.zoomToBounds(bounds, {
        animation: { duration: 600 },
        inset: 40,
      });
      // Snapshot the target camera AFTER the animation completes so
      // the detector's next tick doesn't see the post-animation
      // camera as "user moved it".
      setTimeout(() => {
        try {
          state.lastSeenCamera = editor.getCamera();
        } catch {
          /* editor may be disposed between ticks; ignore */
        }
      }, 750);
    } catch (err) {
      console.warn("[pipeline-painter] camera fit failed:", err);
    }
  }, 120);
}
