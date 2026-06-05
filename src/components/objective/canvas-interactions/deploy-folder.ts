// ── Deploy a Library FOLDER onto the board ────────────────────────────
//
// Materializes a folder (a `subsystem` cluster of library_objects) as a grid
// of oc-cards wrapped in a folder-labeled grouping frame. Two entry points use
// it: the rail's "Send to board" button (clear-space placement) and the board
// drop handler (placement centered on the cursor). Reuses the oc-card shape +
// reserveSpace + frameForkedGroup primitives — no new shape types, mirroring
// deployOcCards so folder cards look identical to decomposed ones.

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { OcCardShape } from "../shapes/oc-card-shape";
import type { FolderDragCard } from "./folder-drag";
import { reserveSpace } from "./placement";
import { frameForkedGroup } from "./group-frame";

const CARD_W = 248;
const CARD_H = 176;
const GAP = 28;
const GAP_BELOW = 120;
// Folder accent — matches the rail's folder dot + the detail-drawer subsystem pill.
const FOLDER_ACCENT = "#069494";

export interface DeployFolderResult {
  /** objectId → created shape id (for recording on_whiteboard / board_shape_id). */
  byObject: Map<string, TLShapeId>;
  ids: TLShapeId[];
  frameId: TLShapeId | null;
}

/**
 * Lay a folder's cards out as a compact grid + frame. When `anchorPage` (a drop
 * point in PAGE coords) is given the grid is centered there; otherwise a clear
 * region is reserved below the objective head (same baseline as deployOcCards).
 */
export function deployFolderToBoard(
  editor: Editor,
  folderName: string,
  cards: FolderDragCard[],
  opts?: { anchorPage?: { x: number; y: number } },
): DeployFolderResult {
  if (cards.length === 0) return { byObject: new Map(), ids: [], frameId: null };

  const cols = Math.min(3, Math.ceil(Math.sqrt(cards.length)));
  const rows = Math.ceil(cards.length / cols);
  const gridW = cols * CARD_W + (cols - 1) * GAP;
  const gridH = rows * CARD_H + (rows - 1) * GAP;

  let originX: number;
  let originY: number;
  if (opts?.anchorPage) {
    // Center the grid on the cursor so it lands where the user dropped.
    originX = opts.anchorPage.x - gridW / 2;
    originY = opts.anchorPage.y - gridH / 2;
  } else {
    const vp = editor.getViewportPageBounds();
    const heads = editor
      .getCurrentPageShapes()
      .filter(
        (s) =>
          s.type === "objective-card" ||
          s.type === "room-card" ||
          s.type === "prompt-sharpening",
      )
      .map((s) => editor.getShapePageBounds(s.id)?.maxY)
      .filter((v): v is number => typeof v === "number");
    const preferredTop = heads.length ? Math.max(...heads) + GAP_BELOW : vp.center.y;
    const spot = reserveSpace(
      editor,
      { w: gridW, h: gridH },
      { anchorMidX: vp.center.x, preferredTop, gap: GAP_BELOW },
    );
    originX = spot.x;
    originY = spot.y;
  }

  const byObject = new Map<string, TLShapeId>();
  const ids: TLShapeId[] = [];
  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const id = createShapeId();
    byObject.set(c.objectId, id);
    ids.push(id);
    editor.createShape<OcCardShape>({
      id,
      type: "oc-card",
      x: originX + col * (CARD_W + GAP),
      y: originY + row * (CARD_H + GAP),
      props: {
        w: CARD_W,
        h: CARD_H,
        kind: c.kind,
        name: c.name,
        body: c.body,
        objectId: c.objectId,
        metaCount: 0,
      },
    });
  });

  // Wrap in a frosted folder-tab frame tethered to the objective (frameForkedGroup
  // returns null for a single card — that's fine, a lone card needs no frame).
  const objectiveSource =
    editor.getCurrentPageShapes().find((s) => s.type === "objective-card") ??
    editor.getCurrentPageShapes().find((s) => s.type === "room-card");
  const frameId = frameForkedGroup(editor, {
    childIds: ids,
    sourceShapeId: objectiveSource?.id ?? null,
    label: folderName,
    accent: FOLDER_ACCENT,
  });

  const all = frameId ? [...ids, frameId] : ids;
  if (all.length > 0) {
    editor.select(...all);
    const bounds = editor.getSelectionPageBounds();
    if (bounds) {
      editor.zoomToBounds(bounds, { inset: 130, animation: { duration: 300 } });
    }
    editor.selectNone();
  }

  return { byObject, ids, frameId };
}
