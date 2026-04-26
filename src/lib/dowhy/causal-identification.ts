// ── Causal identification from graph structure (R5 Phase A · P4) ─────
//
// Pure function. Given a KG subgraph + a (lever, target) pair, derive
// the canonical DoWhy fields `model` and `identify`:
//
//   - MODEL:
//       leverEntityId + targetEntityId (the ask)
//       pathEntityIds (the shortest directed path lever → target)
//       pathEdges (the edges along that path, with polarity/strength/confidence)
//       pathHops (count, or null when unreachable)
//
//   - IDENTIFY:
//       kind: "direct" | "mediator" | "backdoor" | "frontdoor" | "unknown"
//       rationale (generated mechanically from the path — NOT an LLM)
//       backdoorEntityIds (confounders, when kind === "backdoor")
//       mediatorEntityIds (intermediate entities, when kind === "mediator")
//
// Algorithm is deliberately simple + defensible:
//   1. BFS forward from lever looking for target, depth-capped.
//      Shortest path found → sets pathEntityIds + pathHops.
//   2. If no path → identify.kind = "unknown".
//   3. If path is exactly [lever, target] (1 hop) → "direct".
//   4. Otherwise check for backdoor: walk backwards from BOTH lever
//      and target via reverse-edges up to `BACKDOOR_DEPTH` hops; any
//      entity reached from both is a common ancestor → backdoor
//      confounder. If found → "backdoor". Otherwise → "mediator".
//   5. "frontdoor" detection requires negative-knowledge about missing
//      edges, which we can't do from the KG alone. Always returns
//      "mediator" instead; future work can tighten this.

import type { Entity, Edge } from "@/types";
import type {
  CausalIdentification,
  CausalModel,
  IdentifyClaim,
} from "@/types/dowhy";

const MAX_PATH_DEPTH = 6;
const BACKDOOR_DEPTH = 3;

export interface IdentifyInput {
  leverEntityId: string;
  targetEntityId: string;
  entities: Entity[];
  edges: Edge[];
}

export interface IdentifyOutput {
  model: CausalModel;
  identify: IdentifyClaim;
}

export function computeCausalIdentification(
  input: IdentifyInput,
): IdentifyOutput {
  const { leverEntityId, targetEntityId, entities, edges } = input;

  // Build index structures. One pass; kept as Maps so the BFS is O(E)
  // instead of repeatedly scanning the edges array.
  const forwardAdj = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();
  const edgeByPair = new Map<string, Edge>();
  for (const e of edges) {
    const key = `${e.source_entity_id}→${e.target_entity_id}`;
    edgeByPair.set(key, e);
    const fwd = forwardAdj.get(e.source_entity_id) ?? [];
    fwd.push(e.target_entity_id);
    forwardAdj.set(e.source_entity_id, fwd);
    const rev = reverseAdj.get(e.target_entity_id) ?? [];
    rev.push(e.source_entity_id);
    reverseAdj.set(e.target_entity_id, rev);
  }

  // BFS forward — record parent pointers so we can reconstruct the
  // shortest path if we reach the target.
  const pathEntityIds = shortestForwardPath(
    leverEntityId,
    targetEntityId,
    forwardAdj,
    MAX_PATH_DEPTH,
  );

  // Guard: lever not even in the entity set. This is both a missing-
  // data and a misspecification case — we want the UI to show
  // "unknown" honestly rather than silently returning an empty model.
  const leverExists = entities.some((e) => e.id === leverEntityId);
  const targetExists = entities.some((e) => e.id === targetEntityId);
  if (!leverExists || !targetExists) {
    return {
      model: emptyModel(leverEntityId, targetEntityId),
      identify: {
        kind: "unknown",
        rationale: !leverExists
          ? `Lever entity ${leverEntityId} is not in the subgraph.`
          : `Target entity ${targetEntityId} is not in the subgraph.`,
        backdoorEntityIds: [],
        mediatorEntityIds: [],
      },
    };
  }

  // No path.
  if (pathEntityIds === null || pathEntityIds.length === 0) {
    return {
      model: emptyModel(leverEntityId, targetEntityId),
      identify: {
        kind: "unknown",
        rationale: `No directed path from lever to target within ${MAX_PATH_DEPTH} hops — the effect cannot be identified from the KG alone.`,
        backdoorEntityIds: [],
        mediatorEntityIds: [],
      },
    };
  }

  const pathHops = pathEntityIds.length - 1;
  const pathEdges = buildPathEdges(pathEntityIds, edgeByPair);

  // Direct effect: single edge lever → target.
  if (pathHops === 1) {
    return {
      model: {
        leverEntityId,
        targetEntityId,
        pathEntityIds,
        pathHops,
        pathEdges,
      },
      identify: {
        kind: "direct",
        rationale: `Direct edge from lever to target — no intermediate variables to adjust for. Strongest possible identification claim from the KG.`,
        backdoorEntityIds: [],
        mediatorEntityIds: [],
      },
    };
  }

  // Mediator path exists. Look for backdoor confounders before
  // claiming mediator — a common ancestor would make this a
  // confounded identification, not a clean mediator one.
  const mediatorEntityIds = pathEntityIds.slice(1, -1);
  const backdoorEntityIds = detectBackdoorConfounders(
    leverEntityId,
    targetEntityId,
    reverseAdj,
    BACKDOOR_DEPTH,
  );

  let kind: CausalIdentification;
  let rationale: string;
  if (backdoorEntityIds.length > 0) {
    kind = "backdoor";
    rationale = `Common ancestor(s) upstream of both lever and target — a back-door path exists. Any real experiment should control for these ${backdoorEntityIds.length} confounder(s) before trusting the estimate.`;
  } else {
    kind = "mediator";
    rationale = `Effect flows through ${mediatorEntityIds.length} intermediate entit${mediatorEntityIds.length === 1 ? "y" : "ies"} over ${pathHops} hop${pathHops === 1 ? "" : "s"}. Identifiable when mediators are held fixed.`;
  }

  return {
    model: {
      leverEntityId,
      targetEntityId,
      pathEntityIds,
      pathHops,
      pathEdges,
    },
    identify: {
      kind,
      rationale,
      backdoorEntityIds,
      mediatorEntityIds,
    },
  };
}

// ── BFS helpers ──────────────────────────────────────────────────────

function shortestForwardPath(
  source: string,
  target: string,
  forwardAdj: Map<string, string[]>,
  maxDepth: number,
): string[] | null {
  if (source === target) return [source];
  const visited = new Set<string>([source]);
  const parent = new Map<string, string>();
  let frontier: string[] = [source];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      const outs = forwardAdj.get(node) ?? [];
      for (const n of outs) {
        if (visited.has(n)) continue;
        visited.add(n);
        parent.set(n, node);
        if (n === target) {
          return reconstructPath(parent, source, target);
        }
        next.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}

function reconstructPath(
  parent: Map<string, string>,
  source: string,
  target: string,
): string[] {
  const out: string[] = [target];
  let cur = target;
  while (cur !== source) {
    const p = parent.get(cur);
    if (!p) return out; // defensive — shouldn't happen if BFS terminated here
    out.push(p);
    cur = p;
  }
  out.reverse();
  return out;
}

/**
 * Back-door detection: BFS backwards from BOTH lever and target up
 * to BACKDOOR_DEPTH hops. Any entity reached from both sides (and
 * isn't on the main forward path) is a common ancestor — a classic
 * confounder.
 */
function detectBackdoorConfounders(
  lever: string,
  target: string,
  reverseAdj: Map<string, string[]>,
  maxDepth: number,
): string[] {
  const leverAncestors = reverseBFS(lever, reverseAdj, maxDepth);
  const targetAncestors = reverseBFS(target, reverseAdj, maxDepth);
  // Common ancestors that aren't the lever itself (lever is trivially
  // an "ancestor" of target via the direct path — not a backdoor).
  const common: string[] = [];
  for (const id of leverAncestors) {
    if (id === lever || id === target) continue;
    if (targetAncestors.has(id)) common.push(id);
  }
  return common;
}

function reverseBFS(
  seed: string,
  reverseAdj: Map<string, string[]>,
  maxDepth: number,
): Set<string> {
  const visited = new Set<string>([seed]);
  let frontier: string[] = [seed];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      const ups = reverseAdj.get(node) ?? [];
      for (const u of ups) {
        if (visited.has(u)) continue;
        visited.add(u);
        next.push(u);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return visited;
}

// ── Small shape builders ─────────────────────────────────────────────

function emptyModel(
  leverEntityId: string,
  targetEntityId: string,
): CausalModel {
  return {
    leverEntityId,
    targetEntityId,
    pathEntityIds: [],
    pathHops: null,
    pathEdges: [],
  };
}

function buildPathEdges(
  pathEntityIds: string[],
  edgeByPair: Map<string, Edge>,
): CausalModel["pathEdges"] {
  const out: CausalModel["pathEdges"] = [];
  for (let i = 0; i < pathEntityIds.length - 1; i++) {
    const key = `${pathEntityIds[i]}→${pathEntityIds[i + 1]}`;
    const edge = edgeByPair.get(key);
    if (!edge) continue;
    const polarity = (
      edge.polarity === "positive" ||
      edge.polarity === "negative" ||
      edge.polarity === "neutral" ||
      edge.polarity === "conditional"
        ? edge.polarity
        : null
    ) as CausalModel["pathEdges"][number]["polarity"];
    out.push({
      edgeId: edge.id,
      polarity,
      strength: typeof edge.strength === "number" ? edge.strength : null,
      confidence: typeof edge.confidence === "number" ? edge.confidence : null,
    });
  }
  return out;
}
