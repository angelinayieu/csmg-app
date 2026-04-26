"use client";

import { useMemo } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { useValue } from "tldraw";
import type { KGNodeShape, ClusterFrameShape } from "../shapes/types";
import { LAYER_ORDER } from "@/lib/whiteboard/layer-config";
import { PAINT_GLOBAL_GHOST_KG_NODES } from "@/lib/whiteboard/canvas-feature-flags";
void LAYER_ORDER;

// Finds spatially-close groups of KG nodes that *aren't* already wrapped
// in a cluster frame. Returns one proposal per detected group so the
// parent can render a chip near the group's centroid ("Cluster these N?").
//
// Phase 7: pure spatial proximity. Phase 8+ can add semantic clustering
// (co-layer weighted by shared neighbours).

export interface AutoClusterProposal {
  shapeIds: string[];
  centroidPageX: number;
  centroidPageY: number;
  screenX: number;
  screenY: number;
  /** Median layer among members — used to accent the chip */
  dominantLayer: string;
  size: number;
}

// Distance (page units) within which two nodes count as "neighbours"
const PROXIMITY = 260;
// Minimum nodes to propose a cluster
const MIN_GROUP = 3;
const STASH_THRESHOLD = -1e5;

export function useAutoClusterDetect(
  editor: Editor | null,
  enabled: boolean,
): AutoClusterProposal[] {
  // Drive re-computation on shape + camera changes. Cheap since we only
  // touch ids + camera.
  const tick = useValue(
    "auto-cluster tick",
    () => {
      if (!editor) return 0;
      const ids = editor.getCurrentPageShapeIds();
      const cam = editor.getCamera();
      return ids.size + cam.x + cam.y + cam.z;
    },
    [editor],
  );
  void tick;

  return useMemo<AutoClusterProposal[]>(() => {
    if (!editor || !enabled) return [];
    // Architecture redesign — when global kg-node ghosts are off,
    // there's nothing to cluster. The hook used to scan for kg-node
    // shapes and silently return [], producing no UI cue. Now we
    // short-circuit at the top so no work is done and the consumer
    // can render an explicit "auto-cluster unavailable in this
    // canvas mode" affordance if needed.
    if (!PAINT_GLOBAL_GHOST_KG_NODES) return [];

    // Collect eligible KG nodes (not stashed, not already in a cluster)
    const kgShapes: Array<{
      id: TLShapeId;
      x: number;
      y: number;
      layer: string;
      clusterBound: boolean;
    }> = [];

    const clusterMembers = new Set<string>();
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type === "cluster-frame") {
        const cs = s as ClusterFrameShape;
        for (const cid of cs.props.childShapeIds) clusterMembers.add(cid);
      }
    }

    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== "kg-node") continue;
      if (s.x < STASH_THRESHOLD || s.y < STASH_THRESHOLD) continue;
      if (clusterMembers.has(s.id as string)) continue;
      const bounds = editor.getShapePageBounds(s.id);
      if (!bounds) continue;
      kgShapes.push({
        id: s.id,
        x: bounds.midX,
        y: bounds.midY,
        layer: (s as KGNodeShape).props.layer,
        clusterBound: false,
      });
    }

    if (kgShapes.length < MIN_GROUP) return [];

    // Union-find: connect shapes within PROXIMITY
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let p = parent.get(id) ?? id;
      if (p !== id) p = find(p);
      parent.set(id, p);
      return p;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const s of kgShapes) parent.set(s.id as string, s.id as string);
    for (let i = 0; i < kgShapes.length; i++) {
      for (let j = i + 1; j < kgShapes.length; j++) {
        const a = kgShapes[i];
        const b = kgShapes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy <= PROXIMITY * PROXIMITY) {
          union(a.id as string, b.id as string);
        }
      }
    }

    // Group by root
    const groups = new Map<string, typeof kgShapes>();
    for (const s of kgShapes) {
      const root = find(s.id as string);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(s);
    }

    const out: AutoClusterProposal[] = [];
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;

    for (const members of groups.values()) {
      if (members.length < MIN_GROUP) continue;
      const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
      const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
      // Median layer
      const layerCounts = new Map<string, number>();
      for (const m of members) {
        layerCounts.set(m.layer, (layerCounts.get(m.layer) ?? 0) + 1);
      }
      const dominantLayer =
        Array.from(layerCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "L2";

      const screen = editor.pageToScreen({ x: cx, y: cy });
      // Cull chips well outside the viewport
      if (screen.x < 40 || screen.x > vw - 40 || screen.y < 80 || screen.y > vh - 120) {
        continue;
      }

      out.push({
        shapeIds: members.map((m) => m.id as string),
        centroidPageX: cx,
        centroidPageY: cy,
        screenX: screen.x,
        screenY: screen.y,
        dominantLayer,
        size: members.length,
      });
    }

    // Only surface the top proposal (biggest group) to avoid chip spam.
    out.sort((a, b) => b.size - a.size);
    return out.slice(0, 1);
  }, [editor, enabled, tick]);
}
