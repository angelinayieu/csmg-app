/**
 * UPF — entity-aware descriptor derivation (Phase 4c-next).
 *
 * Turns an Entity into a ProxyDescriptor so the same selector can reason about
 * entities the way it reasons about questions / metrics / edges.
 *
 * Two immediate uses:
 *   1. Enriching question scoring: a question that touches the master
 *      bottleneck is worth more bits than one touching a moderate-importance
 *      node. The scorer asks this module for per-entity info contributions.
 *   2. Future: ranking which decomposed child to probe first, which
 *      tracker proposal to activate, which entity to expand next.
 *
 * Pure, deterministic, zero DB. All coefficients are named constants so the
 * scoring is auditable end-to-end.
 */

import type { Entity } from "@/types";
import type { DataCategory } from "@/types/consent";
import type { DepthTier, ProxyDescriptor } from "./types";

// ── Info-bit contributions ────────────────────────────────────────────

/** Importance tier → bits. `null` importance falls back to 0. */
const IMPORTANCE_BITS: Record<NonNullable<Entity["importance"]>, number> = {
  fundamental: 2.0,
  critical: 1.2,
  important: 0.6,
  moderate: 0.2,
};

/** Structural flags (each adds on top of importance bits). */
const MASTER_BOTTLENECK_BITS = 3.0;
const LEVERAGE_POINT_BITS = 1.5;
const RISK_POINT_BITS = 1.2;

/** Blast radius is usually 0-10; normalize and weight lightly. */
const BLAST_RADIUS_WEIGHT = 0.1;
const BLAST_RADIUS_CAP = 10;

// ── Friction costs ────────────────────────────────────────────────────

/**
 * Knowledge layer → base friction. `internal` is cheapest (user already
 * implicitly knows about it), `external` is dearest (requires new data).
 */
const KNOWLEDGE_LAYER_FRICTION: Record<Entity["knowledge_layer"], number> = {
  internal: 0.15,
  conceptual: 0.30,
  bridge: 0.40,
  external: 0.60,
};

/**
 * Decomposable-but-not-yet-expanded entities cost more to probe (require a
 * decomposition pass before their sub-signals are observable).
 */
const UNEXPANDED_FRONTIER_FRICTION = 0.15;

const MAX_ENTITY_FRICTION = 0.85;

// ── Depth tier mapping ────────────────────────────────────────────────

function deriveDepthTier(e: Entity): DepthTier {
  if (e.is_master_bottleneck) return "heavy";
  if (e.importance === "fundamental") return "heavy";
  if (e.importance === "critical" || e.is_leverage_point) return "mid";
  if (e.importance === "important" || e.is_risk_point) return "mid";
  return "light";
}

// ── Data categories ───────────────────────────────────────────────────

/**
 * Today we only coarsely map knowledge_layer → data categories. When entity
 * provenance grows richer (Phase 4c-final / 4d) we can enumerate subtypes.
 */
function deriveDataCategories(e: Entity): DataCategory[] {
  // Internal + conceptual entities reflect what the user already told us.
  // External entities may imply a research / third-party data dependency,
  // but answering questions ABOUT them doesn't disclose personal data, so
  // we leave this empty until we have a real use case that needs a gate.
  void e;
  return [];
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Info-bits contribution when *another* descriptor (usually a question or
 * tracker proposal) references this entity. Exposed as a pure scalar so the
 * question scorer can call this without materialising a full descriptor.
 */
export function entityReferenceInfoBits(e: Entity): number {
  let bits = 0;
  if (e.importance) bits += IMPORTANCE_BITS[e.importance];
  if (e.is_master_bottleneck) bits += MASTER_BOTTLENECK_BITS;
  if (e.is_leverage_point) bits += LEVERAGE_POINT_BITS;
  if (e.is_risk_point) bits += RISK_POINT_BITS;
  bits +=
    Math.min(e.blast_radius ?? 0, BLAST_RADIUS_CAP) * BLAST_RADIUS_WEIGHT;
  return bits;
}

/** One-token badge set usable in tooltips. Order matters (most salient first). */
export function entityReferenceTags(e: Entity): string[] {
  const tags: string[] = [];
  if (e.is_master_bottleneck) tags.push("bottleneck");
  if (e.is_leverage_point) tags.push("leverage");
  if (e.is_risk_point) tags.push("risk");
  if (e.importance === "fundamental") tags.push("fundamental");
  else if (e.importance === "critical") tags.push("critical");
  return tags;
}

/** Full descriptor for an entity as a first-class proxy. */
export function deriveEntityDescriptor(e: Entity): ProxyDescriptor {
  const baseFriction = KNOWLEDGE_LAYER_FRICTION[e.knowledge_layer] ?? 0.3;
  const frontierFriction =
    e.is_decomposable && !e.is_expanded ? UNEXPANDED_FRONTIER_FRICTION : 0;
  const friction_cost = Math.min(
    baseFriction + frontierFriction,
    MAX_ENTITY_FRICTION
  );

  const expected_info_bits = entityReferenceInfoBits(e);

  return {
    id: `entity:${e.id}`,
    construct_id: `entity:${e.entity_id}`,
    kind: "entity_rollup",
    depth_tier: deriveDepthTier(e),
    friction_cost,
    expected_info_bits,
    data_categories: deriveDataCategories(e),
    metadata: {
      entity_id: e.entity_id,
      name: e.name,
      importance: e.importance,
      is_master_bottleneck: e.is_master_bottleneck,
      is_leverage_point: e.is_leverage_point,
      is_risk_point: e.is_risk_point,
      knowledge_layer: e.knowledge_layer,
      blast_radius: e.blast_radius,
      tags: entityReferenceTags(e),
    },
  };
}
