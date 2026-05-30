// ── Canvas-altitude graph builder ─────────────────────────────────
//
// Phase 12.A (12.A.2). Pure transform: the data the main canvas already
// server-renders (MainCanvasSub[] + ObjectiveStack + CrossRoomSignals)
// → a CanvasGraph (nodes + edges + layer bands) the React Flow renderer
// consumes. NO positioning here — useLayoutAlgorithm owns x/y so the
// layout engine stays swappable (KG seam #3).
//
// Edges at canvas altitude come from CrossRoomSignals: when two
// sub-objectives share a mechanism / root cause / lens, that's a
// cross-room association. We render it as a (gray, neutral-polarity)
// directed edge, directed substrate→outcome by layer ordinal so the
// "energy rises through the stack" reading holds and loop detection has
// a consistent orientation. These are associations, not signed causes —
// hence neutral. Signed/causal edges arrive when chain enrichment
// (Phase 11.4) data is threaded in (future).

import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { computeLayerPositionLabel } from "@/lib/objective-canvas/layer-model";
import { healthBandOf } from "./visual-grammar";
import type {
  CanvasGraph,
  CausalMapNode,
  CausalMapEdge,
  CausalMapNodeData,
  LayerBandSpec,
} from "./types";

/** The layer a node "lands" on: the most emergent (highest-ordinal)
 *  layer it touches. A sub-objective that bridges L2→L3 delivers its
 *  effect at L3, so it renders in the L3 band; its span is communicated
 *  by the layerPositionLabel chip. Returns 0 ("Unplaced") when the node
 *  carries no ordinals. CENTRALIZED so graph-build (uncovered calc) and
 *  the layout hook (placement) never diverge. */
export function primaryOrdinalOf(ordinals: number[] | undefined): number {
  if (!ordinals || ordinals.length === 0) return 0;
  return Math.max(...ordinals);
}

/** Health proxy for a sub-objective at canvas altitude. Combines lane
 *  coverage (structural breadth) with approved-play volume (validated
 *  work). Returns undefined when the room has no signal at all → the
 *  node renders "Unscored" rather than misleadingly "weak". */
function subHealth(sub: MainCanvasSub): number | undefined {
  const lanes = sub.laneTotalCounts;
  const lanesCovered = [lanes.friction, lanes.mechanism, lanes.result].filter(
    (n) => n > 0,
  ).length;
  const hasAnySignal =
    sub.approvedPlayCount > 0 ||
    lanesCovered > 0 ||
    sub.approvedItems.length > 0;
  if (!hasAnySignal) return undefined;
  const coverage = lanesCovered / 3;
  const playScore = Math.min(1, sub.approvedPlayCount / 3);
  return 0.5 * coverage + 0.5 * playScore;
}

interface BuildInput {
  spaceId: string;
  subs: MainCanvasSub[];
  objectiveStack?: ObjectiveStack | null;
  crossRoomSignals?: CrossRoomSignals | null;
  /** Cap on cross-room edges to keep the canvas readable (anti-pattern:
   *  rendering an edge per finding). Top-N by strength. */
  maxEdges?: number;
}

export function buildCanvasGraph(input: BuildInput): CanvasGraph {
  const { spaceId, subs, objectiveStack, crossRoomSignals } = input;
  // De-noise default: the prior 24-edge ceiling let a 10-card canvas
  // approach bipartite-complete (every L_n card wired to every L_{n+1}
  // card), which reads as a mesh. 14 keeps the load-bearing thread visible
  // and trims the long tail of weak co-occurrences. Hover-to-trace
  // surfaces the rest on demand.
  const maxEdges = input.maxEdges ?? 14;
  const hasLayerStack = !!objectiveStack && objectiveStack.layers.length > 0;

  // ── Nodes ──────────────────────────────────────────────────────────
  const nodes: CausalMapNode[] = subs.map((sub) => {
    const ordinals = Array.isArray(sub.layerOrdinals) ? sub.layerOrdinals : [];
    const health = subHealth(sub);
    const data: CausalMapNodeData = {
      kind: "sub_objective",
      title: sub.title,
      subtitle: sub.topNegativeOutcome
        ? `Counters: ${sub.topNegativeOutcome}`
        : null,
      layerOrdinals: ordinals,
      layerPositionLabel:
        sub.layerPositionLabel ??
        (ordinals.length > 0 ? computeLayerPositionLabel(ordinals) : null),
      health,
      healthBand: healthBandOf(health),
      approvedCount: sub.approvedPlayCount,
      // Per-sub method tier lives at item altitude; canvas altitude
      // doesn't aggregate it yet. Wired when chain_strength is threaded.
      methodTier: null,
      methodScore: null,
      href: `/app/objective/${spaceId}/sub/${sub.id}`,
      // KG seam #1 — populated when canonical resolution is threaded.
      canonicalConceptId: null,
    };
    return {
      id: sub.id,
      type: "subObjective",
      position: { x: 0, y: 0 }, // layout hook overwrites
      data,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  // ── Bands ──────────────────────────────────────────────────────────
  // One band per ObjectiveStack layer. "uncovered" = no node lands here
  // under the primary-ordinal rule → drives the pulsing "⚠ uncovered"
  // affordance. y/height are placeholders; the layout hook finalizes.
  const placedOrdinals = new Set<number>();
  for (const sub of subs) {
    placedOrdinals.add(primaryOrdinalOf(sub.layerOrdinals));
  }

  const bands: LayerBandSpec[] = [];
  if (hasLayerStack) {
    for (const layer of objectiveStack!.layers) {
      bands.push({
        ordinal: layer.ordinal,
        id: layer.id,
        name: layer.name,
        archetype: layer.archetype,
        y: 0,
        height: 0,
        uncovered: !placedOrdinals.has(layer.ordinal),
      });
    }
  }
  // Synthetic "Unplaced" band only when some node lacks ordinals.
  if (placedOrdinals.has(0)) {
    bands.push({
      ordinal: 0,
      id: "L0",
      name: "Unplaced",
      archetype: "substrate",
      y: 0,
      height: 0,
      uncovered: false,
    });
  }

  // ── Edges (cross-room associations) ──────────────────────────────────
  const edges = buildCrossRoomEdges(crossRoomSignals, nodeIds, subs, maxEdges);

  return { nodes, edges, bands, hasLayerStack };
}

/** Turn CrossRoomSignals into deduped pairwise edges between
 *  sub-objectives, directed substrate→outcome by primary ordinal,
 *  capped to top-N by strength. */
function buildCrossRoomEdges(
  signals: CrossRoomSignals | null | undefined,
  nodeIds: Set<string>,
  subs: MainCanvasSub[],
  maxEdges: number,
): CausalMapEdge[] {
  if (!signals) return [];

  const ordinalById = new Map<string, number>();
  for (const s of subs) ordinalById.set(s.id, primaryOrdinalOf(s.layerOrdinals));

  // Accumulate per unordered pair.
  interface Acc {
    a: string;
    b: string;
    strength: number;
    labels: Set<string>;
  }
  const pairs = new Map<string, Acc>();

  const allSignals = [
    ...signals.mechanisms,
    ...signals.root_causes,
    ...signals.lens_convergence,
  ];

  for (const sig of allSignals) {
    const ids = sig.sub_objective_ids.filter((id) => nodeIds.has(id));
    const strength = Math.min(1, sig.occurrence_count / 8);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [x, y] = [ids[i], ids[j]];
        const key = [x, y].sort().join("::");
        const acc = pairs.get(key) ?? {
          a: x,
          b: y,
          strength: 0,
          labels: new Set<string>(),
        };
        acc.strength = Math.max(acc.strength, strength);
        if (sig.label) acc.labels.add(sig.label);
        pairs.set(key, acc);
      }
    }
  }

  // Strength floor (0.18) drops the long tail of single-overlap
  // associations — those add visual edges without adding signal. The
  // top-N cap then enforces a hard readability ceiling. Together they
  // turn "every pairing that ever co-occurred" into "the load-bearing
  // few"; the rest are still discoverable via hover-to-trace.
  const ranked = [...pairs.values()]
    .filter((p) => p.strength >= 0.18)
    .sort((p, q) => q.strength - p.strength)
    .slice(0, maxEdges);

  return ranked.map((acc) => {
    // Direct substrate→outcome: lower primary ordinal is the source.
    const oa = ordinalById.get(acc.a) ?? 0;
    const ob = ordinalById.get(acc.b) ?? 0;
    const [source, target] =
      oa <= ob ? [acc.a, acc.b] : [acc.b, acc.a];
    const labelArr = [...acc.labels];
    const label =
      labelArr.length === 0
        ? null
        : labelArr.length === 1
          ? labelArr[0]
          : `${labelArr[0]} +${labelArr.length - 1}`;
    return {
      id: `xr:${source}->${target}`,
      source,
      target,
      type: "causalMap",
      data: {
        kind: "cross_room",
        polarity: "neutral",
        strength: acc.strength,
        label,
        mediator: null,
        delayed: false,
        source: "local", // KG seam #2
        loopId: null,
      },
    } satisfies CausalMapEdge;
  });
}
