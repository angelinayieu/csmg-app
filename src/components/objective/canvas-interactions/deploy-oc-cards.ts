// ── Deploy decomposed Feature/Variable cards onto the board ──
//
// Takes the output of /api/objective/[spaceId]/decompose-cards and lays it
// out as a SYSTEMS graph: subsystems = horizontal swimlanes, causal depth =
// left→right columns, dependencies = DIRECTED arrows. Replaces the old
// "features in a left column, variables in a right column, undirected dashed
// lines" placer, which produced crossing spaghetti that showed neither
// direction nor grouping. The layout math lives in layout-systems-graph;
// this module just materializes it as tldraw shapes.
//
// Decoupled from the board internals via DECOMPOSE_INTO_CARDS_EVENT so any
// trigger (button, command palette, card action) can request a decompose.

import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import type { OcCardShape, OcCardKind } from "../shapes/oc-card-shape";
import { layoutSystemsGraph } from "@/lib/objective-canvas/layout-systems-graph";
import { reserveSpace } from "./placement";
import { frameForkedGroup } from "./group-frame";
import { deployFlowConnector } from "./flow-connector-board";

/** Soft 7-color palette for the per-subsystem frame accents — rotated by lane
 *  index so sibling frames read as distinct systems instead of one blob. */
const SUBSYSTEM_ACCENTS = [
  "#7C3AED", // violet
  "#0EA5E9", // sky
  "#14B8A6", // teal
  "#F59E0B", // amber
  "#EC4899", // pink
  "#22C55E", // green
  "#A855F7", // purple
] as const;

/** Fire to ask the board to decompose the current objective into cards. */
export const DECOMPOSE_INTO_CARDS_EVENT = "objective-board:decompose-into-cards";
/** Fired by the board listener when a decompose run settles (ok or fail),
 *  so a trigger can clear its busy state. */
export const DECOMPOSE_DONE_EVENT = "objective-board:decompose-done";

export function requestDecomposeIntoCards() {
  window.dispatchEvent(new CustomEvent(DECOMPOSE_INTO_CARDS_EVENT));
}

export interface DeployCard {
  objectId: string;
  kind: OcCardKind;
  name: string;
  body: string;
  /** Cohesive cluster → its swimlane. Defaults to "Core" when absent. */
  subsystem?: string;
}
export interface DeployLink {
  fromObjectId: string;
  toObjectId: string;
  /** "feeds" → from drives to; "depends_on" → from needs to (flow reversed). */
  relation: string;
}

const CARD_W = 248;
const CARD_H = 176;
/** Vertical breathing room between a new decompose cluster and whatever sits
 *  above it — the objective head, or a previous generation. */
const GAP_BELOW = 120;

/** Lay the cards out as a swimlane × causal-layer systems graph, wire their
 *  directed connections, frame each subsystem cluster as its OWN forked
 *  sys-frame tethered back to `opts.sourceShapeId` (the action node — the
 *  resolve-pill, the objective card — passed through the dispatch event), so
 *  the board reads as a flow chart of sibling subsystems rather than ONE flat
 *  Decomposition blob. Returns the created card shape ids. */
export function deployOcCards(
  editor: Editor,
  cards: DeployCard[],
  links: DeployLink[],
  opts?: {
    /** Shape the deploy was forked OUT of (resolve-pill, objective, …). When
     *  absent we fall back to the objective/room card so the tether still draws. */
    sourceShapeId?: TLShapeId | string | null;
  },
): TLShapeId[] {
  if (cards.length === 0) return [];

  // ── Causal direction. "feeds" flows from→to (a feature drives a variable);
  //    "depends_on" flows to→from (the variable is an input the feature
  //    needs). Normalizing here means every edge points downstream, so the
  //    layering + arrows read strictly left→right. ──
  const edges = links
    .map((l) =>
      l.relation === "depends_on"
        ? { from: l.toObjectId, to: l.fromObjectId }
        : { from: l.fromObjectId, to: l.toObjectId },
    )
    .filter((e) => e.from !== e.to);

  const layout = layoutSystemsGraph(
    cards.map((c) => ({ id: c.objectId, subsystem: c.subsystem || "Core" })),
    edges,
    { cardW: CARD_W, cardH: CARD_H, startX: 0, startY: 0 },
  );

  const vp = editor.getViewportPageBounds();

  // Baseline: drop the cluster BELOW the objective + sharpening head cards so it
  // reads as a downstream layer (not piling on top of them).
  const headBottoms = editor
    .getCurrentPageShapes()
    .filter(
      (s) =>
        s.type === "objective-card" ||
        s.type === "room-card" ||
        s.type === "prompt-sharpening",
    )
    .map((s) => editor.getShapePageBounds(s.id)?.maxY)
    .filter((v): v is number => typeof v === "number");
  const preferredTop =
    headBottoms.length > 0 ? Math.max(...headBottoms) + GAP_BELOW : vp.center.y;

  // Hybrid push-then-yield: reserve a clear region for the WHOLE systems graph,
  // pushing earlier generations aside or relocating the cluster — never on top.
  // sinkX is one layer-pitch past the rightmost card; pad the left for the
  // swimlane labels (they sit ~8px left of the cards) and use the graph's full
  // height so the reservation covers every lane.
  const graphH =
    Math.max(CARD_H, ...[...layout.pos.values()].map((p) => p.y + CARD_H));
  const spot = reserveSpace(
    editor,
    { w: layout.sinkX + 16, h: graphH },
    { anchorMidX: vp.center.x, preferredTop, gap: GAP_BELOW },
  );
  const anchorX = spot.x + 8;
  const anchorY = spot.y;

  const idByObject = new Map<string, TLShapeId>();
  const cardIds: TLShapeId[] = [];
  const allCreated: TLShapeId[] = [];
  /** subsystem name → its card shape ids (drives the per-lane frame below). */
  const cardIdsBySubsystem = new Map<string, TLShapeId[]>();

  // ── Feature / Variable oc-cards at their swimlane × layer position. ──
  for (const c of cards) {
    const p = layout.pos.get(c.objectId);
    if (!p) continue;
    const id = createShapeId();
    idByObject.set(c.objectId, id);
    cardIds.push(id);
    allCreated.push(id);
    const sub = c.subsystem || "Core";
    const bucket = cardIdsBySubsystem.get(sub);
    if (bucket) bucket.push(id);
    else cardIdsBySubsystem.set(sub, [id]);
    editor.createShape<OcCardShape>({
      id,
      type: "oc-card",
      x: anchorX + p.x,
      y: anchorY + p.y,
      props: {
        w: CARD_W,
        h: CARD_H,
        kind: c.kind,
        name: c.name,
        body: c.body,
        objectId: c.objectId,
        metaCount: 0,
      },
    });
  }

  // ── Directed dependency wires — the REAL flow-connector (green-out / pink-in
  //    ports + green→pink gradient), source → target downstream. A board reactor
  //    keeps them synced so they move with the cards. Replaces the old native
  //    grey arrows for ONE consistent connector style across the board. ──
  for (const e of edges) {
    const a = idByObject.get(e.from);
    const b = idByObject.get(e.to);
    if (!a || !b) continue;
    const wireId = deployFlowConnector(editor, a, b);
    if (wireId) allCreated.push(wireId);
  }

  // ── Per-subsystem grouping underlays + fork connectors ──
  //    Each subsystem cluster gets its OWN sys-frame, folder-tab labelled with
  //    the subsystem name and accent-rotated so siblings read as distinct
  //    systems. Every frame tethers back to `opts.sourceShapeId` (the action
  //    node — the resolve-pill, the objective card) instead of all hanging off
  //    the objective. The frame goes to the back inside the helper.
  const fallbackSource =
    editor.getCurrentPageShapes().find((s) => s.type === "objective-card")?.id ??
    editor.getCurrentPageShapes().find((s) => s.type === "room-card")?.id ??
    null;
  const tether = opts?.sourceShapeId ?? fallbackSource;
  let laneIndex = 0;
  for (const lane of layout.lanes) {
    const memberIds = cardIdsBySubsystem.get(lane.subsystem) ?? [];
    if (memberIds.length === 0) continue;
    const accent =
      SUBSYSTEM_ACCENTS[laneIndex % SUBSYSTEM_ACCENTS.length];
    const frameId = frameForkedGroup(editor, {
      childIds: memberIds,
      sourceShapeId: tether,
      label: lane.subsystem,
      accent,
    });
    if (frameId) {
      // Tag the frame with its subsystem identity so a follow-up deploy can
      // dedup (find-the-existing-frame) instead of stacking duplicates.
      editor.updateShape({
        id: frameId,
        type: "sys-frame",
        meta: {
          forkGroup: true,
          sourceShapeId: tether ? String(tether) : "",
          memberIds: memberIds.map(String),
          subsystem: lane.subsystem,
        },
      });
      allCreated.push(frameId);
    }
    laneIndex += 1;
  }

  if (allCreated.length > 0) {
    editor.select(...allCreated);
    // Zoom with a generous inset so the cluster (esp. the left-edge swimlane
    // labels) clears the floating board chrome — Home/Goal/History/Settings
    // pills on the left, Library/Powerups on the right — instead of tucking
    // under it.
    const bounds = editor.getSelectionPageBounds();
    if (bounds) {
      editor.zoomToBounds(bounds, { inset: 130, animation: { duration: 300 } });
    } else {
      editor.zoomToSelection({ animation: { duration: 300 } });
    }
    editor.selectNone();
  }
  return cardIds;
}
