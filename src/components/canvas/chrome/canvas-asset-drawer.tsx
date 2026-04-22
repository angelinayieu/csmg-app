// ── Legacy asset drawer module — Phase A1.5 cleanup ──
//
// The original single-class `CanvasAssetDrawer` component has been
// superseded by `canvas-asset-drawer-v2.tsx` (the universal tabbed
// catalog). The v2 drawer is now the only library UI mounted in
// `interaxis-canvas.tsx`.
//
// We keep this module as a thin shim that re-exports the two symbols
// the canvas still needs for its backwards-compat drop branch:
//   - `ENTITY_DRAG_MIME` — legacy MIME, still set alongside
//     `LIBRARY_ASSET_MIME` on entity drags for one more phase
//   - `EntityDragPayload` — legacy payload shape the drop handler
//     parses when the new MIME is absent
//
// A future phase will retire the legacy MIME entirely and collapse
// this file.

// Drag-payload JSON written to dataTransfer during a drag from the
// library. The canvas's onDrop handler recognises this MIME type and
// materializes a KG-node shape for the chosen entity at the drop
// point.
export const ENTITY_DRAG_MIME = "application/x-interaxis-entity";

export interface EntityDragPayload {
  id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  layer: string | null;
  importance: string | null;
  confidence: number | null;
  space_id: string;
}
