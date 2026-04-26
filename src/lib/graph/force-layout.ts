// ── Tiny deterministic force-directed layout ──
//
// Built for the probability-space-shell mini-graphs (4-12 nodes, fits
// in a 250×90 viewport). Not a replacement for D3-force or the Dagre-
// backed layout-engine.ts — that one is for the post-run whole-KG
// renderings. This is for live inline graphs that:
//
//   1. Must be deterministic — same inputs → same positions, otherwise
//      every painter event re-renders the shell with jittered nodes.
//   2. Must be fast — runs synchronously inside React's render path
//      every time entitiesJson / edgesJson change.
//   3. Must fit a fixed viewport without collisions or clipping.
//
// Algorithm: simple Eades-style spring layout.
//   - Repulsion between every pair (Coulomb, weak)
//   - Attraction along every edge (Hooke, stronger when far)
//   - Centering force (very weak, keeps drift bounded)
//   - 30 iterations is plenty for stable convergence at this scale.
//
// Initial positions are seeded by a hash of node id + index so the same
// node stays near the same starting slot across renders. After
// convergence, positions are normalized into the requested viewport.

export interface ForceLayoutNode {
  id: string;
  /** Optional weight, 0..1. Larger nodes act as stronger repulsion
   *  centers, which spaces neighbors out around hubs. Default 0.5. */
  weight?: number;
}

export interface ForceLayoutEdge {
  source: string;
  target: string;
}

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** Rough target distance between connected nodes. Defaults to a
   *  fraction of `min(width, height)`. */
  springLength?: number;
  /** Iteration count. 30 is good for ≤15 nodes; bump to 60 for 30+. */
  iterations?: number;
  /** Inset margin from the viewport edges. Defaults to 12. */
  padding?: number;
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  /** Degree (count of edges incident). Useful for sizing. */
  degree: number;
}

export interface ForceLayoutResult {
  nodes: PositionedNode[];
  /** id of the node with the highest degree — the "core" of the graph.
   *  Null when the graph has zero nodes. */
  coreId: string | null;
}

export function computeForceLayout(
  entities: ForceLayoutNode[],
  edges: ForceLayoutEdge[],
  opts: ForceLayoutOptions,
): ForceLayoutResult {
  const n = entities.length;
  const padding = opts.padding ?? 12;
  const w = Math.max(40, opts.width - padding * 2);
  const h = Math.max(40, opts.height - padding * 2);
  const springLen =
    opts.springLength ?? Math.min(w, h) * (n > 8 ? 0.22 : 0.34);
  const iterations = opts.iterations ?? 30;

  if (n === 0) return { nodes: [], coreId: null };
  if (n === 1) {
    return {
      nodes: [
        {
          id: entities[0].id,
          x: opts.width / 2,
          y: opts.height / 2,
          degree: 0,
        },
      ],
      coreId: entities[0].id,
    };
  }

  // Degree count for sizing + core detection. Self-loops ignored.
  const degree = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // Seed positions on a circle around the center, ordered by node id
  // hash. Deterministic across renders.
  const cx = w / 2;
  const cy = h / 2;
  const r0 = Math.min(w, h) * 0.35;
  type Pt = { x: number; y: number; vx: number; vy: number; weight: number };
  const pts = new Map<string, Pt>();
  entities.forEach((node, i) => {
    const slot = (hashId(node.id) + i) % n;
    const theta = (slot / n) * Math.PI * 2 - Math.PI / 2;
    pts.set(node.id, {
      x: cx + Math.cos(theta) * r0,
      y: cy + Math.sin(theta) * r0,
      vx: 0,
      vy: 0,
      weight: typeof node.weight === "number" ? Math.max(0, Math.min(1, node.weight)) : 0.5,
    });
  });

  // Edge index for attraction step (skip non-existing endpoints).
  const validEdges = edges.filter(
    (e) => e.source !== e.target && pts.has(e.source) && pts.has(e.target),
  );

  // Tunable constants — small numbers because the viewport is small
  // and we want gentle convergence.
  const REPULSION = springLen * springLen * 0.9;
  const SPRING_K = 0.06;
  const CENTER_K = 0.012;
  const DAMPING = 0.78;
  const MAX_VELOCITY = 8;

  for (let iter = 0; iter < iterations; iter++) {
    const list = Array.from(pts.entries());

    // Pairwise repulsion
    for (let i = 0; i < list.length; i++) {
      const [, a] = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const [, b] = list[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          // Coincident — perturb slightly so the math doesn't divide
          // by zero. Use deterministic offset based on iter index.
          dx = ((iter % 3) - 1) * 0.5;
          dy = (((iter + 1) % 3) - 1) * 0.5;
          dist2 = dx * dx + dy * dy + 0.5;
        }
        const dist = Math.sqrt(dist2);
        // Hubs (high weight) repel more strongly so they get more
        // breathing room, mirroring node-size visually.
        const force = (REPULSION * (1 + a.weight * 0.5 + b.weight * 0.5)) / dist2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.vx += ux * force;
        a.vy += uy * force;
        b.vx -= ux * force;
        b.vy -= uy * force;
      }
    }

    // Edge spring attraction
    for (const e of validEdges) {
      const a = pts.get(e.source)!;
      const b = pts.get(e.target)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = dist - springLen;
      const force = stretch * SPRING_K;
      const ux = dx / dist;
      const uy = dy / dist;
      a.vx += ux * force;
      a.vy += uy * force;
      b.vx -= ux * force;
      b.vy -= uy * force;
    }

    // Center pull — weak but constant; prevents the cloud from
    // drifting one direction over many iterations.
    for (const [, p] of list) {
      p.vx += (cx - p.x) * CENTER_K;
      p.vy += (cy - p.y) * CENTER_K;
    }

    // Damping + position update with velocity clamp.
    for (const [, p] of list) {
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      const vmag = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (vmag > MAX_VELOCITY) {
        p.vx = (p.vx / vmag) * MAX_VELOCITY;
        p.vy = (p.vy / vmag) * MAX_VELOCITY;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  // Normalize into the viewport: find current bounding box and scale +
  // translate so the layout fits within (padding, padding) → (w, h)
  // with a small inset. Avoids the converged cloud running off the
  // edge for graphs with strong central pull.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [, p] of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bbW = Math.max(1, maxX - minX);
  const bbH = Math.max(1, maxY - minY);
  const sx = w / bbW;
  const sy = h / bbH;
  // Use the smaller scale so the graph stays proportional, then center
  // any leftover space.
  const s = Math.min(sx, sy);
  const offX = (w - bbW * s) / 2 + padding;
  const offY = (h - bbH * s) / 2 + padding;

  const positioned: PositionedNode[] = entities.map((node) => {
    const p = pts.get(node.id)!;
    return {
      id: node.id,
      x: (p.x - minX) * s + offX,
      y: (p.y - minY) * s + offY,
      degree: degree.get(node.id) ?? 0,
    };
  });

  // Core = highest-degree node. Tie-break by id hash so deterministic.
  let coreId: string | null = positioned[0].id;
  let bestDeg = positioned[0].degree;
  let bestHash = hashId(coreId);
  for (let i = 1; i < positioned.length; i++) {
    const n = positioned[i];
    const h = hashId(n.id);
    if (n.degree > bestDeg || (n.degree === bestDeg && h < bestHash)) {
      coreId = n.id;
      bestDeg = n.degree;
      bestHash = h;
    }
  }

  return { nodes: positioned, coreId };
}

// FNV-1a 32-bit. Fast, deterministic, no deps. Used for both seed
// placement (so node ids deterministically pick a starting slot) and
// tie-breaking core selection.
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}
