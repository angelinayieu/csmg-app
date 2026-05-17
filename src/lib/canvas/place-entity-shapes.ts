// ── place-entity-shapes ──
//
// Client-side helper that turns newly-created entity rows into
// kg-node tldraw shapes on the canvas. Used by the Phase 2 manual
// action surfaces (voice dock, selection popover, autopilot) so
// the entities they create are immediately VISIBLE — not just
// persisted to the DB but invisible because the pipeline-event-
// painter only listens to SSE.
//
// Three layout strategies:
//   - near_parent: place children in an arc below a parent entity
//     (mirrors use-recursive-decompose's positioning). Used by
//     Decompose, Variations.
//   - row: sequential horizontal row at a center position. Used by
//     Make-a-plan (steps).
//   - viewport_center: place in a cascade near the current viewport
//     center. Used by Voice dock (each utterance becomes a card).
//
// Returns the created shape IDs so the caller can do follow-up
// actions (animate, focus, select).

"use client";

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { KG_NODE_TIER_SIZE } from "@/components/canvas/shapes/kg-node-shape";
import type { KGNodeShape } from "@/components/canvas/shapes/types";

export interface PlaceableEntity {
  /** Entity DB row id (NOT entity_id). Used for the tldraw shape id. */
  id: string;
  /** Stable entity_id for cross-table joins. Goes into shape.props.entityId. */
  entity_id: string;
  name: string;
  description?: string | null;
  entity_category?: string | null;
  layer?: string | null;
  confidence?: number | null;
}

export type PlacementStrategy =
  | { kind: "near_parent"; parentEntityId: string }
  | { kind: "row"; centerX?: number; centerY?: number }
  | { kind: "viewport_center" };

interface PlaceOptions {
  /** When true, shapes are placed as ghost (translucent, dashed
   *  outline) — the pipeline-event-painter convention. Default false
   *  for manual actions since the user just confirmed creation by
   *  clicking the action. */
  ghost?: boolean;
  /** Optional pixel spacing override. Defaults tuned for each strategy. */
  spacing?: number;
}

const ARC_RADIUS = 220;
const ROW_SPACING = 24;
const CASCADE_OFFSET = 28;

export function placeEntitiesOnCanvas(
  editor: Editor | null,
  entities: PlaceableEntity[],
  strategy: PlacementStrategy,
  options: PlaceOptions = {},
): TLShapeId[] {
  if (!editor || entities.length === 0) return [];

  const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;
  const tier = "support" as const;
  const w = TIER_WIDTH[tier];
  const h = TIER_HEIGHT[tier];
  const ghost = options.ghost ?? false;
  const spacing = options.spacing;

  const positions = computePositions(editor, entities.length, strategy, {
    w,
    h,
    spacing,
  });
  if (positions.length === 0) return [];

  const partials = entities.map((e, i) => {
    const pos = positions[i];
    const shapeId = createShapeId(`kg-${e.id}`);
    const partial = {
      id: shapeId,
      type: "kg-node" as const,
      x: pos.x,
      y: pos.y,
      props: {
        w,
        h,
        entityId: e.entity_id,
        name: e.name,
        description: e.description ?? "",
        layer: (e.layer ?? "L2") as KGNodeShape["props"]["layer"],
        category: e.entity_category ?? "concrete",
        tier,
        weight: Math.round(((e.confidence ?? 0.7) as number) * 100),
        isLeverage: false,
        isRisk: false,
        isBottleneck: false,
        isConvergence: false,
        isGhost: ghost,
        confirmedPulse: 0,
        drillConfidence: 0,
      },
    };
    return partial;
  });

  editor.markHistoryStoppingPoint(`place-entities-${Date.now()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.createShapes(partials as any[]);
  return partials.map((p) => p.id);
}

// ── Position computation ──

function computePositions(
  editor: Editor,
  count: number,
  strategy: PlacementStrategy,
  dims: { w: number; h: number; spacing?: number },
): Array<{ x: number; y: number }> {
  switch (strategy.kind) {
    case "near_parent":
      return positionsNearParent(editor, count, strategy.parentEntityId, dims);
    case "row":
      return positionsRow(editor, count, strategy, dims);
    case "viewport_center":
      return positionsViewportCenter(editor, count, dims);
  }
}

/** Arc below the parent shape — mirrors use-recursive-decompose. */
function positionsNearParent(
  editor: Editor,
  count: number,
  parentEntityId: string,
  dims: { w: number; h: number },
): Array<{ x: number; y: number }> {
  // Find the parent's kg-node shape (created via use-sync-entities,
  // operational-seed-spawner, or a prior call to this helper).
  const parentShape = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "kg-node" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s.props as any).entityId === parentEntityId,
    );
  let parentBounds = parentShape
    ? editor.getShapePageBounds(parentShape.id)
    : null;
  if (!parentBounds) {
    // Parent shape doesn't exist on canvas yet — fall back to
    // viewport center so the children at least show somewhere
    // sensible.
    return positionsViewportCenter(editor, count, dims);
  }

  const spread = Math.min(120, 50 + count * 25); // degrees
  const startAngle = 90 - spread / 2; // 90° = straight down
  const step = count > 1 ? spread / (count - 1) : 0;
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angleDeg = startAngle + i * step;
    const rad = (angleDeg * Math.PI) / 180;
    const cx = parentBounds.midX + Math.cos(rad) * ARC_RADIUS;
    const cy = parentBounds.maxY + Math.sin(rad) * (ARC_RADIUS * 0.6) + 40;
    positions.push({ x: cx - dims.w / 2, y: cy - dims.h / 2 });
  }
  return positions;
}

/** Horizontal row centered on the viewport (or explicit center). */
function positionsRow(
  editor: Editor,
  count: number,
  strategy: { kind: "row"; centerX?: number; centerY?: number },
  dims: { w: number; h: number; spacing?: number },
): Array<{ x: number; y: number }> {
  const viewport = editor.getViewportPageBounds();
  const centerX = strategy.centerX ?? viewport.midX;
  const centerY = strategy.centerY ?? viewport.midY;
  const spacing = dims.spacing ?? ROW_SPACING;
  const totalWidth = count * dims.w + (count - 1) * spacing;
  const startX = centerX - totalWidth / 2;
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: startX + i * (dims.w + spacing),
      y: centerY - dims.h / 2,
    });
  }
  return positions;
}

/** Cascade near the current viewport center — each subsequent
 *  call lands slightly offset so cards don't fully overlap when
 *  the user dictates several utterances in a row. */
function positionsViewportCenter(
  editor: Editor,
  count: number,
  dims: { w: number; h: number },
): Array<{ x: number; y: number }> {
  const viewport = editor.getViewportPageBounds();
  // Slight randomized offset so successive voice utterances don't
  // pile on the same spot. Deterministic per call via the count
  // signature.
  const jitter = (Math.random() - 0.5) * 80;
  const baseX = viewport.midX - dims.w / 2 + jitter;
  const baseY = viewport.midY - dims.h / 2 + jitter;
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: baseX + i * CASCADE_OFFSET,
      y: baseY + i * CASCADE_OFFSET,
    });
  }
  return positions;
}
