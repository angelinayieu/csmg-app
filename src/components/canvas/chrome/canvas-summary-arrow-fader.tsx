"use client";

// ── Canvas summary-arrow fader ──
//
// Connector arrows produced by Lasso → Summarize are tagged with
// `meta.summarySourceFor: <summaryId>` at creation time. To match the
// Miro-style "fork" pattern the arrows should:
//   - dim to ~35% opacity when the owning summary card isn't selected
//   - return to 100% when the user selects the summary card (or any of
//     its source shapes)
//
// We do this imperatively (`editor.updateShapes`) rather than via CSS
// because tldraw doesn't expose per-shape data attributes on the DOM.
// The cost is small: opacity updates on ≤ N arrows per summary card
// per selection change. Most users have ≤ 5 summary cards on a page.

import { useEffect } from "react";
import { useEditor, useValue } from "tldraw";
import type { TLShapeId } from "tldraw";

const FADED_OPACITY = 0.35;
const ACTIVE_OPACITY = 1;

// Local helpers to read meta/props off shapes without fighting the
// tldraw discriminated-union narrowing — we only care about a couple
// of fields, all checked at runtime before use.
type AnyShape = {
  id: TLShapeId;
  type: string;
  opacity?: number;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export function CanvasSummaryArrowFader() {
  const editor = useEditor();

  // Reactive selection — re-fires this effect whenever the user
  // selects/deselects shapes. We don't depend on shape props (only
  // ids) because the arrow fade only depends on which summary cards
  // are currently selected, not on their content.
  const selectedIds = useValue<TLShapeId[]>(
    "lasso-summary-fader-selected",
    () => editor?.getSelectedShapeIds() ?? [],
    [editor],
  );

  useEffect(() => {
    if (!editor) return;

    // Build the set of summary IDs whose owning card (or one of its
    // source shapes) is currently selected. Selecting a source shape
    // also "wakes" the arrows pointing at the related summary so the
    // user sees the connection in both directions.
    const activeSummaryIds = new Set<string>();
    const sourceShapeToSummaryIds = new Map<string, Set<string>>();

    // First pass — gather every summary card's source map
    for (const shape of editor.getCurrentPageShapes() as unknown as AnyShape[]) {
      if (shape.type !== "summary-card") continue;
      const sid = shape.props.summaryId;
      if (typeof sid !== "string" || !sid) continue;
      const sources = Array.isArray(shape.props.sourceShapeIds)
        ? (shape.props.sourceShapeIds as string[])
        : [];
      for (const src of sources) {
        const set = sourceShapeToSummaryIds.get(src) ?? new Set<string>();
        set.add(sid);
        sourceShapeToSummaryIds.set(src, set);
      }
    }

    // Second pass — selection
    for (const sid of selectedIds) {
      const shape = editor.getShape(sid) as unknown as AnyShape | undefined;
      if (!shape) continue;
      if (shape.type === "summary-card") {
        const summaryId = shape.props.summaryId;
        if (typeof summaryId === "string" && summaryId) {
          activeSummaryIds.add(summaryId);
        }
      }
      const linked = sourceShapeToSummaryIds.get(sid);
      if (linked) {
        for (const id of linked) activeSummaryIds.add(id);
      }
    }

    // Apply opacity to arrows. Tldraw's updateShapes is batched, so a
    // single call covers N arrows.
    const updates: Array<{
      id: TLShapeId;
      type: "arrow";
      opacity: number;
    }> = [];
    for (const shape of editor.getCurrentPageShapes() as unknown as AnyShape[]) {
      if (shape.type !== "arrow") continue;
      const summaryId = shape.meta.summarySourceFor;
      if (typeof summaryId !== "string" || !summaryId) continue;
      const desired = activeSummaryIds.has(summaryId)
        ? ACTIVE_OPACITY
        : FADED_OPACITY;
      if (Math.abs((shape.opacity ?? 1) - desired) > 0.01) {
        updates.push({ id: shape.id, type: "arrow", opacity: desired });
      }
    }
    if (updates.length > 0) {
      // Skip history so the undo/redo stack isn't polluted by these
      // cosmetic-only opacity flips.
      editor.run(
        () => {
          editor.updateShapes(updates);
        },
        { history: "ignore" },
      );
    }
  }, [editor, selectedIds]);

  return null;
}
