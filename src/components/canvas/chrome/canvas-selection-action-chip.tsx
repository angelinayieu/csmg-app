"use client";

// ── Canvas selection-aware action chip ─────────────────────────────
//
// When the user selects a single shape that carries an entity_id,
// surface CardActionMenu (Decompose / Connect / Research / Probe /
// Related) as a small floating chip near the shape's top-right
// corner. This is the GLOBAL mount point for the menu and exists
// because the post-redesign default keeps kg-node shapes off the
// canvas (PAINT_GLOBAL_GHOST_KG_NODES = false in canvas-feature-
// flags.ts) — without a global affordance, the entire power-
// function surface (Decompose, Research, Probe, Related, Connect)
// has no entry point on most shapes.
//
// Recognized shapes:
//   • sticky-note   — entityId optional; chip hides when null
//   • stage-node    — entityId optional; chip hides when null
//
// kg-node is INTENTIONALLY excluded: kg-node-shape already mounts
// CardActionMenu in-shape (hover-triggered). Mounting a second
// instance here would create two CardActionMenu objects for the
// same entityId; both would receive the connect-mode pendingPick
// event and both would try to open the bridge-draft modal. The
// in-shape menu wins on kg-node; this chip handles everything else.
//
// Probability-space-shell mini-graph nodes are internal to the
// shell and not separately selectable in tldraw — supporting them
// would require the shell to emit per-mini-node selection events.
// Out of scope here; documented as a follow-up.

import type { Editor } from "tldraw";
import { useEditor, useValue } from "tldraw";
import { CardActionMenu } from "../card-action-menu";

interface ResolvedSelection {
  entityId: string;
  entityName: string;
  isHero: boolean;
  screenX: number;
  screenY: number;
}

// Pull (entityId, name, isHero) off a recognized shape. Returns null
// for shapes the chip doesn't handle or for entity-optional shapes
// whose entityId is currently null. Shape `props` are accessed via
// any-cast because tldraw's per-type narrowing requires a switch on
// the literal type union, which we do anyway.
function readEntityRef(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape: any,
): { id: string; name: string; isHero: boolean } | null {
  if (!shape) return null;
  switch (shape.type) {
    case "sticky-note": {
      const id: string | null = shape.props?.entityId ?? null;
      if (!id) return null;
      const text: string = shape.props?.text ?? "";
      return { id, name: text.slice(0, 80) || "Note", isHero: false };
    }
    case "stage-node": {
      const id: string | null = shape.props?.entityId ?? null;
      if (!id) return null;
      const title: string = shape.props?.title ?? "";
      return { id, name: title || "Stage", isHero: false };
    }
    default:
      return null;
  }
}

function resolveSelection(editor: Editor): ResolvedSelection | null {
  const ids = editor.getSelectedShapeIds();
  if (ids.length !== 1) return null;

  const shape = editor.getShape(ids[0]);
  const ref = readEntityRef(shape);
  if (!ref || !shape) return null;

  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return null;

  const anchor = editor.pageToScreen({ x: bounds.maxX, y: bounds.minY });
  return {
    entityId: ref.id,
    entityName: ref.name,
    isHero: ref.isHero,
    screenX: anchor.x,
    screenY: anchor.y,
  };
}

export function CanvasSelectionActionChip() {
  const editor = useEditor();
  const resolved = useValue<ResolvedSelection | null>(
    "canvas-selection-action-chip",
    () => (editor ? resolveSelection(editor) : null),
    [editor],
  );

  if (!resolved) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: resolved.screenX + 8,
        top: resolved.screenY - 4,
        zIndex: 30,
        pointerEvents: "auto",
      }}
    >
      <CardActionMenu
        entityId={resolved.entityId}
        entityName={resolved.entityName}
        isHero={resolved.isHero}
      />
    </div>
  );
}
