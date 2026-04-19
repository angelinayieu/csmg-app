// Register the canvas's custom shapes with tldraw's type registry so
// `editor.updateShape<MyShape>`, `editor.createShape<MyShape>`, and
// `shape.type === "kg-node"` all narrow correctly.
//
// tldraw v4 exposes the global `TLGlobalShapePropsMap` interface as the
// extension point — augmenting it with our shape's prop shapes makes them
// members of the `TLShape` union.

import type { LayerId } from "@/lib/whiteboard/layer-config";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "kg-node": {
      w: number;
      h: number;
      entityId: string;
      name: string;
      description: string;
      layer: LayerId;
      category: string;
      tier: "hero" | "key" | "support" | "peripheral";
      weight: number;
      isLeverage: boolean;
      isRisk: boolean;
      isBottleneck: boolean;
      isConvergence: boolean;
      isGhost: boolean;
    };
    "sticky-note": {
      w: number;
      h: number;
      text: string;
      color: "yellow" | "pink" | "blue" | "green" | "purple";
      dimension:
        | "problem"
        | "solution"
        | "question"
        | "insight"
        | "risk"
        | "evidence"
        | null;
      aiTagged: boolean;
      entityId: string | null;
    };
    "synthesis-card": {
      w: number;
      h: number;
      kind: "leverage" | "risk" | "cycle" | "bridge" | "insight";
      title: string;
      body: string;
      sourceEntityIds: string[];
    };
    "cluster-frame": {
      w: number;
      h: number;
      title: string;
      collapsed: boolean;
      childShapeIds: string[];
      stashedPositions: Array<{ id: string; x: number; y: number }>;
      accent: string;
      previewLabels: string[];
    };
  }
}

// Ensure module is treated as a module
export {};
