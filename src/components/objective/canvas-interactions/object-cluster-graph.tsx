"use client";

// ── ObjectClusterGraph ──
//
// A small node-link diagram of ONE library object's neighborhood: the
// object in the center + its directly-linked objects (object_links: feeds /
// depends_on / derived_from / …) around it. Click a neighbor → navigate the
// drawer to it (re-centers the cluster there).
//
// Renders by reusing the SAME engine as the space-wide Knowledge Graph panel
// (cytoscape + fcose, degree-sized dots, hover-reveals labels, shared color
// tokens). One visual language for "graph of objects" everywhere it appears.

import { useMemo } from "react";
import {
  KnowledgeGraphCanvas,
  type KgEdge,
  type KgNode,
} from "./knowledge-graph-panel";

export interface ClusterNeighbor {
  id: string;
  title: string;
  type: string; // object_type
  relation?: string;
  direction?: "out" | "in";
}

// Synthetic id for the center node — namespaced so it can never collide with
// a real library_objects UUID (defensive: prevents onNavigate from opening
// "the card itself" if the engine ever taps the center).
const CENTER_ID = "__cluster_center__";

export function ObjectClusterGraph({
  centerTitle,
  centerType,
  neighbors,
  onNavigate,
}: {
  centerTitle: string;
  centerType: string;
  neighbors: ClusterNeighbor[];
  onNavigate: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    // Center carries degree = N (one edge per neighbor) so the fcose layout
    // sizes it as the obvious hub. Neighbors each carry degree = 1 so they
    // settle as smaller satellite dots — visual hierarchy is automatic.
    const n: KgNode[] = [
      {
        id: CENTER_ID,
        type: centerType,
        title: centerTitle,
        degree: neighbors.length,
      },
      ...neighbors.map((nb) => ({
        id: nb.id,
        type: nb.type,
        title: nb.title,
        degree: 1,
      })),
    ];
    // Direction: "out" = center → neighbor; "in" = neighbor → center.
    // Default to "out" if missing so an unannotated link still reads cleanly.
    const e: KgEdge[] = neighbors.map((nb) => {
      const out = (nb.direction ?? "out") === "out";
      return {
        source: out ? CENTER_ID : nb.id,
        target: out ? nb.id : CENTER_ID,
        relation: nb.relation ?? "related",
      };
    });
    return { nodes: n, edges: e };
  }, [centerTitle, centerType, neighbors]);

  if (neighbors.length === 0) return null;

  return (
    <div style={{ width: "100%", height: 280 }}>
      <KnowledgeGraphCanvas
        nodes={nodes}
        edges={edges}
        onNodeClick={(id) => {
          // Center tap is a no-op — the drawer already shows this object.
          if (id !== CENTER_ID) onNavigate(id);
        }}
      />
    </div>
  );
}
