"use client";

import { useEffect, useRef } from "react";
import type { Editor, TLArrowShape, TLShapeId, TLShapePartial } from "tldraw";
import { createShapeId } from "tldraw";
import type { Entity, Edge } from "@/types";
import { entityToLayerId } from "@/lib/whiteboard/layer-config";
import { KG_NODE_TIER_SIZE } from "../shapes/kg-node-shape";
import type { KGNodeShape } from "../shapes/types";

const { TIER_WIDTH, TIER_HEIGHT } = KG_NODE_TIER_SIZE;

// Deterministic shape id from entity id so re-renders don't duplicate.
function shapeIdForEntity(entityId: string): TLShapeId {
  return createShapeId(`kg-${entityId}`);
}
function shapeIdForEdge(edgeId: string): TLShapeId {
  return createShapeId(`edge-${edgeId}`);
}

function tierForEntity(e: Entity, edgeCount: number): KGNodeShape["props"]["tier"] {
  if (e.is_leverage_point || e.is_master_bottleneck) return "hero";
  if (e.importance === "fundamental" || e.importance === "critical") return "hero";
  if (e.importance === "important") return "key";
  if (edgeCount >= 4) return "key";
  if (edgeCount <= 1) return "peripheral";
  return "support";
}

export interface SyncEntitiesOptions {
  entities: Entity[];
  edges: Edge[];
  enabled: boolean;
}

// Seeds the tldraw document with KGNode shapes for each entity and arrow
// shapes for each edge. Runs ONCE per canvas mount when enabled flips true
// and the editor has no kg-node shapes yet. Subsequent edits (move, add
// sticky, etc.) are user-owned.
export function useSyncEntities(editor: Editor | null, { entities, edges, enabled }: SyncEntitiesOptions) {
  const seeded = useRef(false);

  useEffect(() => {
    if (!editor || !enabled || seeded.current) return;
    // Check if we already have KG shapes (from persistence restore)
    const existing = editor.getCurrentPageShapes().filter((s) => s.type === "kg-node");
    if (existing.length > 0) {
      seeded.current = true;
      return;
    }
    if (entities.length === 0) {
      seeded.current = true;
      return;
    }

    // Count edges per entity for tier inference
    const edgeCount = new Map<string, number>();
    for (const e of edges) {
      edgeCount.set(e.source_entity_id, (edgeCount.get(e.source_entity_id) ?? 0) + 1);
      edgeCount.set(e.target_entity_id, (edgeCount.get(e.target_entity_id) ?? 0) + 1);
    }

    // Simple layered layout: group entities by layer (L0 top, L4 bottom)
    // inside each layer sort by leverage/tier then lay out in a row.
    const byLayer = new Map<string, Entity[]>();
    for (const e of entities) {
      const layer = entityToLayerId(e);
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(e);
    }

    const BAND_HEIGHT = 280;
    const HORIZONTAL_GAP = 32;
    const LAYER_ORDER = ["L0", "L1", "L2", "L3", "L4"] as const;

    const shapesToCreate: TLShapePartial<KGNodeShape>[] = [];
    const entityToShapeId = new Map<string, TLShapeId>();

    LAYER_ORDER.forEach((layer, layerIdx) => {
      const layerEntities = byLayer.get(layer) ?? [];
      if (layerEntities.length === 0) return;
      // Sort: leverage first, then by edge count desc
      layerEntities.sort((a, b) => {
        const aLev = a.is_leverage_point ? 1 : 0;
        const bLev = b.is_leverage_point ? 1 : 0;
        if (aLev !== bLev) return bLev - aLev;
        return (edgeCount.get(b.id) ?? 0) - (edgeCount.get(a.id) ?? 0);
      });

      // Compute total row width, then center around x=0
      const cards = layerEntities.map((e) => {
        const tier = tierForEntity(e, edgeCount.get(e.id) ?? 0);
        return { entity: e, tier, w: TIER_WIDTH[tier], h: TIER_HEIGHT[tier] };
      });
      const totalW = cards.reduce((s, c) => s + c.w + HORIZONTAL_GAP, -HORIZONTAL_GAP);
      let cursorX = -totalW / 2;
      const y = layerIdx * BAND_HEIGHT;

      for (const c of cards) {
        const sid = shapeIdForEntity(c.entity.id);
        entityToShapeId.set(c.entity.id, sid);
        shapesToCreate.push({
          id: sid,
          type: "kg-node",
          x: cursorX,
          y,
          props: {
            w: c.w,
            h: c.h,
            entityId: c.entity.id,
            name: c.entity.name,
            description: c.entity.description ?? "",
            layer: entityToLayerId(c.entity),
            category: (c.entity.entity_category as string) ?? "concrete",
            tier: c.tier,
            weight: Math.round(((c.entity.confidence ?? 0.7) as number) * 100),
            isLeverage: !!c.entity.is_leverage_point,
            isRisk: !!c.entity.is_risk_point,
            isBottleneck: !!c.entity.is_master_bottleneck,
            isConvergence: false,
            isGhost: false,
          },
        });
        cursorX += c.w + HORIZONTAL_GAP;
      }
    });

    if (shapesToCreate.length === 0) {
      seeded.current = true;
      return;
    }

    editor.createShapes(shapesToCreate);

    // Now wire edges as arrows (bind to shapes)
    const arrowShapes: TLShapePartial<TLArrowShape>[] = [];
    for (const e of edges) {
      const srcSid = entityToShapeId.get(e.source_entity_id);
      const tgtSid = entityToShapeId.get(e.target_entity_id);
      if (!srcSid || !tgtSid) continue;
      arrowShapes.push({
        id: shapeIdForEdge(e.id),
        type: "arrow",
        props: {
          color: "grey",
          size: "s",
        },
      });
    }
    if (arrowShapes.length > 0) {
      editor.createShapes(arrowShapes);
      // Bind each arrow endpoints
      for (const e of edges) {
        const srcSid = entityToShapeId.get(e.source_entity_id);
        const tgtSid = entityToShapeId.get(e.target_entity_id);
        const arrowId = shapeIdForEdge(e.id);
        if (!srcSid || !tgtSid) continue;
        try {
          editor.createBindings([
            {
              fromId: arrowId,
              toId: srcSid,
              type: "arrow",
              props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
              meta: {},
            },
            {
              fromId: arrowId,
              toId: tgtSid,
              type: "arrow",
              props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
              meta: {},
            },
          ]);
        } catch {
          // tldraw arrow binding API may differ; fail gracefully — user can still draw arrows
        }
      }
    }

    // Center on the highest-importance node (or just origin) at 80% zoom
    // so the user lands on something readable, not a zoomed-out overview
    // that crams 100+ nodes at 30%.
    const hero = entities.find((e) => e.is_leverage_point || e.importance === "fundamental");
    const heroShapeId = hero ? shapeIdForEntity(hero.id) : null;
    if (heroShapeId) {
      const bounds = editor.getShapePageBounds(heroShapeId);
      if (bounds) {
        editor.centerOnPoint({ x: bounds.midX, y: bounds.midY }, { animation: { duration: 300 } });
      }
    } else {
      editor.centerOnPoint({ x: 0, y: 0 });
    }
    editor.setCamera(
      { x: editor.getCamera().x, y: editor.getCamera().y, z: 0.8 },
      { immediate: true },
    );

    seeded.current = true;
  }, [editor, enabled, entities, edges]);
}
