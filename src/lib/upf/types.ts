/**
 * Unified Proxy Framework — core types (Phase 4c)
 *
 * A ProxyDescriptor is a domain-agnostic record describing one way of probing
 * a latent construct (an unobservable truth we care about: user confidence,
 * edge strength, working memory, strategy fit, …).
 *
 * The same type is used for:
 *   - open questions (kind: "question")
 *   - metric trackers (kind: "metric")
 *   - graph edges (kind: "edge")
 *   - decomposed-child rollups (kind: "entity_rollup")
 *
 * A *selector* looks at a list of descriptors for a construct + the user's
 * consent manifest and picks the one that maximises information per unit of
 * friction. The same function works across all four domains.
 */

import type { DataCategory } from "@/types/consent";

/** Orthogonal to data_category — how deep / costly is this proxy. */
export type DepthTier = "light" | "mid" | "heavy";

/** Which subsystem emitted this descriptor (used for routing in the selector). */
export type ProxyKind = "question" | "metric" | "edge" | "entity_rollup";

export interface ProxyDescriptor {
  /** Stable identifier (e.g. `question:<space_id>:<index>`, `tracker:<uuid>`). */
  id: string;

  /**
   * The latent construct this proxy probes — two descriptors with the same
   * construct_id are alternative ways of measuring the same thing, and are
   * candidates for calibration against each other.
   */
  construct_id: string;

  kind: ProxyKind;

  depth_tier: DepthTier;

  /** 0..1 — how much time / effort / privacy burden this proxy imposes. */
  friction_cost: number;

  /** Non-negative Shannon-ish estimate of information yield. */
  expected_info_bits: number;

  /**
   * What data categories this proxy requires (lines up with ConsentManifest).
   * Empty array = no personal data required (safe under any consent profile).
   */
  data_categories: DataCategory[];

  /**
   * Ids of *heavier* proxies this proxy can be calibrated against. Populated
   * for decomposed children (→ their parent rollup) and for light metrics
   * that have a known gold standard.
   */
  validates_against?: string[];

  /**
   * Phase 4c-final upgrade: the list of construct_ids this proxy yields
   * information about when observed. A question about entities A/B/C
   * probes three entity constructs; an infrastructure proposal that
   * implements components D/E and tracks metrics F/G probes four.
   *
   * When an observation is recorded against this proxy, every construct
   * in this list receives a Bayesian update (not just `construct_id`).
   * When the selector scores this proxy, it attenuates by the MAX posterior
   * variance across this list — so a proxy that still touches any unknown
   * stays live until every last one is pinned down.
   *
   * If omitted or empty, the selector falls back to `construct_id`.
   */
  probes_constructs?: string[];

  /**
   * Free-form metadata the scorer / selector / UI can use — NOT consumed by
   * the selector itself.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Score breakdown attached to a descriptor after the selector runs.
 * Exposed for debug UIs and "why was this picked" tooltips.
 */
export interface ProxyScore {
  descriptor_id: string;
  /** `expected_info_bits / (friction_cost + epsilon)` — the selector's objective. */
  value_per_friction: number;
  /** Pass-through from the descriptor for inline display. */
  expected_info_bits: number;
  friction_cost: number;
  /** One-sentence human-readable justification (used in tooltips). */
  rationale: string;
  /** True if the descriptor was dropped by consent filtering. */
  filtered_by_consent: boolean;
}

/** Selector input — the subset of ConsentManifest the selector cares about. */
export interface ConsentSnapshot {
  allowed_categories: DataCategory[];
  /** Optional 0..1 budget; if a descriptor's friction exceeds, it is dropped. */
  daily_friction_budget?: number;
}
