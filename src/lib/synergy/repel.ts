// ── Insert-time repulsion (anti-overlap) ──
//
// Pure helper called immediately after a new node lands on the
// synergy whiteboard. Pushes any existing nodes that overlap (or
// crowd) the new node radially outward until separation is met or
// we hit the iteration cap.
//
// Why this exists:
//   `placeNear` (radial layout) chooses an angle based on sibling
//   count at insert time, but it doesn't know about cousins, the
//   parent's other branches, or user-dragged nodes. So a newly-
//   placed card can land on top of unrelated content. This function
//   runs ONE physics pass per insert — not a continuous simulation —
//   so user spatial memory is preserved everywhere except the
//   neighborhood of the new arrival.
//
// Anchoring rules:
//   • The new node is anchored (it landed where the user expected;
//     don't yank it away under them).
//   • The "core" seed node is anchored (visual center; moving it
//     would disorient the whole board).
//   • Everything else is movable.
//
// Tuning:
//   • minDist = 260 (≈ avg card width 220 + 40 padding) is generous
//     enough that even max-width 320 cards stay clearly separated.
//   • maxIter = 20 is plenty for realistic board sizes (<200 nodes);
//     we early-exit when nothing moved in a pass.
//   • damping = 0.5 prevents oscillation; each node only takes half
//     the implied step per pass.

import type { ClientNode } from "./types";

export interface RepelOnInsertArgs {
  nodes: ClientNode[];
  /**
   * IDs of nodes that just arrived. They're anchored during the
   * physics pass (they landed where the user/algorithm expected,
   * don't yank them away under the user). Pass a single id wrapped
   * in an array for the simple "one node added" case, or many ids
   * for batch inserts (AI augment, decompose, autopilot, etc.).
   */
  newIds: string[];
  /** Minimum center-to-center distance, in canvas units. */
  minDist?: number;
  /** Hard cap on physics passes. We bail early when stable. */
  maxIter?: number;
}

export function repelOnInsert({
  nodes,
  newIds,
  minDist = 260,
  maxIter = 20,
}: RepelOnInsertArgs): ClientNode[] {
  // Anchors: all new arrivals + the core seed never move during the
  // resolution pass.
  const anchored = new Set<string>(newIds);
  const core = nodes.find((n) => n.kind === "core");
  if (core) anchored.add(core.id);

  // Shallow clone so callers can replace state idempotently.
  const next = nodes.map((n) => ({ ...n }));

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < next.length; i++) {
      const a = next[i];
      if (anchored.has(a.id)) continue;
      // Aggregate repulsion vector from every other node within
      // minDist. We damp by 0.5 so two mutually-pushing nodes don't
      // oscillate past each other.
      let dx = 0;
      let dy = 0;
      for (let j = 0; j < next.length; j++) {
        if (i === j) continue;
        const b = next[j];
        const ddx = a.x - b.x;
        const ddy = a.y - b.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        if (dist < minDist) {
          const force = (minDist - dist) / dist;
          dx += ddx * force * 0.5;
          dy += ddy * force * 0.5;
        }
      }
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        a.x += dx;
        a.y += dy;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return next;
}

// ── Diff-based wrapper for setNodes callers ───────────────────────
//
// Most setNodes((prev) => …) blocks construct the next array and
// don't track which entries are new. This helper does the diff for
// you: anything in `after` whose id isn't in `before` is treated as
// a fresh arrival and anchored during repulsion. If nothing was
// added (e.g. only a position update), `after` is returned unchanged.
//
// Usage at a call site:
//   setNodes((prev) => withRepel(prev, /* compute next from prev */));
//
// Cheap O(N) diff + the existing O(N² × iters) repel pass; runs in
// well under 16ms for any realistic synergy board (<200 nodes).
export function withRepel(
  before: ClientNode[],
  after: ClientNode[],
  opts?: { minDist?: number; maxIter?: number },
): ClientNode[] {
  const beforeIds = new Set(before.map((n) => n.id));
  const newIds: string[] = [];
  for (const n of after) {
    if (!beforeIds.has(n.id)) newIds.push(n.id);
  }
  if (newIds.length === 0) return after;
  return repelOnInsert({
    nodes: after,
    newIds,
    minDist: opts?.minDist,
    maxIter: opts?.maxIter,
  });
}
