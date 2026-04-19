"use client";

import { useCallback } from "react";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { createShapeId } from "tldraw";
import { toggleClusterImpl } from "../shapes/cluster-frame-shape";
import type { ClusterFrameShape, KGNodeShape } from "../shapes/types";

export interface UseClusterFramesResult {
  createCluster: () => void;
  toggleCluster: (clusterId: TLShapeId) => void;
}

export function useClusterFrames(editor: Editor | null): UseClusterFramesResult {
  const createCluster = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelectedShapes();
    // Only wrap actual canvas content — sticky notes, KG nodes, and arrows.
    // Ignore other clusters and synthesis cards (those should stay at the
    // top level).
    const eligible = selected.filter(
      (s) => s.type === "kg-node" || s.type === "sticky-note" || s.type === "arrow",
    );
    if (eligible.length < 2) return;

    const boundsList = eligible
      .map((s) => editor.getShapePageBounds(s.id))
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (boundsList.length === 0) return;
    const minX = Math.min(...boundsList.map((b) => b.minX));
    const minY = Math.min(...boundsList.map((b) => b.minY));
    const maxX = Math.max(...boundsList.map((b) => b.maxX));
    const maxY = Math.max(...boundsList.map((b) => b.maxY));
    const PAD = 32;
    const frameX = minX - PAD;
    const frameY = minY - PAD - 8;
    const frameW = maxX - minX + PAD * 2;
    const frameH = maxY - minY + PAD * 2 + 8;

    const kgChildren = eligible.filter((s) => s.type === "kg-node") as KGNodeShape[];
    const previewLabels = kgChildren.slice(0, 5).map((s) => s.props.name);
    const title =
      kgChildren[0]?.props.name && kgChildren.length > 1
        ? `${kgChildren[0].props.name} cluster`
        : kgChildren[0]?.props.name ?? `Cluster of ${eligible.length}`;

    const layerCounts: Record<string, number> = {};
    for (const c of kgChildren) {
      layerCounts[c.props.layer] = (layerCounts[c.props.layer] ?? 0) + 1;
    }
    const dominantLayer = Object.entries(layerCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const accent =
      dominantLayer === "L0"
        ? "#0051ff"
        : dominantLayer === "L1"
          ? "#1a7aff"
          : dominantLayer === "L3"
            ? "#af52de"
            : dominantLayer === "L4"
              ? "#ff9500"
              : "#5856d6";

    const clusterId = createShapeId();
    editor.markHistoryStoppingPoint("create-cluster");

    editor.createShape<ClusterFrameShape>({
      id: clusterId,
      type: "cluster-frame",
      x: frameX,
      y: frameY,
      props: {
        w: frameW,
        h: frameH,
        title,
        collapsed: false,
        childShapeIds: eligible.map((s) => s.id as string),
        stashedPositions: [],
        accent,
        previewLabels,
      },
    });

    editor.sendToBack([clusterId]);
    editor.select(clusterId);
  }, [editor]);

  const toggleCluster = useCallback(
    (clusterId: TLShapeId) => {
      if (!editor) return;
      toggleClusterImpl(editor, clusterId);
    },
    [editor],
  );

  return { createCluster, toggleCluster };
}

// Returns the active cluster shape (if the selection is a single cluster).
export function getActiveCluster(selected: readonly TLShape[]): ClusterFrameShape | null {
  if (selected.length !== 1) return null;
  const s = selected[0];
  return s.type === "cluster-frame" ? (s as ClusterFrameShape) : null;
}
