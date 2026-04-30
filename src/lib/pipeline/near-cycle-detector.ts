// ── Near-cycle detector ──
//
// Phase 4 (research-strategy migration). Pure graph algorithm: given a
// space's entities + edges, find directed 3-cycles that are MISSING
// exactly one edge. Output is consumed by the cycle-closing pass,
// which then targets the missing edge with web search.
//
// A "near-cycle" here means: there exist directed edges A→B and B→C,
// but no edge C→A. If C→A turns out to be supported by literature,
// we have a complete causal cycle worth promoting into the `cycles`
// table.
//
// Why this matters: feedback loops are the highest-leverage structural
// feature in any KG (per the synthesis layer's leverage-points panel).
// Missing one edge of a real cycle = silent gap in the model. A
// dedicated detector + research pass closes that gap deterministically
// instead of hoping it surfaces during outcome_breadth.
//
// Scope discipline: this file is graph algorithm only — no LLM, no DB
// writes, no event emission. The route layer composes those.

export interface NearCycleEdge {
  source_entity_id: string;
  target_entity_id: string;
  /** confidence on the existing edge (0..1) — used for scoring. */
  confidence?: number;
}

export interface NearCycleEntity {
  id: string;
  name: string;
  /** Importance enum from the entities table — used to up-rank cycles
   *  involving fundamental/critical nodes. Optional for partial inputs. */
  importance?: "fundamental" | "critical" | "important" | "moderate" | string;
  /** Leverage / risk / bottleneck flags — these signal "this entity
   *  matters; a missing cycle through it is worth chasing". */
  is_leverage_point?: boolean;
  is_risk_point?: boolean;
  is_master_bottleneck?: boolean;
}

export interface NearCycle {
  /** Ordered entity IDs along the existing path: [a, b, c]. The
   *  missing edge to close the cycle is c → a. */
  entityIds: [string, string, string];
  entityNames: [string, string, string];
  /** The missing edge whose discovery would close the cycle. */
  missingEdge: { source_entity_id: string; target_entity_id: string };
  /** 0..1 ranking score. Higher = more worth investigating. */
  score: number;
  /** Plain-language description for the research prompt. Built from
   *  the involved entity names. */
  rationale: string;
}

export interface DetectNearCyclesInput {
  edges: NearCycleEdge[];
  entities: NearCycleEntity[];
  /** Cap on returned near-cycles. Default 10. The cycle-close route
   *  applies its own per-pass cap on top of this. */
  maxResults?: number;
}

export function detectNearCycles(input: DetectNearCyclesInput): NearCycle[] {
  const maxResults = input.maxResults ?? 10;

  // Build entity name + importance lookup once.
  const entityById = new Map<string, NearCycleEntity>();
  for (const e of input.entities) {
    entityById.set(e.id, e);
  }

  // Adjacency: source → array of (target, confidence). Multiple edges
  // from the same source to the same target are collapsed by taking
  // the max confidence — the structural fact "edge exists" is what
  // matters here, not the count.
  const outgoing = new Map<string, Map<string, number>>();
  // Edge existence lookup: "src:tgt" → true. Used to check whether the
  // closing edge already exists (in which case it's a real cycle, not
  // a near-cycle).
  const edgeExists = new Set<string>();

  for (const edge of input.edges) {
    const key = `${edge.source_entity_id}:${edge.target_entity_id}`;
    edgeExists.add(key);
    const conf = edge.confidence ?? 0.5;
    const m = outgoing.get(edge.source_entity_id);
    if (m) {
      m.set(edge.target_entity_id, Math.max(m.get(edge.target_entity_id) ?? 0, conf));
    } else {
      outgoing.set(edge.source_entity_id, new Map([[edge.target_entity_id, conf]]));
    }
  }

  // Enumerate 2-hop paths a → b → c. For each, the closing edge would
  // be c → a; if absent, the triple is a near-cycle candidate.
  const seenMissing = new Set<string>();
  const candidates: NearCycle[] = [];

  for (const [aId, aOut] of outgoing) {
    const aEntity = entityById.get(aId);
    if (!aEntity) continue;
    for (const [bId, abConf] of aOut) {
      const bOut = outgoing.get(bId);
      if (!bOut) continue;
      const bEntity = entityById.get(bId);
      if (!bEntity) continue;
      for (const [cId, bcConf] of bOut) {
        if (cId === aId || cId === bId) continue;
        const cEntity = entityById.get(cId);
        if (!cEntity) continue;
        const closingKey = `${cId}:${aId}`;
        if (edgeExists.has(closingKey)) continue; // real cycle, not near

        // Dedup by missing-edge key. Multiple paths can suggest the
        // same closing edge — keep only the best-scoring path for
        // each unique missing edge.
        if (seenMissing.has(closingKey)) {
          // Update existing candidate's score if this path scores higher.
          const existing = candidates.find(
            (c) =>
              c.missingEdge.source_entity_id === cId &&
              c.missingEdge.target_entity_id === aId,
          );
          if (existing) {
            const newScore = scoreCandidate(aEntity, bEntity, cEntity, abConf, bcConf);
            if (newScore > existing.score) {
              existing.score = newScore;
              existing.entityIds = [aId, bId, cId];
              existing.entityNames = [aEntity.name, bEntity.name, cEntity.name];
              existing.rationale = buildRationale(aEntity, bEntity, cEntity);
            }
          }
          continue;
        }
        seenMissing.add(closingKey);

        candidates.push({
          entityIds: [aId, bId, cId],
          entityNames: [aEntity.name, bEntity.name, cEntity.name],
          missingEdge: { source_entity_id: cId, target_entity_id: aId },
          score: scoreCandidate(aEntity, bEntity, cEntity, abConf, bcConf),
          rationale: buildRationale(aEntity, bEntity, cEntity),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxResults);
}

/**
 * Score a near-cycle candidate. Three multiplicative factors:
 *
 *   1. Avg confidence of the two existing edges. A path made of
 *      low-confidence edges produces low-confidence cycles.
 *   2. Importance bonus: cycles involving fundamental / critical nodes
 *      OR leverage / risk / bottleneck flags rank higher. These are
 *      the cycles that actually drive the system's behavior.
 *   3. Diversity bonus: paths where all 3 nodes have different
 *      importance categories tend to be "real" structural loops vs
 *      spurious co-occurrence chains.
 *
 * Range: 0..1. Suitable for caller's `topN` filtering.
 */
function scoreCandidate(
  a: NearCycleEntity,
  b: NearCycleEntity,
  c: NearCycleEntity,
  abConf: number,
  bcConf: number,
): number {
  const avgConf = (abConf + bcConf) / 2;
  const importanceBoost = Math.max(
    importanceWeight(a),
    importanceWeight(b),
    importanceWeight(c),
  );
  const flagBoost =
    a.is_leverage_point || b.is_leverage_point || c.is_leverage_point ? 0.2 : 0;
  const bottleneckBoost =
    a.is_master_bottleneck || b.is_master_bottleneck || c.is_master_bottleneck
      ? 0.3
      : 0;

  const raw =
    avgConf * 0.5 +
    importanceBoost * 0.3 +
    flagBoost +
    bottleneckBoost;
  return Math.min(1, raw);
}

function importanceWeight(e: NearCycleEntity): number {
  switch (e.importance) {
    case "fundamental":
      return 1.0;
    case "critical":
      return 0.8;
    case "important":
      return 0.5;
    case "moderate":
      return 0.3;
    default:
      return 0.3;
  }
}

function buildRationale(
  a: NearCycleEntity,
  b: NearCycleEntity,
  c: NearCycleEntity,
): string {
  return (
    `Existing path: ${a.name} → ${b.name} → ${c.name}. ` +
    `Investigating whether ${c.name} feeds back to ${a.name} would close a 3-edge causal loop.`
  );
}
