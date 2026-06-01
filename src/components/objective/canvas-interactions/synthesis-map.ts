// ── Deep Synthesize → fork an idea-map onto the board ──
//
// Takes the structured result of `/api/objective/[spaceId]/deep-synthesize`
// (a central insight + several web-grounded cross-links) and materializes it
// as a small MAP next to the user's selection: one `hub` insight-card, a fan
// of `branch` insight-cards (each carrying its web citations), and dashed
// arrows — hub → each branch, and each branch → the exact source shapes it
// draws on (the cross-links). Every node + arrow is tagged `meta.mapId =
// hubId` so the hub's Keep/Dismiss curates the whole cluster as one decision
// (see insight-card-shape.tsx). Models on `createInsightWithLinks` in
// whiteboard-base — same arrow/binding recipe, just a cluster instead of one.

import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import type {
  InsightCardShape,
  InsightCitation,
} from "../shapes/insight-card-shape";

export interface SynthesisBranch {
  headline: string;
  body: string;
  /** 1-based indices into the numbered selection this branch draws on. */
  sourceRefs: number[];
  citations: InsightCitation[];
}

export interface SynthesisMap {
  hub: { headline: string; body: string };
  branches: SynthesisBranch[];
}

const HUB_W = 264;
const HUB_H = 156;
const BRANCH_W = 230;
const BRANCH_H = 156;
const MAX_BRANCHES = 6;

/** Dashed, headless tether between two shapes, tagged into the map so the
 *  hub can solidify (Keep) or delete (Dismiss) the whole cluster at once. */
function tether(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
  mapId: string,
): void {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: { color: "grey", size: "s", dash: "dashed", arrowheadEnd: "none" },
    meta: { mapId, proposalFor: mapId },
  };
  editor.createShapes([arrow]);
  editor.createBindings([
    {
      fromId: arrowId,
      toId: fromId,
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
      toId: toId,
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
}

/** Render a Deep Synthesize result as a proposed map beside the selection.
 *  Soft: silently no-ops on an empty map. */
export function forkSynthesisMap(
  editor: Editor,
  opts: {
    map: SynthesisMap;
    /** Ordered source shape ids = the numbered selection sent to the LLM. */
    sourceIds: TLShapeId[];
    color: string;
  },
): void {
  const branches = (opts.map.branches ?? [])
    .filter((b) => b && (b.headline || b.body))
    .slice(0, MAX_BRANCHES);
  if (!opts.map.hub?.headline && branches.length === 0) return;

  // Bounding box of the (still-present) sources → place the map to their
  // right so it fans out without overlapping the originals.
  const sourceBounds = opts.sourceIds
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<typeof b> => !!b);

  let selMidX: number;
  let selMidY: number;
  let selMaxX: number;
  if (sourceBounds.length > 0) {
    selMidY =
      sourceBounds.reduce((a, b) => a + b.midY, 0) / sourceBounds.length;
    selMidX =
      sourceBounds.reduce((a, b) => a + b.midX, 0) / sourceBounds.length;
    selMaxX = Math.max(...sourceBounds.map((b) => b.maxX));
  } else {
    const vp = editor.getViewportPageBounds();
    selMidX = vp.center.x;
    selMidY = vp.center.y;
    selMaxX = vp.center.x;
  }

  const hubCx = selMaxX + 340;
  const hubCy = selMidY;
  const radius = Math.max(220, 78 * branches.length);

  const hubId = createShapeId();
  editor.createShape<InsightCardShape>({
    id: hubId,
    type: "insight-card",
    x: hubCx - HUB_W / 2,
    y: hubCy - HUB_H / 2,
    props: {
      w: HUB_W,
      h: HUB_H,
      status: "proposed",
      kind: "synthesize",
      role: "hub",
      headline: opts.map.hub?.headline || "Synthesis",
      body: opts.map.hub?.body || "",
      color: opts.color,
      sourceIds: opts.sourceIds as string[],
      citations: [],
    },
    // The hub tags itself so the cascade Keep/Dismiss includes it.
    meta: { mapId: hubId },
  });

  branches.forEach((b, i) => {
    // Right-hand arc from -68° to +68°; a lone branch sits straight out.
    const total = branches.length;
    const deg = total === 1 ? 0 : -68 + (136 * i) / (total - 1);
    const rad = (deg * Math.PI) / 180;
    const bx = hubCx + radius * Math.cos(rad);
    const by = hubCy + radius * Math.sin(rad);

    // Resolve 1-based refs → live source shape ids (skip any since deleted).
    const refIds = (b.sourceRefs ?? [])
      .map((r) => opts.sourceIds[r - 1])
      .filter((id): id is TLShapeId => !!id && !!editor.getShape(id));

    const branchId = createShapeId();
    editor.createShape<InsightCardShape>({
      id: branchId,
      type: "insight-card",
      x: bx - BRANCH_W / 2,
      y: by - BRANCH_H / 2,
      props: {
        w: BRANCH_W,
        h: BRANCH_H,
        status: "proposed",
        kind: "synthesize",
        role: "branch",
        headline: b.headline || "Insight",
        body: b.body || "",
        color: opts.color,
        sourceIds: refIds as string[],
        citations: (b.citations ?? [])
          .filter((c) => c && c.url)
          .slice(0, 3)
          .map((c) => ({ title: c.title ?? "", url: c.url })),
      },
      meta: { mapId: hubId },
    });

    // hub → branch (membership), then branch → each source (the cross-links).
    tether(editor, hubId, branchId, hubId);
    for (const sid of refIds) tether(editor, branchId, sid, hubId);
  });

  editor.select(hubId);
  editor.centerOnPoint(
    { x: (selMidX + hubCx) / 2, y: hubCy },
    { animation: { duration: 320 } },
  );
}
