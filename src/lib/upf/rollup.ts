/**
 * UPF — decomposition-as-proxy rollup (Phase 4c-final foundation).
 *
 * Core insight: when an entity is decomposed into children, those children
 * are themselves proxies of the parent. Measuring any child gives partial
 * information about the parent; the *cheapest informative* child is the
 * one the selector should pick next.
 *
 * This module derives a rolled-up parent descriptor from child descriptors
 * and provides a ranker for the decomposed children. It is the substrate
 * future phases will use to answer: "to probe X, what's the minimum-friction
 * child observation I should request from the user?"
 *
 * Pure function; no DB, no LLM. Matches the coefficient-constant style of
 * the rest of the UPF module so scoring stays auditable.
 */

import type { Entity } from "@/types";
import type { DataCategory } from "@/types/consent";
import type { DepthTier, ProxyDescriptor } from "./types";
import { deriveEntityDescriptor } from "./derive-entity-descriptor";

// ── Aggregation coefficients ──────────────────────────────────────────

/**
 * When rolling up N children into a parent descriptor, we take the max child
 * info-bits (the single most informative child is what the user would probe
 * *first*), then add a diminishing-returns bonus for additional high-bit
 * children — redundant children are cheap insurance, not full multipliers.
 */
const SECONDARY_CHILD_WEIGHT = 0.35;
/** Ignore children below this contribution (noise). */
const MIN_CHILD_BIT_CONTRIBUTION = 0.2;

/**
 * Parent friction inherits from the *minimum* child friction — because to
 * gain any information about the parent you only need the cheapest child.
 * If no children contribute, fall back to the parent's own derived friction.
 */

// ── Depth tier resolution ─────────────────────────────────────────────

function promoteDepthTier(parent: DepthTier, children: DepthTier[]): DepthTier {
  // Parent depth = most-informative tier available among parent + children.
  const order: Record<DepthTier, number> = { light: 0, mid: 1, heavy: 2 };
  let best = order[parent];
  for (const t of children) best = Math.max(best, order[t]);
  return (["light", "mid", "heavy"] as DepthTier[])[best];
}

// ── Public API ────────────────────────────────────────────────────────

export interface RolledUpParent {
  /** The rolled-up descriptor — emit-ready for selectNextProxy. */
  descriptor: ProxyDescriptor;
  /** Per-child descriptors, ranked by info-per-friction (cheapest-informative first). */
  rankedChildren: Array<{
    descriptor: ProxyDescriptor;
    info_bits: number;
    friction: number;
    value_per_friction: number;
  }>;
  /** The child the selector would probe first (null if parent has no children). */
  topChild: ProxyDescriptor | null;
}

/**
 * Roll a parent's decomposed children up into a single parent descriptor.
 *
 * The parent's `construct_id` is preserved, but its `expected_info_bits` and
 * `friction_cost` reflect the *aggregate proxy surface* the children offer.
 *
 * If a child's descriptor has a non-empty `data_categories`, the parent
 * inherits it — this is important: a high-fidelity biological child probe
 * (e.g. "cortisol level") gates the parent just as it would gate a direct
 * proposal that tracked it.
 */
export function rollUpChildrenToParent(
  parent: Entity,
  children: Entity[]
): RolledUpParent {
  const parentDescriptor = deriveEntityDescriptor(parent);

  if (children.length === 0) {
    return {
      descriptor: parentDescriptor,
      rankedChildren: [],
      topChild: null,
    };
  }

  // Score each child locally so callers that want to render the list can do
  // it without a second pass.
  const FRICTION_EPSILON = 0.05;
  const childScores = children.map((c) => {
    const d = deriveEntityDescriptor(c);
    return {
      descriptor: d,
      info_bits: d.expected_info_bits,
      friction: d.friction_cost,
      value_per_friction:
        d.expected_info_bits / (d.friction_cost + FRICTION_EPSILON),
    };
  });

  // Rank: highest value-per-friction first; tiebreak on lower friction, then id.
  const rankedChildren = [...childScores].sort((a, b) => {
    if (b.value_per_friction !== a.value_per_friction) {
      return b.value_per_friction - a.value_per_friction;
    }
    if (a.friction !== b.friction) return a.friction - b.friction;
    return a.descriptor.id.localeCompare(b.descriptor.id);
  });

  const topChild = rankedChildren[0].descriptor;

  // ── Aggregated info-bits: max child + diminishing-returns on others ──
  const sorted = [...childScores].sort((a, b) => b.info_bits - a.info_bits);
  const primary = sorted[0].info_bits;
  let secondary = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const contrib = sorted[i].info_bits;
    if (contrib < MIN_CHILD_BIT_CONTRIBUTION) continue;
    // Each subsequent high-bit child contributes less than the last.
    secondary += contrib * Math.pow(SECONDARY_CHILD_WEIGHT, i - 1);
  }
  const aggregatedBits = Math.max(parentDescriptor.expected_info_bits, primary) + secondary;

  // ── Aggregated friction: min of child friction (cheapest probe wins) ──
  const minChildFriction = Math.min(...childScores.map((s) => s.friction));
  const aggregatedFriction = Math.min(
    parentDescriptor.friction_cost,
    minChildFriction
  );

  // ── Union data categories (children and parent) ──
  const dataCategories = new Set<DataCategory>(parentDescriptor.data_categories);
  for (const s of childScores) {
    for (const c of s.descriptor.data_categories) dataCategories.add(c);
  }

  // ── Promote depth tier ──
  const depthTier = promoteDepthTier(
    parentDescriptor.depth_tier,
    childScores.map((s) => s.descriptor.depth_tier)
  );

  return {
    descriptor: {
      ...parentDescriptor,
      expected_info_bits: aggregatedBits,
      friction_cost: aggregatedFriction,
      depth_tier: depthTier,
      data_categories: [...dataCategories],
      validates_against: childScores.map((s) => s.descriptor.id),
      metadata: {
        ...(parentDescriptor.metadata ?? {}),
        rolled_up_from_children: children.length,
        top_child_id: topChild.id,
      },
    },
    rankedChildren,
    topChild,
  };
}
