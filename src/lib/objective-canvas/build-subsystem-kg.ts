// ── build-subsystem-kg ─────────────────────────────────────────────
//
// Pure transform that SCOPES a room down to ONE mechanism's
// problem → mechanism → solution triad, so the existing room Map
// renderer (RoomAltitudeMap / buildRoomGraph) draws it as a focused,
// "specialized" knowledge graph for that single subsystem component.
//
// Why this (and why it's tiny): the room already stores the whole
// pain→feature→outcome causal spine as `lanes` + `edges`, and
// `buildRoomGraph` is a PURE transform over exactly those two inputs
// (its `isFlowEdge` keeps only one-lane-forward spine edges). So to get
// a per-mechanism KG we don't fork the renderer — we hand it a
// pre-filtered slice of lanes+edges containing only:
//
//     { upstream pains }  →  { the mechanism }  →  { downstream outcomes }
//
// The mechanism node still deep-links / opens its drawer (which already
// hosts the internal `runtime_flow` data-flow DAG), so "expand the
// mechanism's internals" needs no new surface.
//
// DELIBERATELY collision-safe: a NEW file that consumes the existing
// RoomLane/RoomEdge types and feeds the existing <RoomAltitudeMap> as a
// black box — zero edits to the (parallel-session-owned) room view,
// build-room-graph.ts, or build-subsystem-modules.ts.

import type {
  RoomLane,
  RoomEdge,
} from "@/components/objective/sub-objective-room-view";

/** A room sliced to a single mechanism's problem→mechanism→solution
 *  triad. `lanes`/`edges` are drop-in inputs for <RoomAltitudeMap>. */
export interface ScopedSubsystemKg {
  /** Filtered lanes (same slugs/labels/colors; items pared to the
   *  triad). Empty lanes are preserved — buildRoomGraph drops them. */
  lanes: RoomLane[];
  /** Edges whose BOTH endpoints survive the scope. */
  edges: RoomEdge[];
  /** The focus mechanism id, or null when it isn't in the features lane. */
  mechanismId: string | null;
  /** Display name of the focus mechanism, when found. */
  mechanismName: string | null;
  /** Upstream pain ids that drive the mechanism (the "problem" column). */
  problemIds: string[];
  /** Downstream outcome/objective ids the mechanism drives (the
   *  "solution" column). */
  solutionIds: string[];
  /** Sibling mechanism ids included for context (empty unless
   *  `includeSiblings` + `siblingIds` are supplied). */
  siblingIds: string[];
}

const FEATURES = "features" as const;
const PAIN = "pain" as const;
const SOLUTION_LANES = new Set<RoomLane["slug"]>(["outcomes", "objective"]);

/** Filter a lane to a given id set, preserving lane metadata. */
function laneWith(lane: RoomLane, keep: Set<string>): RoomLane {
  return { ...lane, items: lane.items.filter((it) => keep.has(it.id)) };
}

/**
 * Scope a room's lanes+edges to one mechanism's
 * problem → mechanism → solution triad.
 *
 * - problems  = pain-lane items with an edge `pain → mechanism`
 * - solutions = outcome/objective-lane items with an edge `mechanism → out`
 * - siblings  = optional peer mechanisms (e.g. token-wired neighbors) to
 *               render as dimmed context; off by default for a strict triad.
 *
 * Pure. Never mutates input. Returns empty-but-valid lanes when the
 * mechanism id isn't present, so the caller can render a clean empty
 * state rather than crash.
 */
export function scopeRoomToMechanism(input: {
  lanes: RoomLane[];
  edges: RoomEdge[];
  mechanismId: string;
  includeSiblings?: boolean;
  siblingIds?: string[];
}): ScopedSubsystemKg {
  const { lanes, edges, mechanismId } = input;

  const featuresLane = lanes.find((l) => l.slug === FEATURES);
  const focus = featuresLane?.items.find((it) => it.id === mechanismId) ?? null;

  // Which lane a given id sits in (for direction-correct neighbor lookup).
  const laneSlugOf = new Map<string, RoomLane["slug"]>();
  for (const lane of lanes) {
    for (const it of lane.items) laneSlugOf.set(it.id, lane.slug);
  }

  const problems = new Set<string>();
  const solutions = new Set<string>();

  if (focus) {
    for (const e of edges) {
      // problem → mechanism : pain item feeding the focus
      if (
        e.target_entity_id === mechanismId &&
        laneSlugOf.get(e.source_entity_id) === PAIN
      ) {
        problems.add(e.source_entity_id);
      }
      // mechanism → solution : focus feeding an outcome/objective item
      if (
        e.source_entity_id === mechanismId &&
        SOLUTION_LANES.has(laneSlugOf.get(e.target_entity_id) ?? FEATURES)
      ) {
        solutions.add(e.target_entity_id);
      }
    }
  }

  // Sibling mechanisms (peer levers) only when asked for AND present in
  // the features lane — never invent nodes the room doesn't have.
  const siblings = new Set<string>();
  if (focus && input.includeSiblings && input.siblingIds?.length) {
    const featureIds = new Set(featuresLane?.items.map((it) => it.id) ?? []);
    for (const sid of input.siblingIds) {
      if (sid !== mechanismId && featureIds.has(sid)) siblings.add(sid);
    }
  }

  // Build the surviving node set + the per-lane keep filter.
  const keepFeatures = new Set<string>(focus ? [mechanismId, ...siblings] : []);
  const nodeSet = new Set<string>([
    ...problems,
    ...keepFeatures,
    ...solutions,
  ]);

  const scopedLanes: RoomLane[] = lanes.map((lane) => {
    if (lane.slug === PAIN) return laneWith(lane, problems);
    if (lane.slug === FEATURES) return laneWith(lane, keepFeatures);
    if (SOLUTION_LANES.has(lane.slug)) return laneWith(lane, solutions);
    return { ...lane, items: [] };
  });

  const scopedEdges: RoomEdge[] = edges.filter(
    (e) => nodeSet.has(e.source_entity_id) && nodeSet.has(e.target_entity_id),
  );

  return {
    lanes: scopedLanes,
    edges: scopedEdges,
    mechanismId: focus ? mechanismId : null,
    mechanismName: focus?.name ?? null,
    problemIds: [...problems],
    solutionIds: [...solutions],
    siblingIds: [...siblings],
  };
}
