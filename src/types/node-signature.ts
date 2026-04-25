// ── Node signature substrate (Batch 6 — canonical signatures per dot) ───
//
// Locks the layered-ring-per-dot vision into the type system before any
// UI change. Every KG node gets a canonical signature whose depth grows
// as the pipeline discovers additional variables / variations about that
// node. "1 new variable = 1 new index in the signature tuple = 1 new
// ring layer" is enforced by the `basis.length === rings` invariant.
//
// Intentionally separate from `StructuralSignature` (in convergent-point.ts).
// That signature abstracts *outcome shapes* across focal nodes for
// clustering. NodeSignature is the per-entity canonical — distinct
// concept, distinct level in the stack.

import type { ProbabilitySpaceAxis } from "./pipeline-events";

// ── Typed relation enum ─────────────────────────────────────────────────
//
// Promotes `edges.relationship_type` from free-text LLM output to a
// closed vocabulary with intervention-aware semantics. The free-text
// field stays on the edge row (backward compat); this enum rides
// alongside as `relation_type` and is always populated by the agent.
//
// Ordering mirrors the user's design note (causes/enables/inhibits/...).
// The classifier is deterministic: given the dimension + polarity +
// free-text tag it resolves to exactly one member (fallback: `relates_to`).

export type RelationType =
  | "causes"              // direct productive effect (dimension=causal, polarity=positive)
  | "enables"             // permits but does not force (dimension=causal, polarity=conditional/positive + strength<0.8)
  | "inhibits"            // active suppression (dimension=causal, polarity=negative)
  | "moderates"           // alters strength of another edge
  | "mediates"            // sits on the path between two others
  | "constrains"          // sets an upper bound / ceiling
  | "composes"            // part-whole membership (dimension=structural)
  | "competes"            // negative coupling over shared resource
  | "temporally_precedes" // ordering without causation (dimension=temporal)
  | "relates_to";         // fallback — use sparingly; flags underspecified edges

// ── Resolution level ────────────────────────────────────────────────────
//
// First-class property for multi-scale refinement. A node's signature
// can deepen independently in two directions:
//   - `zoom`:    lower = coarser (the headline), higher = more variables resolved
//   - `horizon`: how far in time the signature commits to (hours vs years)
// The combination is a point on a resolution plane; the signature
// materializer decides whether to deepen zoom or horizon based on which
// reduces intervention-relevant uncertainty most.

export type ResolutionLevel = {
  /** 0..5. 0 = "node exists" only. 5 = fully decomposed with mechanism. */
  zoom: 0 | 1 | 2 | 3 | 4 | 5;
  /** Commitment window for any probability attached to this signature. */
  horizon: "immediate" | "hours" | "days" | "months" | "years" | "indefinite";
  /**
   * Reason the materializer stopped here — lets the UI explain why a
   * node isn't deeper ("budget exhausted", "no new mechanisms found",
   * "waiting on external source") without the user having to guess.
   */
  pinned_because: "budget" | "saturated" | "awaiting_evidence" | "user_locked";
};

// ── One ring layer ──────────────────────────────────────────────────────
//
// A basis element is a single variable/variation accreted onto the node.
// Each basis adds exactly one ring in the layered circular visual. The
// `index` is the stable position in the canonical signature tuple; do
// NOT reorder once assigned — downstream code keys ring colors off it.

export interface BasisElement {
  /** Stable tuple position. First basis is `index: 0` (innermost ring). */
  index: number;
  /** Short machine slug — the "signature code" shown on the ring. */
  code: string;
  /** Human-readable label for tooltip/expand-drawer. */
  label: string;
  /** Which probability axis this variable came from (when resolvable). */
  source_axis: ProbabilitySpaceAxis | null;
  /**
   * 0..1. How much intervention-relevant uncertainty this basis resolved.
   * The materializer deepens the signature until contribution of the
   * marginal basis falls below a threshold (default 0.05).
   */
  contribution: number;
  /** 0..1 confidence the basis applies — drives ring opacity in the UI. */
  confidence: number;
  /**
   * Controllability inherited from the source axis / expansion. Tells
   * the UI whether this ring should read as "actionable lever" or
   * "ambient context".
   */
  controllability: "direct" | "indirect" | "uncontrollable";
}

// ── Evidence trace (per basis) ──────────────────────────────────────────
//
// Every basis element can cite its provenance. Cheap to store, expensive
// to reconstruct later — saves a round-trip when the user clicks the
// ring to see "why is this here?".

export interface BasisEvidence {
  basis_index: number;
  source: "entity" | "edge" | "expansion" | "axis" | "cross_space_link" | "llm_inference";
  source_ids: string[]; // UUIDs or local ids depending on source
  claim: string;        // one-sentence citation
}

// ── The canonical node signature ────────────────────────────────────────

export interface NodeSignature {
  /** The node this signature describes. Matches `entities.id`. */
  entity_id: string;

  /**
   * Canonical external code — the user-facing ring label (e.g. "C1.α.3").
   * Built deterministically from `basis[].code` joined by ".". Changing
   * any ring rewrites the code, so downstream widgets can cache by it
   * and auto-invalidate when a ring deepens.
   */
  canonical_code: string;

  /** How many ring layers should render. Must equal basis.length. */
  rings: number;

  /** Ordered basis — index 0 is the innermost ring. Immutable per index. */
  basis: BasisElement[];

  /** Per-basis evidence. Index into `basis` via `basis_index`. */
  evidence: BasisEvidence[];

  /** Resolution plane position + pinning reason. */
  resolution: ResolutionLevel;

  /**
   * 0..1 aggregated uncertainty the signature still carries *after* its
   * current rings. Drives the "fog" overlay on the outermost ring in
   * the three-panel UI — high uncertainty = more diffuse edge.
   */
  residual_uncertainty: number;

  /**
   * Combination lattice — other NodeSignature.canonical_codes this one
   * composes with to form higher-order signatures. Used by the
   * cross-panel linker (same signature visible in landscape + KG + app).
   * Empty when the node stands alone.
   */
  composes_with: string[];

  /**
   * Consequence surface — the downstream outcomes this signature's
   * current resolution predicts. Each entry is an entity_id + a
   * probability under the node's horizon. Kept small (<=8) to keep
   * signatures lightweight; the full probability space lives in the
   * convergent-points + expansions tables.
   */
  consequence_surface: Array<{
    target_entity_id: string;
    probability: number;
    polarity: "positive" | "negative" | "neutral" | "conditional";
  }>;

  /** ISO timestamp — set at materialization, updated on deepen. */
  materialized_at: string;
  /** Bumped each time a basis is added. Enables optimistic concurrency. */
  version: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Deterministic canonical code builder. Pure function so both client
 * (widget rendering) and server (materializer agent) produce the same
 * string from the same basis list.
 */
export function buildCanonicalCode(basis: Pick<BasisElement, "code" | "index">[]): string {
  return [...basis]
    .sort((a, b) => a.index - b.index)
    .map((b) => b.code)
    .join(".");
}

/**
 * Validate that `rings`, `basis.length`, and `canonical_code` agree.
 * Returns a reason string when the invariant is broken; `null` otherwise.
 * The DB trigger in 20260423_node_signatures.sql enforces the same
 * invariant at write time — this is a client-side pre-flight.
 */
export function validateNodeSignature(sig: NodeSignature): string | null {
  if (sig.rings !== sig.basis.length) {
    return `rings (${sig.rings}) != basis.length (${sig.basis.length})`;
  }
  const indices = sig.basis.map((b) => b.index).sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) return `basis indices must be 0..${indices.length - 1}, got ${indices.join(",")}`;
  }
  const expected = buildCanonicalCode(sig.basis);
  if (expected !== sig.canonical_code) {
    return `canonical_code mismatch: expected ${expected}, got ${sig.canonical_code}`;
  }
  return null;
}
