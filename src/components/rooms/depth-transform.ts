// ── Room-stack depth transform ──
//
// Pure mapping from a layer's distance-from-top (`depth`) to its visual
// transform. depth 0 = the focused top pane; higher = further back in
// the stack. The receding panes shrink, lift up so their top edge peeks
// behind the front pane, blur, and dim — Apple's "card stack receding"
// language (App Switcher / Music now-playing), done with scale+lift+blur
// rather than literal 3D so it's rock-solid cross-browser.
//
// Kept pure + standalone so the values are tweakable + testable without
// dragging in React.

export interface LayerTransform {
  scale: number;
  /** Vertical lift in px (negative = up, so the pane peeks above the front one). */
  y: number;
  blurPx: number;
  brightness: number;
  opacity: number;
}

const STEP_SCALE = 0.06;
const STEP_LIFT = 16; // px per depth
const STEP_BLUR = 3; // px per depth
const STEP_DIM = 0.03; // brightness drop per depth
const MAX_VISIBLE_DEPTH = 3; // panes deeper than this fade out entirely

export function layerTransform(depth: number): LayerTransform {
  const d = Math.max(0, depth);
  return {
    scale: Math.max(0.82, 1 - d * STEP_SCALE),
    y: -d * STEP_LIFT,
    blurPx: Math.min(8, d * STEP_BLUR),
    brightness: Math.max(0.9, 1 - d * STEP_DIM),
    opacity: d >= MAX_VISIBLE_DEPTH ? 0 : 1,
  };
}

/** The CSS `filter` string for a given depth. */
export function layerFilter(t: Pick<LayerTransform, "blurPx" | "brightness">): string {
  return `blur(${t.blurPx}px) brightness(${t.brightness})`;
}
