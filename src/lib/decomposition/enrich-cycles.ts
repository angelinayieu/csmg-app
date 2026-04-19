// ── Tier 3 → cycle enrichment ──
// Cycles are LLM-traced in Tier 5 prose. Tier 3 independently identifies edges
// with dynamics="compounding" | "exponential" (edges that conceptually ARE parts
// of feedback loops even if the LLM didn't explicitly name the cycle). This pass
// cross-references the two:
//
//  1. Cycles containing a compounding/exponential edge get classification boosted
//     to "reinforcing_positive" or "reinforcing_negative" (depending on polarity)
//     if the LLM left them ambiguous, and are flagged as `tier3_verified`.
//
//  2. Orphan compounding/exponential edges (not part of any declared cycle) are
//     surfaced as "candidate cycles" — the LLM may have missed tracing them.
//
// This keeps the Tier 3 rigor we spent work preserving from being wasted in the
// cycle layer.

interface EdgeLike {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type?: string;
  dynamics?: string | null;
  polarity?: string;
  confidence?: number;
}

interface CycleLike {
  cycle_id?: string;
  name?: string;
  classification?: string;
  entity_ids: string[];
  growth_type?: string | null;
  /** Added by enrichment: set true when the cycle contains a compounding/exponential edge */
  tier3_verified?: boolean;
  /** Added by enrichment: human-readable note describing the Tier 3 cross-check */
  tier3_note?: string;
  [key: string]: unknown;
}

export interface CandidateCycle {
  edge: { source: string; target: string; dynamics: string };
  reason: string;
}

export interface CycleEnrichmentResult<T extends CycleLike> {
  enrichedCycles: T[];
  candidateCycles: CandidateCycle[];
  stats: {
    cyclesVerified: number;
    cyclesGrowthTypeBoosted: number;
    orphanCompoundingEdges: number;
  };
}

const FEEDBACK_DYNAMICS = new Set(["compounding", "exponential"]);
// A cycle containing an accelerating edge is inherently multiplicative/accelerating —
// we can boost growth_type when the LLM left it blank.
const GROWTH_BOOST_MAP: Record<string, string> = {
  compounding: "multiplicative",
  exponential: "accelerating",
};

function buildCycleEdgeKeys(cycle: CycleLike): Set<string> {
  const keys = new Set<string>();
  const n = cycle.entity_ids.length;
  if (n < 2) return keys;
  for (let i = 0; i < n; i++) {
    const src = cycle.entity_ids[i];
    const tgt = cycle.entity_ids[(i + 1) % n];
    keys.add(`${src}|${tgt}`);
  }
  return keys;
}

export function enrichCyclesWithTier3<T extends CycleLike>(
  cycles: T[],
  edges: EdgeLike[],
): CycleEnrichmentResult<T> {
  // Index feedback-dynamics edges by (src|tgt)
  const feedbackEdges = edges.filter((e) => {
    const d = (e.dynamics ?? "").toLowerCase();
    return FEEDBACK_DYNAMICS.has(d);
  });
  if (feedbackEdges.length === 0) {
    return {
      enrichedCycles: cycles,
      candidateCycles: [],
      stats: { cyclesVerified: 0, cyclesGrowthTypeBoosted: 0, orphanCompoundingEdges: 0 },
    };
  }

  const feedbackEdgeKeys = new Map<string, EdgeLike>();
  for (const e of feedbackEdges) {
    if (e.source_entity_id && e.target_entity_id) {
      feedbackEdgeKeys.set(`${e.source_entity_id}|${e.target_entity_id}`, e);
    }
  }

  // Track which feedback edges were matched to some cycle
  const matchedFeedbackKeys = new Set<string>();

  let cyclesVerified = 0;
  let cyclesGrowthTypeBoosted = 0;

  const enrichedCycles = cycles.map((cycle) => {
    const cycleEdgeKeys = buildCycleEdgeKeys(cycle);
    const overlaps: EdgeLike[] = [];
    for (const key of cycleEdgeKeys) {
      const fbEdge = feedbackEdgeKeys.get(key);
      if (fbEdge) {
        overlaps.push(fbEdge);
        matchedFeedbackKeys.add(key);
      }
    }
    if (overlaps.length === 0) return cycle;

    cyclesVerified += 1;

    // Boost growth_type if missing. Prefer the dynamics of the first overlapping edge.
    let growthTypeBoosted = false;
    const dynamicsOnCycle = overlaps.map((e) => (e.dynamics ?? "").toLowerCase()).filter(Boolean);
    if (!cycle.growth_type && dynamicsOnCycle.length > 0) {
      const dyn = dynamicsOnCycle[0];
      const boost = GROWTH_BOOST_MAP[dyn];
      if (boost) {
        growthTypeBoosted = true;
        cyclesGrowthTypeBoosted += 1;
      }
    }

    return {
      ...cycle,
      tier3_verified: true,
      tier3_note: `Contains ${overlaps.length} edge${overlaps.length === 1 ? "" : "s"} with feedback dynamics (${dynamicsOnCycle.join(", ")})`,
      ...(growthTypeBoosted
        ? { growth_type: GROWTH_BOOST_MAP[dynamicsOnCycle[0]] }
        : {}),
    };
  });

  // Orphan feedback edges → candidate cycles
  const candidateCycles: CandidateCycle[] = [];
  for (const [key, edge] of feedbackEdgeKeys) {
    if (matchedFeedbackKeys.has(key)) continue;
    // Only flag as candidate if we're confident enough this is a real cycle edge
    if (typeof edge.confidence === "number" && edge.confidence < 0.4) continue;
    candidateCycles.push({
      edge: {
        source: edge.source_entity_id,
        target: edge.target_entity_id,
        dynamics: (edge.dynamics ?? "").toLowerCase(),
      },
      reason: `Edge has ${edge.dynamics} dynamics but isn't part of any traced cycle — may be an untraced feedback loop`,
    });
  }

  return {
    enrichedCycles,
    candidateCycles,
    stats: {
      cyclesVerified,
      cyclesGrowthTypeBoosted,
      orphanCompoundingEdges: candidateCycles.length,
    },
  };
}
