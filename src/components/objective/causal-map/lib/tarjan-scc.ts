// ── Tarjan's strongly-connected-components ────────────────────────
//
// Phase 12.A (N8). Loop detection runs CLIENT-SIDE so the map can
// re-compute feedback loops in real time as edges change — no server
// round-trip. A directed graph's feedback loops are exactly its
// strongly-connected components of size ≥ 2 (plus self-loops, which we
// ignore at this altitude).
//
// Pure function: takes node ids + directed edges, returns SCCs as
// arrays of node ids. O(V + E). Iterative (explicit stack) so a large,
// densely-cyclic canvas can't overflow the JS call stack.

export interface SccInput {
  nodeIds: string[];
  /** Directed edges. Order doesn't matter; duplicates are tolerated. */
  edges: Array<{ source: string; target: string }>;
}

/**
 * Compute strongly-connected components. Returns ALL components,
 * including singletons; callers filter to size ≥ 2 for loops.
 * Components are returned in reverse-topological order (Tarjan's
 * natural output order).
 */
export function tarjanScc(input: SccInput): string[][] {
  const { nodeIds, edges } = input;

  // Adjacency (only between known nodes).
  const known = new Set(nodeIds);
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    if (e.source === e.target) continue; // ignore self-loops
    adj.get(e.source)!.push(e.target);
  }

  let index = 0;
  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  // Iterative DFS frame: a node plus a cursor into its neighbor list.
  interface Frame {
    node: string;
    neighbors: string[];
    i: number;
  }

  for (const start of nodeIds) {
    if (indexOf.has(start)) continue;

    const frames: Frame[] = [
      { node: start, neighbors: adj.get(start) ?? [], i: 0 },
    ];
    indexOf.set(start, index);
    lowlink.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const { node, neighbors } = frame;

      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i++;
        if (!indexOf.has(w)) {
          // Descend into w.
          indexOf.set(w, index);
          lowlink.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          frames.push({ node: w, neighbors: adj.get(w) ?? [], i: 0 });
        } else if (onStack.has(w)) {
          // Back-edge to a node still on the stack.
          lowlink.set(node, Math.min(lowlink.get(node)!, indexOf.get(w)!));
        }
      } else {
        // Done with this node — it may be an SCC root.
        if (lowlink.get(node) === indexOf.get(node)) {
          const component: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== node);
          sccs.push(component);
        }
        frames.pop();
        // Propagate lowlink up to the parent frame.
        if (frames.length > 0) {
          const parent = frames[frames.length - 1].node;
          lowlink.set(
            parent,
            Math.min(lowlink.get(parent)!, lowlink.get(node)!),
          );
        }
      }
    }
  }

  return sccs;
}
