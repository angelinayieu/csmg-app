"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor, TLArrowShape, TLShapeId, TLShapePartial } from "tldraw";
import { createShapeId } from "tldraw";
import type { KGNodeShape } from "../shapes/types";
import { KG_NODE_TIER_SIZE } from "../shapes/kg-node-shape";
import { entityToLayerId } from "@/lib/whiteboard/layer-config";

// Phase 8.2 — Recursive decomposition.
//
// After a sticky materializes into a KG node, we want the new node to
// auto-decompose into 2-3 proxy indicators (ghost children arc'd below).
// This delivers the "probability space layers" effect the user asked for
// without requiring them to click anything.
//
// Depth is tracked per entity UUID so we can cap at MAX_DEPTH (grand-
// children require user-initiated decompose). The hook watches the tldraw
// store for newly-created kg-node shapes with isGhost=true and, if the
// node is eligible (autoAI on + under depth cap + not already processed),
// schedules a single recursive-decompose call after IDLE_MS ms.

const MAX_DEPTH = 2;
const IDLE_MS = 1500;
const CHILD_ARC_RADIUS = 220;

interface RecursiveChild {
  id: string;
  entity_id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  layer: string | null;
  depth: number | null;
  confidence: number | null;
}

interface RecursiveEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
}

export interface UseRecursiveDecomposeOptions {
  editor: Editor | null;
  spaceId: string;
  enabled: boolean;
  /** Entities that arrived fully-formed (e.g. from initial sync) — skip. */
  initialSkipIds?: Set<string>;
}

export function useRecursiveDecompose({
  editor,
  spaceId,
  enabled,
  initialSkipIds,
}: UseRecursiveDecomposeOptions) {
  // Depth per entity UUID. Newly-materialized entities start at 0; their
  // recursive children are depth 1; grandchildren (if we ever run them)
  // would be 2.
  const depthByEntity = useRef(new Map<string, number>());
  // Entities we've already scheduled / fired for.
  const processed = useRef(new Set<string>());
  // Skip entities that existed before the canvas loaded.
  const skip = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (initialSkipIds) skip.current = initialSkipIds;
  }, [initialSkipIds]);

  // Core RPC: call the recursive-decompose endpoint + place children ghosts.
  const runRecursive = useCallback(
    async (parentShapeId: TLShapeId, parentEntityId: string, parentDepth: number) => {
      if (!editor) return;

      try {
        const res = await fetch("/api/canvas/recursive-decompose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId: parentEntityId }),
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          children: RecursiveChild[];
          edges: RecursiveEdge[];
        };
        if (!payload.children || payload.children.length === 0) return;

        const parentBounds = editor.getShapePageBounds(parentShapeId);
        if (!parentBounds) return;

        const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;
        const tier = "support" as const;
        const w = TIER_WIDTH[tier];
        const h = TIER_HEIGHT[tier];

        // Arc positioning: children span ~120° below the parent.
        const count = payload.children.length;
        const spread = Math.min(120, 50 + count * 25); // degrees
        const startAngle = 90 - spread / 2; // 90° = straight down
        const step = count > 1 ? spread / (count - 1) : 0;

        editor.markHistoryStoppingPoint(`recursive-decompose-${parentEntityId}`);
        const createdShapeIdByEntity = new Map<string, TLShapeId>();

        // Create the child shapes
        const shapePartials: TLShapePartial<KGNodeShape>[] = [];
        payload.children.forEach((child, i) => {
          const angleDeg = startAngle + i * step;
          const rad = (angleDeg * Math.PI) / 180;
          const cx = parentBounds.midX + Math.cos(rad) * CHILD_ARC_RADIUS;
          const cy = parentBounds.maxY + Math.sin(rad) * (CHILD_ARC_RADIUS * 0.6) + 40;

          const shapeId = createShapeId(`kg-${child.id}`);
          if (editor.getShape(shapeId)) return; // already exists — skip
          createdShapeIdByEntity.set(child.id, shapeId);

          const normalizedLayer = entityToLayerId({
            layer: child.layer ?? null,
            entity_category: child.entity_category ?? null,
          });

          shapePartials.push({
            id: shapeId,
            type: "kg-node",
            x: cx - w / 2,
            y: cy - h / 2,
            props: {
              w,
              h,
              entityId: child.id,
              name: child.name,
              description: child.description ?? "",
              layer: normalizedLayer,
              category: child.entity_category ?? "concrete",
              tier,
              weight: Math.round(((child.confidence ?? 0.7) as number) * 100),
              isLeverage: false,
              isRisk: false,
              isBottleneck: false,
              isConvergence: false,
              isGhost: true,
              confirmedPulse: 0,
            },
          });
        });

        if (shapePartials.length === 0) return;
        editor.createShapes(shapePartials);

        // Track depth for each new child
        for (const child of payload.children) {
          depthByEntity.current.set(child.id, parentDepth + 1);
        }

        // Wire dashed arrows child → parent for each returned edge
        for (const edge of payload.edges) {
          const fromShapeId =
            createdShapeIdByEntity.get(edge.source_entity_id) ??
            createShapeId(`kg-${edge.source_entity_id}`);
          const toShapeId =
            createdShapeIdByEntity.get(edge.target_entity_id) ??
            createShapeId(`kg-${edge.target_entity_id}`);

          if (!editor.getShape(fromShapeId) || !editor.getShape(toShapeId)) continue;

          const arrowId = createShapeId();
          const arrow: TLShapePartial<TLArrowShape> = {
            id: arrowId,
            type: "arrow",
            props: { color: "grey", size: "s", dash: "dashed" },
          };
          editor.createShapes([arrow]);
          try {
            editor.createBindings([
              {
                fromId: arrowId,
                toId: fromShapeId,
                type: "arrow",
                props: {
                  terminal: "start",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
              {
                fromId: arrowId,
                toId: toShapeId,
                type: "arrow",
                props: {
                  terminal: "end",
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              },
            ]);
          } catch {
            // non-fatal
          }
        }
      } catch (err) {
        console.warn("[recursive-decompose]", err);
      }
    },
    [editor, spaceId],
  );

  // Watch the tldraw store for newly-created ghost KG nodes. When one
  // appears, wait IDLE_MS then run the recursive decompose if gates pass.
  useEffect(() => {
    if (!editor) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const handleCreate = (shape: KGNodeShape) => {
      const entityId = shape.props.entityId;
      if (!entityId) return;
      if (skip.current.has(entityId)) return;
      if (processed.current.has(entityId)) return;
      if (!enabled) return;

      // Depth: default 0 for unknown (materialized) entities. Children of
      // recursive-decompose are registered above, so we won't re-process
      // those.
      const depth = depthByEntity.current.get(entityId) ?? 0;
      if (depth >= MAX_DEPTH - 1) return;

      processed.current.add(entityId);
      const timer = setTimeout(() => {
        timers.delete(entityId);
        void runRecursive(shape.id, entityId, depth);
      }, IDLE_MS);
      timers.set(entityId, timer);
    };

    const unsub = editor.store.listen((event) => {
      for (const record of Object.values(event.changes.added)) {
        if (record.typeName === "shape" && record.type === "kg-node") {
          const kg = record as KGNodeShape;
          if (kg.props.isGhost) handleCreate(kg);
        }
      }
    });

    return () => {
      unsub();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [editor, enabled, runRecursive]);
}
