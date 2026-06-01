// ── Build Data-Flow Graph ───────────────────────────────────────────
//
// Pure transform: features (each declaring consumes[]/produces[] data
// tokens — Foundation B) → a unit-centric bipartite data-flow graph.
//
//   data unit ──consumed by──▶ [feature operator] ──produces──▶ data unit
//
// This is the "start at each data unit, branch through the operators that
// transform it, to the final output" map the data-flow view renders. Data
// UNITS are the nodes; FEATURES are the operators between them. A unit with
// no producer is a SOURCE (an initial data point fed from outside); a unit
// with no consumer is a SINK (a final transformed point).
//
// Granularity = feature-level (one operator per feature), fed from entities'
// causal_chain.data_io (+ mechanism_spec.runtime_flow) tokens. Deterministic
// + dependency-free so the view stays a thin renderer and the same {nodes,
// edges} model can later be materialized onto the whiteboard (export task).

export interface DataFlowFeature {
  id: string;
  name: string;
  /** Which room / sub-objective this feature lives in (label + grouping). */
  roomTitle?: string | null;
  consumes: string[];
  produces: string[];
}

export type DataFlowNodeKind = "unit" | "operator";
export type DataFlowUnitRole = "source" | "sink" | "intermediate";

export interface DataFlowGraphNode {
  id: string;
  kind: DataFlowNodeKind;
  label: string;
  /** Operator nodes: the room the feature belongs to. */
  roomTitle?: string | null;
  /** Unit nodes: position in the flow (source / sink / intermediate). */
  role?: DataFlowUnitRole;
  /** Unit nodes: how many operators touch this unit (fan-in + fan-out). */
  degree?: number;
}

export interface DataFlowGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "consume" | "produce";
  /** The data token this edge carries (edge label / hover). */
  token: string;
}

export interface DataFlowGraph {
  nodes: DataFlowGraphNode[];
  edges: DataFlowGraphEdge[];
  stats: { units: number; operators: number; sources: number; sinks: number };
}

const unitId = (token: string) => `unit:${token}`;
const opId = (featureId: string) => `op:${featureId}`;

export function buildDataFlowGraph(features: DataFlowFeature[]): DataFlowGraph {
  const producedTokens = new Set<string>();
  const consumedTokens = new Set<string>();
  const operators: DataFlowFeature[] = [];

  for (const f of features) {
    const consumes = dedupeTokens(f.consumes);
    const produces = dedupeTokens(f.produces);
    // A feature with no declared data I/O isn't an operator on the flow —
    // drop it so the graph stays a clean data map (no orphan nodes).
    if (consumes.length === 0 && produces.length === 0) continue;
    operators.push({ ...f, consumes, produces });
    for (const t of consumes) consumedTokens.add(t);
    for (const t of produces) producedTokens.add(t);
  }

  const allTokens = new Set<string>([...producedTokens, ...consumedTokens]);
  const nodes: DataFlowGraphNode[] = [];
  const edges: DataFlowGraphEdge[] = [];
  const degree = new Map<string, number>();

  // Operator nodes + their consume/produce edges.
  for (const f of operators) {
    nodes.push({
      id: opId(f.id),
      kind: "operator",
      label: f.name,
      roomTitle: f.roomTitle ?? null,
    });
    for (const t of f.consumes) {
      edges.push({
        id: `e:${t}->op:${f.id}`,
        source: unitId(t),
        target: opId(f.id),
        kind: "consume",
        token: t,
      });
      degree.set(t, (degree.get(t) ?? 0) + 1);
    }
    for (const t of f.produces) {
      edges.push({
        id: `e:op:${f.id}->${t}`,
        source: opId(f.id),
        target: unitId(t),
        kind: "produce",
        token: t,
      });
      degree.set(t, (degree.get(t) ?? 0) + 1);
    }
  }

  // Unit nodes, classified by role.
  let sources = 0;
  let sinks = 0;
  for (const t of allTokens) {
    const isProduced = producedTokens.has(t);
    const isConsumed = consumedTokens.has(t);
    let role: DataFlowUnitRole = "intermediate";
    if (!isProduced && isConsumed) {
      role = "source";
      sources += 1;
    } else if (isProduced && !isConsumed) {
      role = "sink";
      sinks += 1;
    }
    nodes.push({
      id: unitId(t),
      kind: "unit",
      label: t,
      role,
      degree: degree.get(t) ?? 0,
    });
  }

  return {
    nodes,
    edges,
    stats: { units: allTokens.size, operators: operators.length, sources, sinks },
  };
}

function dedupeTokens(arr: string[] | undefined): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
