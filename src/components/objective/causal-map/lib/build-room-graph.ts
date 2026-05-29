// ── Room-altitude graph builder ───────────────────────────────────
//
// Phase 12.A (12.A.4). Pure transform: the room's lanes + edges (the
// data SubObjectiveRoomView already has) → a lane-column Causal Loop
// Diagram. Pain → Mechanism → Outcome read left-to-right as columns
// (matching the room's existing 3-lane mental model + the §17.4 L1
// mockup); edges carry polarity + strength + a mediator pill drawn from
// the LLM-named mechanism on agent_feedback.
//
// Unlike the canvas builder, positions ARE assigned here: lane columns
// are deterministic and faithful to the mockup. We DON'T run dagre (it
// would scramble the lanes), but we DO run a lightweight barycenter pass
// that reorders the rows WITHIN each fixed lane so connected cards line up
// vertically — that's what kills the criss-cross spaghetti without moving
// a single node out of its causal stage. Each lane is then vertically
// centered so short lanes don't strand their wires at a steep diagonal.

import type { RoomLane, RoomEdge } from "@/components/objective/sub-objective-room-view";
import type {
  CausalMapNode,
  CausalMapEdge,
  CausalMapNodeKind,
  CausalMapNodeData,
  EdgePolarity,
} from "./types";
import {
  ROOM_NODE_W,
  ROOM_NODE_H,
  ROOM_COL_GAP,
  ROOM_ROW_GAP,
  ROOM_TOP,
  ROOM_LEFT,
} from "./visual-grammar";

/** Lane render order, left → right. */
const LANE_ORDER: ReadonlyArray<RoomLane["slug"]> = [
  "pain",
  "features",
  "outcomes",
  "objective",
];

const LANE_TO_KIND: Record<RoomLane["slug"], CausalMapNodeKind> = {
  pain: "pain",
  features: "feature",
  outcomes: "outcome",
  objective: "outcome",
};

export interface LaneColumnSpec {
  slug: RoomLane["slug"];
  label: string;
  color: string;
  /** Left edge of the column, in flow coords. */
  x: number;
  width: number;
  itemCount: number;
}

export interface RoomGraph {
  nodes: CausalMapNode[];
  edges: CausalMapEdge[];
  columns: LaneColumnSpec[];
  width: number;
  height: number;
}

function clamp01(n: number | null | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.4;
  return Math.max(0, Math.min(1, n));
}

function polarityOf(p: string | null | undefined): EdgePolarity {
  const v = (p ?? "").toLowerCase();
  if (v === "positive") return "positive";
  if (v === "negative") return "negative";
  return "neutral"; // conditional / null / unknown
}

/** Short descriptor for a lane item — pulls the lane-appropriate field
 *  out of causal_chain, falling back to the description. */
function itemSubtitle(
  slug: RoomLane["slug"],
  causalChain: Record<string, unknown> | null | undefined,
  description: string | null,
): string | null {
  const cc = (causalChain ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null =>
    typeof cc[k] === "string" && (cc[k] as string).trim().length > 0
      ? (cc[k] as string).trim()
      : null;
  let raw: string | null = null;
  if (slug === "pain") raw = pick("negative_outcome");
  else if (slug === "features") raw = pick("positive_outcome");
  else if (slug === "outcomes") raw = pick("measured_by");
  raw = raw ?? description ?? null;
  return raw ? raw.slice(0, 96) : null;
}

function pushAdj(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** Sugiyama-style barycenter ordering, but lane-assignment is FIXED — we
 *  only permute the row order within each column so that vertically-near
 *  cards are the ones that connect. A few alternating sweeps converge fast
 *  for the handful of nodes a room holds, and crush edge crossings (the
 *  whole "why does everything route to everything" spaghetti effect).
 *  Nodes with no neighbor in the reference column hold their slot. */
function orderColumnsByBarycenter(
  columnIds: string[][],
  adjacency: Map<string, string[]>,
): string[][] {
  if (columnIds.length < 2) return columnIds.map((c) => [...c]);
  const cols = columnIds.map((c) => [...c]);

  const sweep = (dir: "lr" | "rl") => {
    const order =
      dir === "lr"
        ? cols.map((_, i) => i).slice(1)
        : cols.map((_, i) => i).slice(0, -1).reverse();
    for (const ci of order) {
      const ref = dir === "lr" ? cols[ci - 1] : cols[ci + 1];
      const refPos = new Map(ref.map((id, i) => [id, i]));
      const bary = new Map<string, number>();
      cols[ci].forEach((id, i) => {
        const neigh = (adjacency.get(id) ?? []).filter((n) => refPos.has(n));
        bary.set(
          id,
          neigh.length === 0
            ? i
            : neigh.reduce((acc, n) => acc + (refPos.get(n) ?? 0), 0) /
                neigh.length,
        );
      });
      cols[ci] = cols[ci]
        .map((id, i) => ({ id, i, b: bary.get(id) ?? i }))
        .sort((a, b) => a.b - b.b || a.i - b.i)
        .map((x) => x.id);
    }
  };

  for (let iter = 0; iter < 4; iter++) sweep(iter % 2 === 0 ? "lr" : "rl");
  return cols;
}

export function buildRoomGraph(input: {
  lanes: RoomLane[];
  edges: RoomEdge[];
  /** L1→L2 drill-down: when provided, feature/mechanism nodes deep-link
   *  to their existing Lab page. Omit → no node is navigable. */
  spaceId?: string;
  subObjectiveId?: string;
}): RoomGraph {
  const { lanes, edges, spaceId, subObjectiveId } = input;

  // Lanes in canonical order, only those that actually have items.
  const present = LANE_ORDER.map((slug) =>
    lanes.find((l) => l.slug === slug),
  ).filter((l): l is RoomLane => !!l && l.items.length > 0);

  const nodes: CausalMapNode[] = [];
  const columns: LaneColumnSpec[] = [];

  // Row-order each lane to minimize edge crossings — lane assignment stays
  // fixed; only the vertical order within a lane is permuted so connected
  // cards sit across from one another.
  const columnIds = present.map((lane) => lane.items.map((it) => it.id));

  // entity id → its column index among the present lanes (0 = leftmost).
  const laneIdxOf = new Map<string, number>();
  present.forEach((lane, idx) => {
    for (const it of lane.items) laneIdxOf.set(it.id, idx);
  });
  // A "flow" edge is a single forward step along the causal spine
  // (problem → mechanism → result → objective): the target sits exactly one
  // lane to the RIGHT of the source. Same-lane links (mechanism↔mechanism
  // "composes_with" sibling-synergy) and lane-skipping shortcuts (e.g. a
  // problem wired straight to a result) are NOT causal flow, so they're
  // excluded from the map — it tells the clean left→right story only. The
  // edges still live in the DB and surface as lateral chips/wires in the
  // card views; the Map just doesn't draw them. (NB: no analytical consumer
  // reads composes_with/interferes_with yet — that's a known opportunity.)
  const isFlowEdge = (sourceId: string, targetId: string): boolean => {
    const s = laneIdxOf.get(sourceId);
    const t = laneIdxOf.get(targetId);
    return s != null && t != null && t === s + 1;
  };

  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!isFlowEdge(e.source_entity_id, e.target_entity_id)) continue;
    pushAdj(adjacency, e.source_entity_id, e.target_entity_id);
    pushAdj(adjacency, e.target_entity_id, e.source_entity_id);
  }
  const ordered = orderColumnsByBarycenter(columnIds, adjacency);
  const rowOf = new Map<string, number>();
  ordered.forEach((col) => col.forEach((id, r) => rowOf.set(id, r)));

  const maxRows = Math.max(1, ...ordered.map((c) => c.length));
  const rowPitch = ROOM_NODE_H + ROOM_ROW_GAP;
  const colHeight = maxRows * rowPitch;

  let colX = ROOM_LEFT;
  present.forEach((lane, colIdx) => {
    const kind = LANE_TO_KIND[lane.slug] ?? "feature";
    // Center each lane vertically so a sparse lane floats at mid-height and
    // its wires arrive roughly level, instead of diving from the top edge.
    const colTop =
      ROOM_TOP + (colHeight - ordered[colIdx].length * rowPitch) / 2;
    lane.items.forEach((item) => {
      const r = rowOf.get(item.id) ?? 0;
      const data: CausalMapNodeData = {
        kind,
        title: item.name,
        subtitle: itemSubtitle(lane.slug, item.causal_chain, item.description),
        layerOrdinals: [],
        layerPositionLabel: null,
        health: undefined,
        healthBand: "unknown",
        approvedCount: 0,
        methodTier: null,
        methodScore: null,
        // Only mechanism (feature) nodes have a Lab page — "focused
        // evaluation for ONE mechanism" — so only they are the L1→L2
        // drill-down target. Pain/outcome nodes stay non-navigable.
        href:
          kind === "feature" && spaceId && subObjectiveId
            ? `/app/objective/${spaceId}/sub/${subObjectiveId}/lab/${item.id}`
            : null,
        canonicalConceptId: null,
      };
      nodes.push({
        id: item.id,
        type: "roomItem",
        position: { x: colX, y: colTop + r * rowPitch },
        data,
      });
    });
    columns.push({
      slug: lane.slug,
      label: lane.label,
      color: lane.color,
      x: colX,
      width: ROOM_NODE_W,
      itemCount: lane.items.length,
    });
    colX += ROOM_NODE_W + ROOM_COL_GAP;
  });

  // Edges — only those connecting two nodes present in this room.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const mapEdges: CausalMapEdge[] = edges
    .filter(
      (e) =>
        nodeIds.has(e.source_entity_id) &&
        nodeIds.has(e.target_entity_id) &&
        // Spine only: drop mechanism↔mechanism + lane-skipping links.
        isFlowEdge(e.source_entity_id, e.target_entity_id),
    )
    .map((e) => ({
      id: e.id,
      source: e.source_entity_id,
      target: e.target_entity_id,
      type: "causalMap",
      data: {
        kind: "causal_chain" as const,
        polarity: polarityOf(e.polarity),
        strength: clamp01(e.strength),
        // De-noise: render room edges as PURE WIRES — no label pills at
        // all. The relationship verb is already stated by the lane columns
        // + the top legend banner, and the mechanism/content detail lives
        // in the card's "Causal Mechanism" panel — so per-edge pills were
        // clutter. Drop both the verb (label) and the mechanism (mediator).
        // The raw data still lives on e.relationship_type / e.agent_feedback
        // for any consumer that needs it.
        label: null,
        mediator: null,
        delayed: false,
        source: "local" as const,
        loopId: null,
        // Resting wires read quiet; hovering a card pops its thread to full.
        calmRest: true,
      },
    }));

  const width = Math.max(colX - ROOM_COL_GAP + ROOM_LEFT, 720);
  const height = ROOM_TOP + maxRows * (ROOM_NODE_H + ROOM_ROW_GAP) + 48;

  return { nodes, edges: mapEdges, columns, width, height };
}
