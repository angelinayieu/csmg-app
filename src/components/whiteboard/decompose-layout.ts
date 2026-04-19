// ── Decompose layout engine ──
//
// When a parent is decomposed, its children need positions that:
//   1. Center under the parent
//   2. Sit in the layer band below the parent's layer
//   3. Don't overlap existing nodes (auto-shift siblings if they do)
//
// Pure functions — no React, no API calls. Callable by the canvas component
// after a decompose API call returns.

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParentInfo extends RectLike {
  entity_id: string;
}

export interface ChildPlan {
  entity_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExistingNode extends RectLike {
  entity_id: string;
  // If true, this node can be shifted horizontally to make room; if false
  // (e.g. the parent itself), we don't touch it.
  shiftable: boolean;
}

export interface DecomposeLayoutOptions {
  /** Horizontal gap between adjacent children. Default 24. */
  childGap?: number;
  /** Vertical gap between parent bottom and child top. Default 80. */
  verticalGap?: number;
  /** Extra padding when checking overlap with existing nodes. Default 12. */
  overlapPadding?: number;
  /** Maximum sideways shift allowed per affected sibling. Default 400. */
  maxShiftPerSibling?: number;
}

// ── Core layout computation ──

/**
 * Given a parent and the sizes of its future children, return:
 *   - childPlans: where to place each child (centered row under parent)
 *   - siblingShifts: x-deltas to apply to overlapping existing nodes
 *
 * If overlapping can't be cleanly resolved within maxShiftPerSibling,
 * we accept the overlap (rare) and let the canvas re-render as-is.
 */
export function planDecomposeLayout(
  parent: ParentInfo,
  childSizes: Array<{ entity_id: string; width: number; height: number }>,
  existingNodes: ExistingNode[],
  options: DecomposeLayoutOptions = {},
): {
  childPlans: ChildPlan[];
  siblingShifts: Map<string, { dx: number }>;
} {
  const childGap = options.childGap ?? 24;
  const verticalGap = options.verticalGap ?? 80;
  const overlapPadding = options.overlapPadding ?? 12;
  const maxShift = options.maxShiftPerSibling ?? 400;

  if (childSizes.length === 0) {
    return { childPlans: [], siblingShifts: new Map() };
  }

  // 1. Compute total cluster width (N children + (N-1) gaps)
  const totalClusterWidth =
    childSizes.reduce((s, c) => s + c.width, 0) + (childSizes.length - 1) * childGap;

  // 2. Parent center X
  const parentCenterX = parent.x + parent.width / 2;
  const clusterStartX = parentCenterX - totalClusterWidth / 2;
  const clusterY = parent.y + parent.height + verticalGap;

  // 3. Assign each child an x (left edge) along the row
  let cursor = clusterStartX;
  const maxChildHeight = Math.max(...childSizes.map((c) => c.height));
  const childPlans: ChildPlan[] = childSizes.map((c) => {
    const plan: ChildPlan = {
      entity_id: c.entity_id,
      x: cursor,
      y: clusterY,
      width: c.width,
      height: c.height,
    };
    cursor += c.width + childGap;
    return plan;
  });

  // 4. Detect overlaps with existing nodes and compute shifts.
  // Strategy: for each existing sibling that overlaps the cluster bbox
  // (inflated by overlapPadding), shift it sideways by the minimum amount
  // that clears the cluster. Bias shift direction away from the parent's
  // horizontal center so we maintain visual coherence.
  const clusterBBox: RectLike = {
    x: clusterStartX - overlapPadding,
    y: clusterY - overlapPadding,
    width: totalClusterWidth + overlapPadding * 2,
    height: maxChildHeight + overlapPadding * 2,
  };

  const siblingShifts = new Map<string, { dx: number }>();

  for (const existing of existingNodes) {
    if (!existing.shiftable) continue;
    // Skip nodes that are children we're about to place — they don't exist yet.
    if (childPlans.some((c) => c.entity_id === existing.entity_id)) continue;

    // Does this existing node intersect the cluster bbox?
    if (!rectsOverlap(existing, clusterBBox)) continue;

    // Compute minimum horizontal shift. Push nodes AWAY from the parent:
    //   if existing center < parent center → shift left
    //   if existing center >= parent center → shift right
    const existingCenter = existing.x + existing.width / 2;
    const pushRight = existingCenter >= parentCenterX;
    let dx: number;
    if (pushRight) {
      // Shift right until left edge clears cluster right edge + gap
      const clusterRight = clusterStartX + totalClusterWidth + childGap;
      dx = clusterRight - existing.x;
    } else {
      // Shift left until right edge clears cluster left edge - gap
      const clusterLeft = clusterStartX - childGap;
      dx = clusterLeft - (existing.x + existing.width);
    }

    // Clamp to max shift
    if (Math.abs(dx) > maxShift) {
      dx = Math.sign(dx) * maxShift;
    }

    siblingShifts.set(existing.entity_id, { dx });
  }

  return { childPlans, siblingShifts };
}

// ── Helpers ──

function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * Estimate width/height for a newly-spawned child before classification has
 * run. Uses a fixed guess sized to match the `support` tier — good enough
 * for overlap detection, and the real render will re-measure within 1 frame.
 */
export function estimateChildSize(): { width: number; height: number } {
  return { width: 220, height: 110 };
}
