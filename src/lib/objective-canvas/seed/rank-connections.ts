// ── rank-connections ─────────────────────────────────────────────────
//
// The connection-ranker (the genuinely-missing agent). We rank NODES already
// (strength = score × centrality); this ranks the EDGES — because the highest-
// value product insight usually lives in a cross-lane BRIDGE ("metaphor fit" ↔
// "user comprehension"), not in any single node.
//
// An edge's value = betweenness (how much it bridges otherwise-distant parts of
// the graph) × endpoint strength × cross-type bonus. Pure topology + the node
// scores already in the seed — CLIENT-SAFE, no imports, runs in the Map peek.

interface RCNode { id: string; label: string; keyword?: string; type: string; score?: number }
interface RCEdge { source: string; target: string; relation?: string }

export interface RankedConnection {
  source: string;
  target: string;
  sourceKeyword: string;
  targetKeyword: string;
  /** 0–100 */
  score: number;
  /** human "why this bridge matters" */
  why: string;
  bridgesTypes: boolean;
}

function kw(n: RCNode): string {
  return (n.keyword || n.label || n.id).split(/\s+/).slice(0, 2).join(" ");
}

/** Edge-betweenness via all-pairs BFS (graphs here are small, < ~60 nodes).
 *  Counts, for every shortest path between every node pair, the fraction that
 *  traverse each edge. High betweenness = the edge many paths depend on = a
 *  true bridge. Returns a Map keyed by the undirected edge key. */
function edgeBetweenness(nodeIds: string[], adj: Map<string, Set<string>>): Map<string, number> {
  const bt = new Map<string, number>();
  const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const s of nodeIds) {
    // BFS from s; track predecessors + #shortest paths (Brandes-lite, unweighted).
    const dist = new Map<string, number>();
    const sigma = new Map<string, number>();
    const preds = new Map<string, string[]>();
    const order: string[] = [];
    nodeIds.forEach((n) => { dist.set(n, -1); sigma.set(n, 0); preds.set(n, []); });
    dist.set(s, 0); sigma.set(s, 1);
    const queue = [s];
    while (queue.length) {
      const v = queue.shift()!;
      order.push(v);
      for (const w of adj.get(v) ?? []) {
        if (dist.get(w)! < 0) { dist.set(w, dist.get(v)! + 1); queue.push(w); }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          preds.get(w)!.push(v);
        }
      }
    }
    // Accumulate dependencies back-to-front.
    const delta = new Map<string, number>();
    nodeIds.forEach((n) => delta.set(n, 0));
    for (let i = order.length - 1; i >= 0; i--) {
      const w = order[i];
      for (const v of preds.get(w)!) {
        const c = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        bt.set(ekey(v, w), (bt.get(ekey(v, w)) ?? 0) + c);
        delta.set(v, delta.get(v)! + c);
      }
    }
  }
  // Each undirected edge counted from both endpoints → halve.
  for (const [k, v] of bt) bt.set(k, v / 2);
  return bt;
}

export function rankConnections(graph: { nodes?: RCNode[]; edges?: RCEdge[] } | undefined, top = 4): RankedConnection[] {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  if (nodes.length < 2 || edges.length === 0) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  const adj = new Map<string, Set<string>>();
  ids.forEach((id) => adj.set(id, new Set()));
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target) && e.source !== e.target) {
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
  }
  const bt = edgeBetweenness(ids, adj);
  const maxBt = Math.max(1, ...[...bt.values()]);
  const maxScore = Math.max(1, ...nodes.map((n) => n.score ?? 0));

  const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set<string>();
  const ranked: RankedConnection[] = [];
  for (const e of edges) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (!a || !b || a.id === b.id) continue;
    const k = ekey(a.id, b.id);
    if (seen.has(k)) continue;
    seen.add(k);

    const between = (bt.get(k) ?? 0) / maxBt;                          // 0–1 bridge-ness
    const endpoint = ((a.score ?? 0) + (b.score ?? 0)) / (2 * maxScore); // 0–1 endpoint strength
    const crossType = a.type !== b.type;                               // bridges abstraction layers
    const score = 0.5 * between + 0.35 * endpoint + 0.15 * (crossType ? 1 : 0.25);

    ranked.push({
      source: a.id,
      target: b.id,
      sourceKeyword: kw(a),
      targetKeyword: kw(b),
      score: Math.round(score * 100),
      why: crossType
        ? `bridges ${a.type.replace(/_/g, " ")} ↔ ${b.type.replace(/_/g, " ")}`
        : `links ${kw(a)} ↔ ${kw(b)}`,
      bridgesTypes: crossType,
    });
  }
  return ranked.sort((x, y) => y.score - x.score).slice(0, top);
}
