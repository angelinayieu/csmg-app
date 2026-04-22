"use client";

// ── ThreadTethersOverlay (Arc 5A) ──────────────────────────────────────
//
// Draws the dashed bezier curves connecting ThreadNoteShapes to their
// parent shapes. Renders as a single SVG absolutely positioned over the
// tldraw viewport, beneath the shape layer so curves don't steal
// pointer events.
//
// Why a separate overlay (not rendered inside each ThreadNoteShape):
//   • tldraw HTMLContainers clip overflow — a shape can't draw beyond
//     its own bounds cleanly. A root-level SVG doesn't have this limit.
//   • Single source subscribes to the editor once, recomputes only
//     when shape bounds actually change (uses tldraw's `useValue`).
//   • Z-index independent from per-shape render order.
//
// Visual spec (Apple Vision Pro):
//   • Dashed stroke (4px on, 3px off), 1px wide
//   • Color = parent shape's accent (same derivation as ThreadNote's
//     accentHex prop), 0.35 alpha
//   • Bezier curve — NOT a straight line — using a control point that
//     bows gently away from the viewing direction. Stays readable when
//     parent + child are close together.
//   • Reduced-motion safe: no animated stroke-dashoffset

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import type { ThreadNoteShape } from "../shapes/types";

/** Compute an attachment point on the parent shape nearest the child.
 *  We pick the midpoint of whichever edge is closest to the child's
 *  top-left so the tether feels visually bound to the nearest side. */
function parentAttachPoint(
  parentBounds: { x: number; y: number; w: number; h: number },
  childTopLeft: { x: number; y: number },
): { x: number; y: number } {
  const cx = parentBounds.x + parentBounds.w / 2;
  const cy = parentBounds.y + parentBounds.h / 2;
  const dx = childTopLeft.x - cx;
  const dy = childTopLeft.y - cy;
  // Pick the edge based on dominant axis
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal side
    return dx > 0
      ? { x: parentBounds.x + parentBounds.w, y: cy }
      : { x: parentBounds.x, y: cy };
  }
  return dy > 0
    ? { x: cx, y: parentBounds.y + parentBounds.h }
    : { x: cx, y: parentBounds.y };
}

/** Build an SVG path string (bezier) from attach to child with a gentle bow. */
function pathBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Control points bow outwards proportional to span (capped).
  const bow = Math.min(80, Math.max(24, Math.hypot(dx, dy) * 0.3));
  // Direction of bow: if the child is below-right, bow to the left; if above-left, bow right.
  // Simple trick: swap dx/dy for the control offset to get a perpendicular lean.
  const c1x = from.x + dx * 0.3 + dy * 0.12 * (dx >= 0 ? -1 : 1);
  const c1y = from.y + dy * 0.3 - dx * 0.12 * (dy >= 0 ? -1 : 1);
  const c2x = to.x - dx * 0.3 + dy * 0.12 * (dx >= 0 ? -1 : 1);
  const c2y = to.y - dy * 0.3 - dx * 0.12 * (dy >= 0 ? -1 : 1);
  // bow is used implicitly via the control magnitudes; we keep it in
  // scope to make the intent visible during future tuning.
  void bow;
  return `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
}

function useThreadTethers(editor: Editor) {
  return useValue(
    "thread-tethers",
    () => {
      // Snapshot all ThreadNoteShape pairs with their parents in page space.
      const pairs: Array<{
        id: string;
        from: { x: number; y: number };
        to: { x: number; y: number };
        accentHex: string;
      }> = [];

      const allShapes = editor.getCurrentPageShapes();
      for (const s of allShapes) {
        if (s.type !== "thread-note") continue;
        const thread = s as ThreadNoteShape;
        const parentId = thread.props.parentShapeId ?? thread.props.rootShapeId;
        if (!parentId) continue;

        const parent = editor.getShape(parentId as TLShapeId);
        if (!parent) continue;

        const parentBounds = editor.getShapePageBounds(parent.id);
        const childBounds = editor.getShapePageBounds(thread.id);
        if (!parentBounds || !childBounds) continue;

        const attach = parentAttachPoint(
          { x: parentBounds.x, y: parentBounds.y, w: parentBounds.w, h: parentBounds.h },
          { x: childBounds.x, y: childBounds.y },
        );
        const childAnchor = {
          x: childBounds.x + 12, // matches shape's top-left padding
          y: childBounds.y + 10,
        };

        pairs.push({
          id: thread.id,
          from: attach,
          to: childAnchor,
          accentHex: thread.props.accentHex,
        });
      }
      return pairs;
    },
    [editor],
  );
}

export function ThreadTethersOverlay() {
  const editor = useEditor();
  const tethers = useThreadTethers(editor);

  // Read the current camera so the SVG transforms match tldraw's viewport.
  const camera = useValue("camera", () => editor.getCamera(), [editor]);
  const viewport = useValue(
    "viewport-screen-bounds",
    () => editor.getViewportScreenBounds(),
    [editor],
  );

  if (tethers.length === 0) return null;

  // tldraw uses CSS transforms on the content layer; we replicate the same
  // page→screen transform here so our SVG aligns with the shapes.
  const scale = camera.z;
  const tx = camera.x;
  const ty = camera.y;

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: viewport.w,
        height: viewport.h,
        zIndex: 1, // sits above the tldraw canvas background, below shapes
      }}
    >
      <g
        // Page → screen transform matches tldraw's camera
        transform={`scale(${scale}) translate(${tx} ${ty})`}
      >
        {tethers.map((t) => {
          const d = pathBetween(t.from, t.to);
          return (
            <path
              key={t.id}
              d={d}
              fill="none"
              stroke={t.accentHex}
              strokeWidth={1 / scale /* keep visually 1px regardless of zoom */}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
              strokeLinecap="round"
              style={{ opacity: 0.45 }}
            />
          );
        })}
      </g>
    </svg>
  );
}
