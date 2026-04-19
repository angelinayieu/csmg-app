import type { TLBaseShape } from "tldraw";
import type { LayerId } from "@/lib/whiteboard/layer-config";

export type StickyColor = "yellow" | "pink" | "blue" | "green" | "purple";

export type StickyDimension =
  | "problem"
  | "solution"
  | "question"
  | "insight"
  | "risk"
  | "evidence"
  | null;

export type StickyNoteShape = TLBaseShape<
  "sticky-note",
  {
    w: number;
    h: number;
    text: string;
    color: StickyColor;
    dimension: StickyDimension;
    aiTagged: boolean;
    entityId: string | null;
  }
>;

export type KGNodeShape = TLBaseShape<
  "kg-node",
  {
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
    // Provisional state: entity exists in DB (source_tag="implicit") but user
    // hasn't confirmed it. Rendered translucent + dashed; an accept/reject
    // chip floats near the shape. On accept the flag flips to false + the
    // entity's source_tag is promoted to "confirmed".
    isGhost: boolean;
  }
>;

export type SynthesisCardShape = TLBaseShape<
  "synthesis-card",
  {
    w: number;
    h: number;
    kind: "leverage" | "risk" | "cycle" | "bridge" | "insight";
    title: string;
    body: string;
    sourceEntityIds: string[];
  }
>;

export type ClusterFrameShape = TLBaseShape<
  "cluster-frame",
  {
    w: number;
    h: number;
    title: string;
    collapsed: boolean;
    // tldraw shape ids (stringified) of child shapes that belong to this cluster
    childShapeIds: string[];
    // Stashed original positions so expand can restore them. Keyed by shape id.
    stashedPositions: Array<{ id: string; x: number; y: number }>;
    // Accent color derived from the dominant layer of children. Phase 5 keeps
    // this static; Phase 6 can recompute on child changes.
    accent: string;
    // Cached preview labels for the collapsed card (first 3 child names).
    previewLabels: string[];
  }
>;

export type CanvasCustomShape =
  | KGNodeShape
  | StickyNoteShape
  | SynthesisCardShape
  | ClusterFrameShape;
