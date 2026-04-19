"use client";

import { useMemo } from "react";
import type { Editor } from "tldraw";
import { createShapeId, useValue } from "tldraw";
import type { Entity, Edge } from "@/types";
import { entityToDepth } from "@/lib/whiteboard/layer-config";

// Detects "under-decomposed" hubs: high-importance entities in upper layers
// (L0/L1) that don't yet have enough downstream children (L2+ entities
// connected to them). Returns { entityId, screenX, screenY, missingChildren }
// for each hub so the parent can render a floating "Decompose this" chip.

export interface ClusterNudge {
  entityId: string;
  name: string;
  screenX: number;
  screenY: number;
  missingChildren: number;
  minExpected: number;
}

export interface UseClusterNudgesOptions {
  entities: Entity[];
  edges: Edge[];
  enabled: boolean;
  // Minimum children an L0/L1 hub should have before we stop nudging.
  minChildrenForHub?: number;
}

export function useClusterNudges(
  editor: Editor | null,
  { entities, edges, enabled, minChildrenForHub = 3 }: UseClusterNudgesOptions,
): ClusterNudge[] {
  // Reactive subscription: re-compute when camera moves or shapes change
  // so chips track the canvas. Using useValue + tldraw's atom system keeps
  // this cheap.
  const tick = useValue(
    "camera/shapes tick",
    () => {
      if (!editor) return 0;
      // Touch the camera and shape ids so we re-run on any of them
      const cam = editor.getCamera();
      const ids = editor.getCurrentPageShapeIds();
      return cam.x + cam.y + cam.z + ids.size;
    },
    [editor],
  );
  // Silence unused var; we only need the reactive dependency.
  void tick;

  const staticUnderDecomposed = useMemo(() => {
    if (!enabled) return [];

    // Build child count per entity UUID, counting only "downstream" edges
    // (where source points down the layer stack — depth 0→1, 1→2, etc.).
    const childCount = new Map<string, number>();
    for (const e of entities) childCount.set(e.id, 0);

    // Phase 10: canonical depth first, fall back to legacy layer string.
    const depthOf = (ent: Entity | undefined) =>
      ent ? entityToDepth(ent) : 99;
    const entityById = new Map<string, Entity>();
    for (const e of entities) entityById.set(e.id, e);

    for (const edge of edges) {
      const src = entityById.get(edge.source_entity_id);
      const tgt = entityById.get(edge.target_entity_id);
      if (!src || !tgt) continue;
      const srcRank = depthOf(src);
      const tgtRank = depthOf(tgt);
      // "child_of" is typically target→source; "part_of" is source→target parent
      if (edge.relationship_type === "part_of" && srcRank > tgtRank) {
        childCount.set(edge.target_entity_id, (childCount.get(edge.target_entity_id) ?? 0) + 1);
      } else if (srcRank < tgtRank) {
        // source is higher in stack, target is child
        childCount.set(edge.source_entity_id, (childCount.get(edge.source_entity_id) ?? 0) + 1);
      } else if (srcRank > tgtRank) {
        childCount.set(edge.target_entity_id, (childCount.get(edge.target_entity_id) ?? 0) + 1);
      }
    }

    // Hub candidates: depth 0/1 entities that are fundamental/critical/important
    // and have < minChildrenForHub children.
    const hubs = entities.filter((e) => {
      const rank = depthOf(e);
      if (rank > 1) return false;
      const imp = e.importance ?? "moderate";
      if (imp === "moderate") return false;
      return (childCount.get(e.id) ?? 0) < minChildrenForHub;
    });

    return hubs.map((h) => ({
      entityId: h.id,
      name: h.name,
      missingChildren: minChildrenForHub - (childCount.get(h.id) ?? 0),
      minExpected: minChildrenForHub,
    }));
  }, [entities, edges, enabled, minChildrenForHub]);

  // Now compute screen positions for each hub on every camera tick. Hubs
  // whose shapes have been stashed off-canvas by a cluster collapse (moved
  // to extremely negative coordinates) are skipped — their chips would
  // otherwise fly off the visible viewport.
  const STASH_THRESHOLD = -1e5;
  const positioned = useMemo<ClusterNudge[]>(() => {
    if (!editor || staticUnderDecomposed.length === 0) return [];
    const out: ClusterNudge[] = [];
    for (const hub of staticUnderDecomposed) {
      const shapeId = createShapeId(`kg-${hub.entityId}`);
      const shape = editor.getShape(shapeId);
      if (!shape) continue;
      // Skip shapes that have been stashed by a collapsing cluster
      if (shape.x < STASH_THRESHOLD || shape.y < STASH_THRESHOLD) continue;
      const bounds = editor.getShapePageBounds(shapeId);
      if (!bounds) continue;
      const screenPt = editor.pageToScreen({ x: bounds.midX, y: bounds.minY });
      // Cull chips whose anchor point is outside the visible viewport.
      // Without this, zoomed-out canvases render dozens of chips crammed
      // at the edges.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (
        screenPt.x < 40 ||
        screenPt.x > vw - 40 ||
        screenPt.y < 80 ||
        screenPt.y > vh - 100
      ) {
        continue;
      }
      out.push({
        entityId: hub.entityId,
        name: hub.name,
        missingChildren: hub.missingChildren,
        minExpected: hub.minExpected,
        screenX: screenPt.x,
        screenY: screenPt.y,
      });
    }
    return out;
    // Camera tick drives this via the useValue above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, staticUnderDecomposed, tick]);

  return positioned;
}
