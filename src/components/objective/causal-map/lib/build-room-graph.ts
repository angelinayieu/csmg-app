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
// are deterministic and faithful to the mockup, so there's no value in
// running dagre (which would minimize crossings but scramble the lanes).

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

/** The LLM-named mechanism (specific lever) lives on
 *  agent_feedback.mechanism — render it as the edge's mediator pill. */
function readMechanism(
  agentFeedback: Record<string, unknown> | null | undefined,
): string | null {
  if (!agentFeedback || typeof agentFeedback !== "object") return null;
  const m = (agentFeedback as Record<string, unknown>).mechanism;
  return typeof m === "string" && m.trim().length > 0
    ? m.trim().slice(0, 60)
    : null;
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
  let colX = ROOM_LEFT;
  let maxRows = 0;

  for (const lane of present) {
    const kind = LANE_TO_KIND[lane.slug] ?? "feature";
    lane.items.forEach((item, i) => {
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
        position: { x: colX, y: ROOM_TOP + i * (ROOM_NODE_H + ROOM_ROW_GAP) },
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
    maxRows = Math.max(maxRows, lane.items.length);
    colX += ROOM_NODE_W + ROOM_COL_GAP;
  }

  // Edges — only those connecting two nodes present in this room.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const mapEdges: CausalMapEdge[] = edges
    .filter(
      (e) =>
        nodeIds.has(e.source_entity_id) && nodeIds.has(e.target_entity_id),
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
        // De-noise: the relationship verb ("addressed by" / "produces" /
        // "rolls up to" / "composes with") is redundant — the lane columns
        // AND the top legend banner already state the chain direction, so
        // repeating it on every edge is pure clutter. Drop it. The
        // mechanism content (mediator) carries the real signal and stays;
        // the raw verb still lives on e.relationship_type for any consumer
        // that needs the slug.
        label: null,
        mediator: readMechanism(e.agent_feedback),
        delayed: false,
        source: "local" as const,
        loopId: null,
      },
    }));

  const width = Math.max(colX - ROOM_COL_GAP + ROOM_LEFT, 720);
  const height = ROOM_TOP + maxRows * (ROOM_NODE_H + ROOM_ROW_GAP) + 48;

  return { nodes, edges: mapEdges, columns, width, height };
}
