// ── flow-connector-board — create + keep-synced the REAL flow connectors ──
//
// The flow-connector shape renders the wire; this module makes it BEHAVE like a
// real bound connector without a custom tldraw BindingUtil (which would mean
// editing the hot whiteboard-base + board-history to pass `bindingUtils`):
//   • deployFlowConnector — create a wire between two shapes, sent behind them.
//   • syncFlowConnectors  — recompute every wire's geometry from its endpoints;
//                           delete wires whose endpoint vanished.
//   • registerFlowConnectorReactor — a board store listener that re-syncs on any
//                           card move, so the wire MOVES with the cards.
//
// Idempotent geometry updates (only write when changed) → the reactor can't loop.

import { type Editor, type TLShapeId, createShapeId } from "tldraw";
import type { FlowConnectorShape } from "../shapes/flow-connector-shape";

const PAD = 10;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function bbox(a: Bounds | undefined, b: Bounds | undefined) {
  if (!a || !b) return null;
  const minX = Math.min(a.minX, b.minX) - PAD;
  const minY = Math.min(a.minY, b.minY) - PAD;
  const maxX = Math.max(a.maxX, b.maxX) + PAD;
  const maxY = Math.max(a.maxY, b.maxY) + PAD;
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

/** Create a REAL flow-connector between two shapes, sent behind the cards.
 *  Returns the new shape id, or null if either endpoint isn't on the board. */
export function deployFlowConnector(
  editor: Editor,
  fromId: string,
  toId: string,
  color = "#34d399",
): TLShapeId | null {
  try {
    const g = bbox(
      editor.getShapePageBounds(fromId as TLShapeId),
      editor.getShapePageBounds(toId as TLShapeId),
    );
    if (!g) return null;
    const id = createShapeId();
    editor.createShape<FlowConnectorShape>({
      id,
      type: "flow-connector",
      x: g.x,
      y: g.y,
      props: { w: g.w, h: g.h, fromId, toId, color },
    });
    editor.sendToBack([id]);
    return id;
  } catch {
    return null;
  }
}

/** Recompute every flow-connector's geometry to span its endpoints; delete any
 *  whose endpoint vanished. Only writes when geometry actually changed. */
export function syncFlowConnectors(editor: Editor): void {
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== "flow-connector") continue;
    const c = s as FlowConnectorShape;
    const g = bbox(
      editor.getShapePageBounds(c.props.fromId as TLShapeId),
      editor.getShapePageBounds(c.props.toId as TLShapeId),
    );
    if (!g) {
      editor.deleteShapes([c.id]);
      continue;
    }
    if (
      Math.abs(g.x - c.x) > 0.5 ||
      Math.abs(g.y - c.y) > 0.5 ||
      Math.abs(g.w - c.props.w) > 0.5 ||
      Math.abs(g.h - c.props.h) > 0.5
    ) {
      editor.updateShape<FlowConnectorShape>({
        id: c.id,
        type: "flow-connector",
        x: g.x,
        y: g.y,
        props: { w: g.w, h: g.h },
      });
    }
  }
}

/** Ensure a REAL flow-connector exists for every sharpening-fork relationship —
 *  replacing the old SVG overlay so ALL these wires get the green/pink ports +
 *  gradient look AND move with the cards:
 *    objective-card → prompt-sharpening · prompt-sharpening → heatmap / priority
 *    (by their `sourceId` prop) · fork source → insight-card (by meta.forkSourceId).
 *  Idempotent — only creates a wire that doesn't already exist. */
export function ensureSharpeningFlowConnectors(editor: Editor): void {
  const shapes = editor.getCurrentPageShapes();
  const existing = new Set<string>();
  for (const s of shapes) {
    if (s.type === "flow-connector") {
      const c = s as FlowConnectorShape;
      existing.add(`${c.props.fromId}>${c.props.toId}`);
    }
  }
  const ensure = (fromId: string | null | undefined, toId: string) => {
    if (!fromId || existing.has(`${fromId}>${toId}`)) return;
    if (
      !editor.getShape(fromId as TLShapeId) ||
      !editor.getShape(toId as TLShapeId)
    )
      return;
    deployFlowConnector(editor, fromId, toId);
    existing.add(`${fromId}>${toId}`);
  };

  // objective → sharpening
  const objId =
    shapes.find((s) => s.type === "objective-card")?.id ??
    shapes.find(
      (s) =>
        s.type === "room-card" &&
        (s.props as { roomId?: string }).roomId === "__obj",
    )?.id ??
    null;
  const sharp = shapes.find((s) => s.type === "prompt-sharpening");
  if (objId && sharp) ensure(objId, sharp.id);

  // sharpening → heatmap / priority (sourceId prop) · fork → insight (meta) ·
  // heatmap + priority → resolve-pill (the merge point of the two-way fork).
  for (const s of shapes) {
    if (s.type === "ambiguity-heatmap-card" || s.type === "priority-map-card") {
      ensure((s.props as { sourceId?: string }).sourceId, s.id);
    } else if (s.type === "insight-card") {
      ensure((s.meta as { forkSourceId?: string })?.forkSourceId, s.id);
    } else if (s.type === "resolve-pill") {
      // Both forked cards converge DOWN into the pill — a downward "root" merge.
      const srcIds = String((s.props as { sourceIds?: string }).sourceIds || "")
        .split(",")
        .filter(Boolean);
      for (const from of srcIds) ensure(from, s.id);
    }
  }
}

/** Register a board reactor that DRAWS the sharpening-fork flow-connectors and
 *  keeps every flow-connector synced as cards move. Returns a disposer.
 *  Idempotent (create-if-missing + change-only writes) → no infinite loop. */
export function registerFlowConnectorReactor(editor: Editor): () => void {
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    try {
      ensureSharpeningFlowConnectors(editor);
      syncFlowConnectors(editor);
    } catch {
      /* soft-fail — a bad pass never breaks the board */
    }
  };
  return editor.store.listen(
    () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    },
    { scope: "document", source: "user" },
  );
}
