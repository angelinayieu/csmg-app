// ── Systems layout for decomposed cards ─────────────────────────────
//
// Pure transform. Takes the decompose output (feature/variable nodes, each
// tagged with a subsystem) + DIRECTED dependency links, and returns board
// positions for a SWIMLANE × CAUSAL-LAYER layout:
//
//   • x  = causal layer (longest-path depth) → strict left→right dependency
//          flow, so an edge always points downstream. Sources (no inputs) on
//          the left; everything converges rightward on the objective sink.
//   • y  = subsystem swimlane → cohesive feature/variable clusters read as
//          one horizontal band, so structure (subsystems) is legible at a
//          glance and inter-lane arrows are the real architectural seams.
//
// Replaces the old "features in a left column, variables in a right column,
// undirected dashed lines" placer (deploy-oc-cards), which produced crossing
// spaghetti that showed neither direction nor grouping. Deterministic +
// dependency-free so it can drive both the preflight preview and the live
// decompose deploy.

export interface SysGraphNode {
  id: string;
  /** Cohesive cluster this node belongs to → its swimlane. */
  subsystem: string;
}

export interface SysGraphLink {
  /** Upstream node (produces / drives). */
  from: string;
  /** Downstream node (consumes / is driven). */
  to: string;
}

export interface SysLane {
  subsystem: string;
  top: number;
  height: number;
  centerY: number;
}

export interface SysGraphLayout {
  /** node id → top-left board position. */
  pos: Map<string, { x: number; y: number }>;
  /** Swimlane bands, top→down in first-appearance order. */
  lanes: SysLane[];
  /** Number of causal layers (columns). */
  layerCount: number;
  /** node id → its causal layer index. */
  layerOf: Map<string, number>;
  /** Left edge of the column ONE past the last card layer — where the
   *  objective sink sits. */
  sinkX: number;
  /** Vertical center across all lanes (objective sink anchors here). */
  centerY: number;
}

export interface SysLayoutOpts {
  cardW?: number;
  cardH?: number;
  /** Horizontal gap BETWEEN layer columns (added to cardW for the pitch). */
  layerGap?: number;
  /** Vertical gap between stacked rows within a lane (added to cardH). */
  rowGap?: number;
  /** Vertical gap between swimlanes. */
  laneGap?: number;
  startX?: number;
  startY?: number;
}

export function layoutSystemsGraph(
  nodes: SysGraphNode[],
  links: SysGraphLink[],
  opts: SysLayoutOpts = {},
): SysGraphLayout {
  const CARD_W = opts.cardW ?? 248;
  const CARD_H = opts.cardH ?? 176;
  const LAYER_PITCH = (opts.layerGap ?? 132) + CARD_W;
  const ROW_PITCH = (opts.rowGap ?? 44) + CARD_H;
  const LANE_GAP = opts.laneGap ?? 72;
  const START_X = opts.startX ?? 0;
  const START_Y = opts.startY ?? 0;

  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map<string, string[]>();
  for (const id of ids) preds.set(id, []);
  for (const l of links) {
    if (!ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue;
    preds.get(l.to)!.push(l.from);
  }

  // Longest-path layering (DAG; a visiting guard breaks any accidental cycle
  // so a back-edge just doesn't deepen the layer rather than looping forever).
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const computeLayer = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let lv = 0;
    for (const p of preds.get(id)!) lv = Math.max(lv, computeLayer(p) + 1);
    visiting.delete(id);
    layerOf.set(id, lv);
    return lv;
  };
  for (const id of ids) computeLayer(id);
  const layerCount =
    ids.size === 0 ? 0 : Math.max(...[...layerOf.values()]) + 1;

  // Swimlanes — subsystems in first-appearance order.
  const laneOrder: string[] = [];
  const laneMembers = new Map<string, SysGraphNode[]>();
  for (const n of nodes) {
    if (!laneMembers.has(n.subsystem)) {
      laneMembers.set(n.subsystem, []);
      laneOrder.push(n.subsystem);
    }
    laneMembers.get(n.subsystem)!.push(n);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const lanes: SysLane[] = [];
  let laneTop = START_Y;
  for (const sub of laneOrder) {
    const members = laneMembers.get(sub)!;
    // Bucket the lane's nodes by layer; multiple nodes in one (lane, layer)
    // cell stack vertically (top-aligned within the lane).
    const byLayer = new Map<number, SysGraphNode[]>();
    for (const m of members) {
      const lv = layerOf.get(m.id)!;
      (byLayer.get(lv) ?? byLayer.set(lv, []).get(lv)!).push(m);
    }
    const maxRows = Math.max(1, ...[...byLayer.values()].map((a) => a.length));
    const laneHeight = (maxRows - 1) * ROW_PITCH + CARD_H;
    for (const [lv, arr] of byLayer) {
      arr.forEach((m, i) => {
        pos.set(m.id, {
          x: START_X + lv * LAYER_PITCH,
          y: laneTop + i * ROW_PITCH,
        });
      });
    }
    lanes.push({
      subsystem: sub,
      top: laneTop,
      height: laneHeight,
      centerY: laneTop + laneHeight / 2,
    });
    laneTop += laneHeight + LANE_GAP;
  }

  const totalBottom = laneTop - LANE_GAP;
  return {
    pos,
    lanes,
    layerCount,
    layerOf,
    sinkX: START_X + layerCount * LAYER_PITCH,
    centerY: (START_Y + totalBottom) / 2,
  };
}
