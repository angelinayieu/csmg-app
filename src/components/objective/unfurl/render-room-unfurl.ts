"use client";

// ── syncRoomUnfurl ──
//
// The room phase of the unfurl (depth 3–5). When the dial passes into a
// room, the canvas-level shapes clear and the focused room's internals
// take over:
//
//   depth 3 (Levers) → the room's pains · mechanisms · outcomes as cards
//   depth 4 (Plays)  → + the causal-chain arrows between them
//   depth 5 (Proof)  → unvalidated levers dim out; the proven path stands
//
// Consumes buildRoomGraph output ({ nodes, edges } — nodes already
// positioned in pain→feature→outcome columns). Reuses `artifact-card` for
// the room items + the shared arrow helper. Idempotent via meta.unfurl, so
// it cleanly replaces the canvas phase and reverses when scrubbing back.

import { type Editor, type TLShapeId } from "tldraw";
import type {
  CausalMapNode,
  CausalMapEdge,
  CausalMapNodeKind,
} from "@/components/objective/causal-map/lib/types";
import type { ArtifactCardShape } from "@/components/objective/shapes/artifact-card-shape";
import type { RoomCardShape } from "@/components/objective/shapes/room-card-shape";
import { createUnfurlArrow } from "./render-canvas-unfurl";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** What syncRoomUnfurl needs — a subset of buildRoomGraph's RoomGraph. */
export interface RoomUnfurlGraph {
  nodes: CausalMapNode[];
  edges: CausalMapEdge[];
}

const NODE_W = 248;
const NODE_H = 158;
const COL_GAP = 64;
const ROW_GAP = 30;
const HEAD_W = 320;
const HEAD_H = 188;
const HEAD_Y = 0;
const ROOM_TOP = HEAD_H + 64;
const CENTER_X = 720;

function rid(s: string): TLShapeId {
  return `shape:unfurl-r-${s.replace(/[^a-zA-Z0-9_-]/g, "_")}` as TLShapeId;
}
const HEAD_ID = rid("head");
const rNodeId = (raw: string) => rid(`node-${raw}`);
const rEdgeId = (raw: string) => rid(`edge-${raw}`);

function isUnfurl(s: { meta?: Record<string, unknown> }): boolean {
  return !!s.meta?.unfurl;
}

type ArtifactKind = ArtifactCardShape["props"]["kind"];
function toArtifactKind(k: CausalMapNodeKind): ArtifactKind {
  if (k === "pain") return "pain";
  if (k === "outcome") return "outcome";
  return "feature"; // feature / mediator / variation
}
function nodeColor(k: CausalMapNodeKind): string {
  const ak = toArtifactKind(k);
  return ak === "pain"
    ? appleVibe.stage.pain
    : ak === "outcome"
      ? appleVibe.stage.outcomes
      : appleVibe.stage.features;
}

export interface RoomUnfurlOpts {
  roomTitle?: string;
  roomId?: string;
}

export function syncRoomUnfurl(
  editor: Editor,
  room: RoomUnfurlGraph,
  depth: number,
  opts: RoomUnfurlOpts = {},
): void {
  const nodes = room.nodes;
  // Lay out in three lane columns (pain → mechanism → outcome) sized for
  // OUR cards. buildRoomGraph's own coordinates assume smaller react-flow
  // nodes and collide at this scale, so we position here.
  const colOf = (k: CausalMapNode["data"]["kind"]): number =>
    k === "pain" ? 0 : k === "outcome" ? 2 : 1;
  const COL_PITCH = NODE_W + COL_GAP;
  const ROW_PITCH = NODE_H + ROW_GAP;
  const totalW = 3 * NODE_W + 2 * COL_GAP;
  const startX = CENTER_X - totalW / 2;
  const rowCursor: [number, number, number] = [0, 0, 0];
  const posMap = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const c = colOf(n.data.kind);
    const r = rowCursor[c]++;
    posMap.set(n.id, {
      x: startX + c * COL_PITCH,
      y: ROOM_TOP + r * ROW_PITCH,
    });
  }
  const posOf = (n: CausalMapNode) =>
    posMap.get(n.id) ?? { x: startX, y: ROOM_TOP };

  // ── desired ids ──
  const desired = new Set<TLShapeId>([HEAD_ID]);
  if (depth >= 3) for (const n of nodes) desired.add(rNodeId(n.id));
  if (depth >= 4) for (const e of room.edges) desired.add(rEdgeId(e.id));

  // ── delete what's no longer wanted (incl. the whole canvas phase) ──
  const existing = editor.getCurrentPageShapes().filter(isUnfurl);
  const toDelete = existing.filter((s) => !desired.has(s.id)).map((s) => s.id);
  if (toDelete.length) editor.deleteShapes(toDelete);
  const has = (id: TLShapeId) => !!editor.getShape(id);

  // ── room header (always in this phase) ──
  if (!has(HEAD_ID)) {
    editor.createShape<RoomCardShape>({
      id: HEAD_ID,
      type: "room-card",
      x: CENTER_X - HEAD_W / 2,
      y: HEAD_Y,
      props: {
        w: HEAD_W,
        h: HEAD_H,
        title: opts.roomTitle?.trim() || "Room",
        subtitle: "The room's pains, mechanisms, and outcomes.",
        color: appleVibe.stage.objective,
        roomId: opts.roomId ?? "__room",
        chips: [`${nodes.length} items`],
      },
      meta: { unfurl: true, compact: true },
    });
  }

  // ── room item nodes (depth ≥ 3) ──
  if (depth >= 3) {
    for (const n of nodes) {
      const id = rNodeId(n.id);
      if (!has(id)) {
        const p = posOf(n);
        editor.createShape<ArtifactCardShape>({
          id,
          type: "artifact-card",
          x: p.x,
          y: p.y,
          props: {
            w: NODE_W,
            h: NODE_H,
            kind: toArtifactKind(n.data.kind),
            title: n.data.title,
            subtitle: n.data.subtitle ?? "",
            color: nodeColor(n.data.kind),
            entityId: n.id,
            roomId: opts.roomId ?? "__room",
          },
          meta: { unfurl: true, compact: true },
        });
      }
      // ── Proof (depth ≥ 5): dim levers with no evaluation method, so the
      //    validated path stands out. Reset at lower depths.
      const want = depth >= 5 ? (n.data.methodTier ? 1 : 0.42) : 1;
      const cur = editor.getShape(id);
      if (cur && cur.opacity !== want) {
        editor.updateShape({ id, type: "artifact-card", opacity: want });
      }
    }
  }

  // ── causal-chain arrows (depth ≥ 4) ──
  if (depth >= 4) {
    for (const e of room.edges) {
      const id = rEdgeId(e.id);
      if (has(id)) continue;
      const fromId = rNodeId(e.source);
      const toId = rNodeId(e.target);
      if (!editor.getShape(fromId) || !editor.getShape(toId)) continue;
      createUnfurlArrow(editor, id, fromId, toId, e.data?.polarity ?? "neutral");
    }
  }
}

// ── Mock room graph (preflight verification only) ─────────────────
export function mockRoomGraph(): RoomUnfurlGraph {
  const n = (
    id: string,
    kind: CausalMapNodeKind,
    title: string,
    x: number,
    y: number,
    methodTier: CausalMapNode["data"]["methodTier"] = null,
  ): CausalMapNode => ({
    id,
    type: "roomItem",
    position: { x, y },
    data: {
      kind,
      title,
      subtitle: null,
      layerOrdinals: [],
      healthBand: "moderate",
      approvedCount: 0,
      methodTier,
    },
  });

  const nodes: CausalMapNode[] = [
    n("p1", "pain", "Afternoon energy crash", 0, 0),
    n("p2", "pain", "Doomscrolling pull", 0, 210),
    n("m1", "feature", "Reward-streak system", 330, 0, "rubric"),
    n("m2", "feature", "Adaptive difficulty", 330, 210),
    n("o1", "outcome", "Daily-return habit", 660, 0, "simulated"),
    n("o2", "outcome", "Deeper engagement", 660, 210),
  ];

  const e = (
    id: string,
    source: string,
    target: string,
    polarity: "positive" | "negative" | "neutral",
  ): CausalMapEdge => ({
    id,
    source,
    target,
    data: { kind: "causal_chain", polarity, strength: 0.6, source: "local" },
  });

  return {
    nodes,
    edges: [
      e("c1", "p1", "m1", "positive"),
      e("c2", "m1", "o1", "positive"),
      e("c3", "p2", "m2", "positive"),
      e("c4", "m2", "o2", "positive"),
      e("c5", "m1", "o2", "neutral"),
    ],
  };
}
