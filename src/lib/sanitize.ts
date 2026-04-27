/**
 * Universal sanitization layer — single source of truth for all DB constraint values.
 * Every route that inserts entities/edges/cycles MUST use these functions.
 * Derived directly from supabase/schema.sql CHECK constraints.
 */

// ── Canonical enum values (match Postgres CHECK constraints exactly) ──

export const ENTITY_CATEGORIES = ["concrete", "abstract", "process", "relational", "epistemic", "fault"] as const;
export const ENTITY_SOURCE_TAGS = ["explicit", "implicit", "assumed"] as const;
export const IMPORTANCE_LEVELS = ["fundamental", "critical", "important", "moderate"] as const;
export const AMBIGUITY_TYPES = ["harmful", "premature", "strategic"] as const;
export const CAUSAL_ROLES = ["truth", "evidence", "deliverable", "application", "outcome", "goal"] as const;
export const CLAIM_TYPES = ["mechanism", "assertion", "prediction", "assumption", "finding"] as const;

// ── Phase 10: canonical depth + layer ──
// Inlined (don't import from @/lib/whiteboard/layer-config to keep this
// file server-safe and dependency-free).
const LAYER_NAMES = ["system", "domain", "thread", "claim", "atom"] as const;
const LEGACY_LAYER_TO_DEPTH: Record<string, number> = {
  system: 0,
  domain: 1,
  thread: 2,
  claim: 3,
  property: 3,
  atom: 4,
  atomic: 4,
};
function normalizeLayerString(
  rawLayer: string | null,
  rawKnowledgeLayer: string | null,
): { layer: string; depth: number } {
  const l = (rawLayer ?? "").toLowerCase().trim();
  if (l in LEGACY_LAYER_TO_DEPTH) {
    const d = LEGACY_LAYER_TO_DEPTH[l];
    return { layer: LAYER_NAMES[d], depth: d };
  }
  const kl = (rawKnowledgeLayer ?? "").toLowerCase().trim();
  if (kl === "conceptual") return { layer: "domain", depth: 1 };
  if (kl === "external") return { layer: "claim", depth: 3 };
  if (kl === "bridge") return { layer: "thread", depth: 2 };
  return { layer: "thread", depth: 2 };
}

export const EDGE_DIMENSIONS = [
  "structural", "functional", "temporal", "causal",
  "correlational", "logical", "epistemic", "comparative", "agentive",
] as const;
export const EDGE_SOURCE_TAGS = ["stated", "inferred", "predicted"] as const;
export const EDGE_POLARITIES = ["positive", "negative", "neutral", "conditional"] as const;

export const CYCLE_CLASSIFICATIONS = ["reinforcing_positive", "reinforcing_negative", "balancing"] as const;
export const MATURITY_LEVELS = ["actionable_now", "waiting_on_dependency", "theoretical", "blocked"] as const;

export const EDGE_DYNAMICS = [
  "threshold", "linear", "compounding", "exponential",
  "logarithmic", "decay", "step_function", "delayed",
] as const;

// Set-theoretic topology — orthogonal to semantic relationship_type.
// A single edge can assert both "causes" (semantic) and "inside" (topological);
// they answer different questions. At scale, topology enables cheap logical
// consistency checks (A inside B AND A disjoint B → contradiction) without an LLM.
export const EDGE_TOPOLOGIES = [
  "inside",     // source's scope is fully contained within target's
  "overlap",    // shared concern, neither contains the other
  "meets",      // boundary contact with no shared interior (adjacent domains)
  "disjoint",   // explicitly separate — nothing in common
  "composes",   // source is a part making up target (mereological)
  "cover",      // source fully accounts for / explains target
  "equal",      // two framings of the same underlying concept — a dedup signal
] as const;

export const CYCLE_GROWTH_TYPES = ["additive", "multiplicative", "accelerating", "decelerating"] as const;

// ── Coercion utilities ──

/** Case-insensitive enum coercion with fuzzy matching */
function coerce<T extends string>(val: unknown, valid: readonly T[], fallback: T): T {
  if (typeof val !== "string" || !val) return fallback;
  const lower = val.toLowerCase().trim();

  // Exact match (case-insensitive)
  const exact = valid.find((v) => v === lower);
  if (exact) return exact;

  // Underscore/space normalization: "reinforcing positive" → "reinforcing_positive"
  const normalized = lower.replace(/[\s-]+/g, "_");
  const normMatch = valid.find((v) => v === normalized);
  if (normMatch) return normMatch;

  // Prefix match: "struct" → "structural"
  const prefix = valid.find((v) => v.startsWith(lower) || lower.startsWith(v));
  if (prefix) return prefix;

  // Contains match: "causal_temporal" → "causal" (first match)
  const contains = valid.find((v) => lower.includes(v));
  if (contains) return contains;

  return fallback;
}

/** Clamp a number to [min, max], with fallback for non-numbers */
function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val === "number" && !isNaN(val)) return Math.max(min, Math.min(max, val));
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (!isNaN(n)) return Math.max(min, Math.min(max, n));
  }
  return fallback;
}

/** Ensure a value is a non-empty string, or return fallback */
function str(val: unknown, fallback: string): string {
  if (typeof val === "string" && val.trim()) return val.trim();
  return fallback;
}

/** Ensure a value is boolean */
function bool(val: unknown, fallback = false): boolean {
  if (typeof val === "boolean") return val;
  return fallback;
}

// ── Category inference from entity_type ──

/**
 * Infer entity_category from entity_type when category is missing or invalid.
 * This prevents the mass-defaulting to "abstract" that makes graphs visually homogeneous.
 */
function inferCategoryFromType(entityType: string | undefined, rawCategory: unknown): string {
  // If the LLM provided a valid category, use it
  if (typeof rawCategory === "string" && rawCategory.trim()) {
    const lower = rawCategory.toLowerCase().trim().replace(/[\s-]+/g, "_");
    const match = ENTITY_CATEGORIES.find(c => c === lower);
    if (match) return match;
    // Fuzzy match — but refuse to land on "fault" via fuzzy matching.
    // Faults are only legitimate when the pipeline explicitly materializes
    // them from contradictions; inferring them from free text would produce
    // false positives.
    const candidates = ENTITY_CATEGORIES.filter(c => c !== "fault");
    const prefix = candidates.find(c => c.startsWith(lower) || lower.startsWith(c));
    if (prefix) return prefix;
  }

  // Infer from entity_type
  if (!entityType) return "abstract";
  const t = entityType.toLowerCase().trim();

  // Concrete types
  if (["person", "organization", "product", "asset", "artifact", "company", "tool", "platform", "technology", "team", "user", "customer", "market", "competitor", "resource", "infrastructure", "system"].some(w => t.includes(w))) {
    return "concrete";
  }
  // Process types
  if (["activity", "mechanism", "decision", "event", "process", "workflow", "strategy", "action", "operation", "procedure", "method", "practice", "cycle", "loop", "pipeline", "flow"].some(w => t.includes(w))) {
    return "process";
  }
  // Relational types
  if (["tradeoff", "trade-off", "dependency", "tension", "alignment", "relationship", "interaction", "connection", "bridge", "conflict", "balance"].some(w => t.includes(w))) {
    return "relational";
  }
  // Epistemic types
  if (["assumption", "claim", "unknown", "irreducible", "hypothesis", "question", "belief", "theory", "risk", "uncertainty"].some(w => t.includes(w))) {
    return "epistemic";
  }
  // Default to abstract for concepts, capabilities, qualities, metrics, constraints
  return "abstract";
}

// ── Sanitization stats tracking ──

export interface SanitizationStats {
  entities_before_dedup: number;
  entities_after_dedup: number;
  entities_removed_by_dedup: number;
  edges_before_filter: number;
  edges_after_confidence_filter: number;
  edges_after_sanitize: number;
  edges_removed_by_confidence: number;
  edges_removed_by_missing_ref: number;
  edges_removed_self_loops: number;
  category_distribution: Record<string, number>;
  importance_distribution: Record<string, number>;
}

export function createSanitizationStats(): SanitizationStats {
  return {
    entities_before_dedup: 0,
    entities_after_dedup: 0,
    entities_removed_by_dedup: 0,
    edges_before_filter: 0,
    edges_after_confidence_filter: 0,
    edges_after_sanitize: 0,
    edges_removed_by_confidence: 0,
    edges_removed_by_missing_ref: 0,
    edges_removed_self_loops: 0,
    category_distribution: {},
    importance_distribution: {},
  };
}

// ── Entity sanitization ──

export interface SanitizedEntity {
  space_id: string;
  entity_id: string;
  name: string;
  description: string | null;
  source_tag: string;
  entity_type: string;
  entity_category: string;
  layer: string | null;
  depth: number;
  importance: string;
  confidence: number;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  is_master_bottleneck: boolean;
  blast_radius: number;
  centrality_rank: number | null;
  is_shared_variable: boolean;
  is_decomposable: boolean;
  ambiguity_type: string | null;
  temporal_validity: Record<string, unknown> | null;
  manifold: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  authority_level: string | null;
  knowledge_layer: string | null;
  causal_role: string | null;
  // D1 · measurement spec, flattened to match
  // migration 20260609_entity_measurability.sql columns.
  measurement_unit: string | null;
  measurement_scale: string | null;
  measurement_protocol: Record<string, unknown> | null;
  measurement_cost_estimate: number | null;
  measurement_observability: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeEntity(raw: any, spaceId: string): SanitizedEntity {
  // ── Phase 10: canonical depth + layer ──
  // Callers may pass any of: (a) explicit integer `depth` (0..4 — authoritative),
  // (b) legacy `layer` string, or (c) nothing. We always derive a canonical
  // (layer, depth) pair so downstream consumers can trust the integer axis.
  const rawDepthNum = typeof raw.depth === "number" ? raw.depth : null;
  const canonical = (() => {
    if (rawDepthNum !== null && Number.isFinite(rawDepthNum)) {
      const d = Math.max(0, Math.min(4, Math.round(rawDepthNum)));
      return { layer: LAYER_NAMES[d], depth: d };
    }
    const layerStr = typeof raw.layer === "string" ? raw.layer : null;
    const klStr = typeof raw.knowledge_layer === "string" ? raw.knowledge_layer : null;
    return normalizeLayerString(layerStr, klStr);
  })();

  return {
    space_id: spaceId,
    entity_id: str(raw.entity_id, `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    name: str(raw.name, "Unknown Entity"),
    description: typeof raw.description === "string" ? raw.description.trim() : null,
    source_tag: coerce(raw.source_tag, ENTITY_SOURCE_TAGS, "implicit"),
    entity_type: str(raw.entity_type, "concept"),
    entity_category: inferCategoryFromType(raw.entity_type, raw.entity_category),
    layer: canonical.layer,
    depth: canonical.depth,
    importance: coerce(raw.importance, IMPORTANCE_LEVELS, "moderate"),
    confidence: clampNum(raw.confidence, 0, 1, 0.8),
    is_leverage_point: bool(raw.is_leverage_point),
    is_risk_point: bool(raw.is_risk_point),
    is_master_bottleneck: bool(raw.is_master_bottleneck),
    blast_radius: clampNum(raw.blast_radius, 0, 100, 0),
    centrality_rank: typeof raw.centrality_rank === "number" ? raw.centrality_rank : null,
    is_shared_variable: bool(raw.is_shared_variable),
    is_decomposable: bool(raw.is_decomposable),
    ambiguity_type: typeof raw.ambiguity_type === "string"
      ? coerce(raw.ambiguity_type, AMBIGUITY_TYPES, "premature")
      : null,
    temporal_validity: typeof raw.temporal_validity === "object" && raw.temporal_validity !== null
      ? raw.temporal_validity as Record<string, unknown>
      : null,
    manifold: (() => {
      const base = typeof raw.manifold === "object" && raw.manifold !== null
        ? raw.manifold as Record<string, unknown>
        : {} as Record<string, unknown>;
      // Phase 8: Pack epistemic framework fields into manifold JSONB
      const VALID_EPISTEMIC_STATUS = ["observed", "inferred", "theorized", "speculated", "contested"];
      const VALID_TOULMIN_ROLE = ["claim", "ground", "warrant", "backing", "qualifier", "rebuttal"];
      const VALID_MARR_LEVEL = ["computational", "algorithmic", "implementational"];
      if (typeof raw.epistemic_status === "string" && VALID_EPISTEMIC_STATUS.includes(raw.epistemic_status)) {
        base.epistemic_status = raw.epistemic_status;
      }
      if (typeof raw.toulmin_role === "string" && VALID_TOULMIN_ROLE.includes(raw.toulmin_role)) {
        base.toulmin_role = raw.toulmin_role;
      }
      if (typeof raw.marr_level === "string" && VALID_MARR_LEVEL.includes(raw.marr_level)) {
        base.marr_level = raw.marr_level;
      }
      // ── D3 · controllability profile pack-through ──
      // The structurer prompt nests controllability under
      // manifold.operational.controllability. We extract it cleanly,
      // dropping fabricated/malformed leaves rather than persisting
      // junk. Reversibility is mirrored from manifold.strategic for
      // ergonomic single-branch reads; the strategic-side value
      // remains authoritative.
      const VALID_CONTROLLABILITY_KIND = [
        "fully_controllable",
        "partially_controllable",
        "gated",
        "observable_only",
      ];
      const VALID_ESTIMATE_CONFIDENCE = ["high", "moderate", "low"];
      const VALID_REVERSIBILITY = [
        "easily_reversible",
        "costly_to_reverse",
        "irreversible",
      ];
      const VALID_COST_RECURRENCE = [
        "one_time",
        "recurring_monthly",
        "recurring_yearly",
        "recurring_continuous",
      ];
      const VALID_COST_KIND = [
        "direct",
        "opportunity_dominated",
        "coordination_dominated",
        "risk_adjusted_dominated",
        "switching_dominated",
        "hidden_externalities",
      ];
      const opIn =
        typeof base.operational === "object" && base.operational !== null
          ? (base.operational as Record<string, unknown>)
          : null;
      const stratIn =
        typeof base.strategic === "object" && base.strategic !== null
          ? (base.strategic as Record<string, unknown>)
          : null;
      const ctrlIn =
        opIn && typeof opIn.controllability === "object" && opIn.controllability !== null
          ? (opIn.controllability as Record<string, unknown>)
          : null;
      if (ctrlIn) {
        const cleaned: Record<string, unknown> = {};
        if (
          typeof ctrlIn.kind === "string" &&
          VALID_CONTROLLABILITY_KIND.includes(ctrlIn.kind)
        ) {
          cleaned.kind = ctrlIn.kind;
        }
        // intervention_cost: keep only if estimate is finite & non-negative
        const ic =
          typeof ctrlIn.intervention_cost === "object" &&
          ctrlIn.intervention_cost !== null
            ? (ctrlIn.intervention_cost as Record<string, unknown>)
            : null;
        if (
          ic &&
          typeof ic.estimate === "number" &&
          Number.isFinite(ic.estimate) &&
          ic.estimate >= 0 &&
          typeof ic.confidence === "string" &&
          VALID_ESTIMATE_CONFIDENCE.includes(ic.confidence)
        ) {
          const out: Record<string, unknown> = {
            estimate: ic.estimate,
            confidence: ic.confidence,
          };
          if (
            typeof ic.recurrence === "string" &&
            VALID_COST_RECURRENCE.includes(ic.recurrence)
          ) {
            out.recurrence = ic.recurrence;
          }
          if (typeof ic.is_sunk === "boolean") {
            out.is_sunk = ic.is_sunk;
          }
          if (typeof ic.notes === "string" && ic.notes.trim()) {
            out.notes = ic.notes.trim().slice(0, 500);
          }
          cleaned.intervention_cost = out;
        }
        // opportunity_cost: same shape rules as intervention_cost,
        // plus optional `alternative` field describing what's
        // foregone. Strategically often more important than direct
        // cost — surfaced as a peer field, not nested under
        // intervention_cost.
        const oc =
          typeof ctrlIn.opportunity_cost === "object" &&
          ctrlIn.opportunity_cost !== null
            ? (ctrlIn.opportunity_cost as Record<string, unknown>)
            : null;
        if (
          oc &&
          typeof oc.estimate === "number" &&
          Number.isFinite(oc.estimate) &&
          oc.estimate >= 0 &&
          typeof oc.confidence === "string" &&
          VALID_ESTIMATE_CONFIDENCE.includes(oc.confidence)
        ) {
          const out: Record<string, unknown> = {
            estimate: oc.estimate,
            confidence: oc.confidence,
          };
          if (typeof oc.alternative === "string" && oc.alternative.trim()) {
            out.alternative = oc.alternative.trim().slice(0, 500);
          }
          if (typeof oc.notes === "string" && oc.notes.trim()) {
            out.notes = oc.notes.trim().slice(0, 500);
          }
          cleaned.opportunity_cost = out;
        }
        // cost_kind: simple enum check
        if (
          typeof ctrlIn.cost_kind === "string" &&
          VALID_COST_KIND.includes(ctrlIn.cost_kind)
        ) {
          cleaned.cost_kind = ctrlIn.cost_kind;
        }
        // time_to_effect: keep only if lag string is non-empty
        const tte =
          typeof ctrlIn.time_to_effect === "object" &&
          ctrlIn.time_to_effect !== null
            ? (ctrlIn.time_to_effect as Record<string, unknown>)
            : null;
        if (
          tte &&
          typeof tte.lag === "string" &&
          tte.lag.trim().length > 0 &&
          typeof tte.confidence === "string" &&
          VALID_ESTIMATE_CONFIDENCE.includes(tte.confidence)
        ) {
          const out: Record<string, unknown> = {
            lag: tte.lag.trim().slice(0, 100),
            confidence: tte.confidence,
          };
          if (typeof tte.notes === "string" && tte.notes.trim()) {
            out.notes = tte.notes.trim().slice(0, 500);
          }
          cleaned.time_to_effect = out;
        }
        // modulation_range: keep only if min/max are finite numbers and min < max
        const mr =
          typeof ctrlIn.modulation_range === "object" &&
          ctrlIn.modulation_range !== null
            ? (ctrlIn.modulation_range as Record<string, unknown>)
            : null;
        if (
          mr &&
          typeof mr.min === "number" &&
          typeof mr.max === "number" &&
          Number.isFinite(mr.min) &&
          Number.isFinite(mr.max) &&
          mr.min < mr.max
        ) {
          const out: Record<string, unknown> = { min: mr.min, max: mr.max };
          if (typeof mr.unit === "string" && mr.unit.trim()) {
            out.unit = mr.unit.trim().slice(0, 100);
          }
          cleaned.modulation_range = out;
        }
        // Mirror reversibility from manifold.strategic for ergonomic reads.
        if (
          stratIn &&
          typeof stratIn.reversibility === "string" &&
          VALID_REVERSIBILITY.includes(stratIn.reversibility)
        ) {
          cleaned.reversibility = stratIn.reversibility;
        }
        // Replace the input controllability with the cleaned version
        // (or drop it entirely if empty).
        if (Object.keys(cleaned).length > 0) {
          (base.operational as Record<string, unknown>) = {
            ...(opIn ?? {}),
            controllability: cleaned,
          };
        } else if (opIn) {
          // Drop the malformed controllability while keeping the rest of operational.
          const { controllability: _drop, ...rest } = opIn;
          void _drop;
          base.operational = rest;
        }
      }
      return Object.keys(base).length > 0 ? base : null;
    })(),
    provenance: typeof raw.provenance === "object" && raw.provenance !== null
      ? raw.provenance as Record<string, unknown>
      : null,
    authority_level: typeof raw.authority_level === "string" ? raw.authority_level.trim() : null,
    knowledge_layer: typeof raw.knowledge_layer === "string" ? raw.knowledge_layer.trim() : null,
    causal_role: typeof raw.causal_role === "string"
      ? coerce(raw.causal_role, CAUSAL_ROLES, "truth")
      : null,
    // ── D1 · measurement spec extraction ──
    // Accepts the canonical { unit, scale, protocol, cost_estimate,
    // observability } shape from the structurer prompt, AND tolerates
    // legacy/flat shapes from manual callers that pass measurement
    // fields at the top level of `raw`. Soft-fail throughout: any
    // missing or malformed leaf becomes null rather than blocking
    // the insert.
    ...(() => {
      // Prefer the nested shape (what the structuring prompt emits).
      const nested =
        typeof raw.measurement === "object" && raw.measurement !== null
          ? (raw.measurement as Record<string, unknown>)
          : null;

      const unitRaw = nested?.unit ?? raw.measurement_unit;
      const scaleRaw = nested?.scale ?? raw.measurement_scale;
      const protocolRaw = nested?.protocol ?? raw.measurement_protocol;
      const costRaw = nested?.cost_estimate ?? raw.measurement_cost_estimate;
      const obsRaw = nested?.observability ?? raw.measurement_observability;

      const unit =
        typeof unitRaw === "string" && unitRaw.trim().length > 0
          ? unitRaw.trim().slice(0, 200)
          : null;

      const VALID_SCALES = ["continuous", "ordinal", "categorical", "binary"];
      const scale =
        typeof scaleRaw === "string" && VALID_SCALES.includes(scaleRaw)
          ? scaleRaw
          : null;

      const protocol =
        typeof protocolRaw === "object" && protocolRaw !== null
          ? (protocolRaw as Record<string, unknown>)
          : null;

      const cost =
        typeof costRaw === "number" && Number.isFinite(costRaw) && costRaw >= 0
          ? costRaw
          : null;

      const VALID_OBS = [
        "directly_observable",
        "proxy_required",
        "inferred_only",
        "unobservable",
      ];
      const observability =
        typeof obsRaw === "string" && VALID_OBS.includes(obsRaw)
          ? obsRaw
          : null;

      return {
        // unit + scale travel as a pair: dropping one drops the other,
        // matching the validator's half-spec rejection. Avoids storing
        // a unit with no scale (which would break simulator dispatch).
        measurement_unit: unit && scale ? unit : null,
        measurement_scale: unit && scale ? scale : null,
        measurement_protocol: protocol,
        measurement_cost_estimate: cost,
        measurement_observability: observability,
      };
    })(),
  };
}

// ── Evidence basis extraction (for claim persistence) ──

export interface ExtractedEvidence {
  claim: string;
  claim_type: string;
  confidence: number;
  reasoning: string;
  /**
   * Verbatim quote from user input, OR "IMPLICIT: <reason>" / "ASSUMED: <reason>".
   * null when the LLM did not provide one.
   */
  source_quote: string | null;
}

/**
 * Extracts and validates evidence_basis items from a raw entity.
 * Returns validated array ready for insertion into the claims table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractEvidenceBasis(raw: any): ExtractedEvidence[] {
  if (!Array.isArray(raw?.evidence_basis)) return [];

  return raw.evidence_basis
    .filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item: any) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.claim === "string" &&
        item.claim.trim().length > 0
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      const rawQuote = typeof item.source_quote === "string" ? item.source_quote.trim() : "";
      return {
        claim: String(item.claim).trim().slice(0, 2000),
        claim_type: CLAIM_TYPES.includes(item.claim_type) ? item.claim_type : "assertion",
        confidence: clampNum(item.confidence, 0, 1, 0.5),
        reasoning: typeof item.reasoning === "string" ? item.reasoning.trim().slice(0, 2000) : "",
        // Keep IMPLICIT:/ASSUMED: prefixes intact so the UI can distinguish modes.
        // Cap at 500 chars for explicit quotes (plenty for a meaningful excerpt).
        source_quote: rawQuote.length > 0 ? rawQuote.slice(0, 500) : null,
      };
    })
    .slice(0, 6); // Max 6 claims per entity
}

// ── Edge sanitization ──

export interface SanitizedEdge {
  space_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension: string;
  source_tag: string;
  strength: number;
  polarity: string;
  confidence: number;
  conditions: string | null;
  is_tradeoff: boolean;
  resolved_by_entity_id: string | null;
  is_part_of_cycle: boolean;
  cycle_id: string | null;
  dynamics: string | null;
  dynamics_properties: Record<string, unknown> | null;
  utility: Record<string, unknown> | null;
  temporal_validity: Record<string, unknown> | null;
  topology: string | null;
}

/**
 * Derive a topology value from the semantic relationship_type when the LLM
 * did not provide one explicitly. Conservative — returns null for types that
 * don't imply a clear set-theoretic relationship. Only the obvious mappings
 * are encoded here; ambiguous types stay null rather than guess.
 */
function deriveTopologyFromRelationshipType(rt: string | undefined): string | null {
  if (!rt || typeof rt !== "string") return null;
  const t = rt.toLowerCase().trim().replace(/[\s-]+/g, "_");

  // Mereological / structural → composes
  if (t === "part_of" || t === "partof" || t === "has_part" || t === "contains" || t === "composed_of" || t === "part_of_whole") {
    return "composes";
  }
  // Identity / equivalence → equal (strong dedup signal)
  if (t === "is_equivalent_to" || t === "same_as" || t === "synonymous_with" || t === "equals" || t === "equivalent") {
    return "equal";
  }
  // Containment → inside
  if (t === "is_a" || t === "instance_of" || t === "subset_of" || t === "within" || t === "inside_of") {
    return "inside";
  }
  // Explicit separation → disjoint
  if (t === "contradicts" || t === "mutually_exclusive" || t === "excludes" || t === "incompatible_with") {
    return "disjoint";
  }
  return null;
}

/**
 * Sanitize an edge for DB insert. Returns null if source/target can't be resolved.
 * @param entityIdMap Maps LLM entity_id → Postgres UUID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeEdge(raw: any, spaceId: string, entityIdMap: Map<string, string>): SanitizedEdge | null {
  const srcId = str(raw.source_entity_id, "");
  const tgtId = str(raw.target_entity_id, "");
  const srcUuid = entityIdMap.get(srcId);
  const tgtUuid = entityIdMap.get(tgtId);

  if (!srcUuid || !tgtUuid) return null;
  if (srcUuid === tgtUuid) return null; // Self-loops are meaningless

  return {
    space_id: spaceId,
    source_entity_id: srcUuid,
    target_entity_id: tgtUuid,
    relationship_type: str(raw.relationship_type, "relates-to"),
    dimension: coerce(raw.dimension, EDGE_DIMENSIONS, "functional"),
    source_tag: coerce(raw.source_tag, EDGE_SOURCE_TAGS, "inferred"),
    strength: clampNum(raw.strength, 0, 1, 0.5),
    polarity: coerce(raw.polarity, EDGE_POLARITIES, "positive"),
    confidence: clampNum(raw.confidence, 0, 1, 0.8),
    conditions: typeof raw.conditions === "string" ? raw.conditions.trim() : null,
    is_tradeoff: bool(raw.is_tradeoff),
    resolved_by_entity_id: typeof raw.resolved_by_entity_id === "string"
      ? entityIdMap.get(raw.resolved_by_entity_id) ?? null
      : null,
    is_part_of_cycle: bool(raw.is_part_of_cycle),
    cycle_id: typeof raw.cycle_id === "string" ? raw.cycle_id : null,
    dynamics: typeof raw.dynamics === "string"
      ? coerce(raw.dynamics, EDGE_DYNAMICS, "linear")
      : null,
    dynamics_properties:
      raw.dynamics_properties && typeof raw.dynamics_properties === "object"
        ? raw.dynamics_properties
        : null,
    utility: (() => {
      const base = typeof raw.utility === "object" && raw.utility !== null
        ? raw.utility as Record<string, unknown>
        : {} as Record<string, unknown>;
      // Phase 8: Pack Pearl's causal level into utility JSONB
      const VALID_PEARL_LEVEL = ["association", "intervention", "counterfactual"];
      if (typeof raw.pearl_level === "string" && VALID_PEARL_LEVEL.includes(raw.pearl_level)) {
        base.pearl_level = raw.pearl_level;
      }
      return Object.keys(base).length > 0 ? base : null;
    })(),
    temporal_validity: typeof raw.temporal_validity === "object" && raw.temporal_validity !== null
      ? raw.temporal_validity as Record<string, unknown>
      : null,
    topology: (() => {
      // Prefer LLM-provided value if valid; otherwise derive from relationship_type.
      if (typeof raw.topology === "string" && raw.topology.trim()) {
        const normalized = raw.topology.toLowerCase().trim().replace(/[\s-]+/g, "_");
        const match = EDGE_TOPOLOGIES.find((t) => t === normalized);
        if (match) return match;
      }
      return deriveTopologyFromRelationshipType(raw.relationship_type);
    })(),
  };
}

// ── Cycle sanitization ──

export interface SanitizedCycle {
  space_id: string;
  cycle_id: string;
  name: string | null;
  classification: string;
  entity_ids: string[];
  intervention_point_entity_id: string | null;
  intervention_description: string | null;
  description: string | null;
  growth_type: string | null;
  cycle_time: string | null;
  estimated_multiplier: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeCycle(raw: any, spaceId: string, entityIdMap: Map<string, string>): SanitizedCycle | null {
  // entity_ids stores DISPLAY IDs (C1, C5) not UUIDs — keep the original text IDs
  // Only validate that they exist in the entityIdMap (meaning the entity was inserted)
  const entityIds = Array.isArray(raw.entity_ids)
    ? raw.entity_ids.filter((id: string) => typeof id === "string" && entityIdMap.has(id)) as string[]
    : [];

  // Need at least 2 entities for a cycle
  if (entityIds.length < 2) return null;

  const interventionId = raw.intervention_point_entity_id
    ? entityIdMap.get(raw.intervention_point_entity_id) ?? null
    : raw.intervention_point
      ? entityIdMap.get(raw.intervention_point) ?? null
      : null;

  return {
    space_id: spaceId,
    cycle_id: str(raw.cycle_id, `cy_${Date.now()}`),
    name: typeof raw.name === "string" ? raw.name.trim() : null,
    classification: coerce(raw.classification, CYCLE_CLASSIFICATIONS, "reinforcing_positive"),
    entity_ids: entityIds,
    intervention_point_entity_id: interventionId,
    intervention_description: typeof raw.intervention_description === "string" ? raw.intervention_description.trim() : null,
    description: typeof raw.description === "string" ? raw.description.trim() : null,
    growth_type: typeof raw.growth_type === "string"
      ? coerce(raw.growth_type, CYCLE_GROWTH_TYPES, "multiplicative")
      : null,
    cycle_time: typeof raw.cycle_time === "string" ? raw.cycle_time.trim() : null,
    estimated_multiplier: typeof raw.estimated_multiplier === "number"
      ? Math.max(0, Math.min(100, raw.estimated_multiplier))
      : null,
  };
}

// ── Fault materialization ──
// Contradictions surfaced during decomposition used to live as loose JSON on
// the space. Promoting them to first-class entities makes them navigable and
// lets critique/synthesis reference them via edges. These helpers build the
// entity + edge shape before sanitize/insert.

export interface ContradictionInput {
  assumption_text?: string;
  conclusion_text?: string;
  severity?: "critical" | "moderate" | "minor" | string;
  description?: string;
  // Optional: entity IDs the LLM flagged as participants in the contradiction.
  involved_entity_ids?: string[];
}

export interface MaterializedFault {
  entity: {
    entity_id: string;
    name: string;
    description: string;
    entity_category: "fault";
    entity_type: string;
    source_tag: "implicit";
    importance: string;
    confidence: number;
    knowledge_layer: string;
    provenance: Record<string, unknown>;
  };
  // Edges connecting the fault to entities it implicates. Topology = "disjoint"
  // because a fault explicitly names entities that cannot simultaneously hold.
  edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: "logical";
    source_tag: "inferred";
    strength: number;
    polarity: "negative";
    confidence: number;
    conditions: string;
    topology: "disjoint";
  }>;
}

/**
 * Turn a contradiction record into a fault entity plus edges to the entities
 * it implicates. Returns null for contradictions too thin to be useful
 * (missing text or no involved entities).
 */
export function materializeFault(
  raw: ContradictionInput,
  index: number,
  existingEntityIds: Set<string>,
): MaterializedFault | null {
  const assumption = typeof raw.assumption_text === "string" ? raw.assumption_text.trim() : "";
  const conclusion = typeof raw.conclusion_text === "string" ? raw.conclusion_text.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";

  if (!assumption && !conclusion && !description) return null;

  // Filter involved IDs to those that actually exist in the graph.
  const involved = Array.isArray(raw.involved_entity_ids)
    ? raw.involved_entity_ids.filter((id) => typeof id === "string" && existingEntityIds.has(id))
    : [];

  // Faults with no grounding entities are less valuable but still worth
  // surfacing; we create the entity but no edges.
  const severity = ["critical", "moderate", "minor"].includes(String(raw.severity))
    ? (raw.severity as "critical" | "moderate" | "minor")
    : "moderate";

  const importance = severity === "critical" ? "critical" : severity === "moderate" ? "important" : "moderate";

  const name = assumption && conclusion
    ? `Fault: ${assumption.slice(0, 60)} vs ${conclusion.slice(0, 60)}`
    : `Fault: ${(assumption || conclusion || description).slice(0, 100)}`;

  const fullDescription = [
    assumption ? `Assumption: ${assumption}` : "",
    conclusion ? `Conclusion: ${conclusion}` : "",
    description ? `Impact: ${description}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const entityId = `fault_${index + 1}`;

  const edges: MaterializedFault["edges"] = involved.map((targetId) => ({
    source_entity_id: entityId,
    target_entity_id: targetId,
    relationship_type: "contradicts",
    dimension: "logical",
    source_tag: "inferred",
    strength: 0.7,
    polarity: "negative",
    confidence: severity === "critical" ? 0.85 : 0.7,
    conditions: description || assumption || conclusion || "",
    topology: "disjoint",
  }));

  return {
    entity: {
      entity_id: entityId,
      name,
      description: fullDescription,
      entity_category: "fault",
      entity_type: "contradiction",
      source_tag: "implicit",
      importance,
      confidence: severity === "critical" ? 0.85 : 0.7,
      knowledge_layer: "conceptual",
      provenance: {
        source_type: "fault_materialization",
        severity,
        assumption_text: assumption || null,
        conclusion_text: conclusion || null,
        involved_entity_ids: involved,
      },
    },
    edges,
  };
}

// ── Confidence-based edge filtering ──

/**
 * Filter out edges below the confidence threshold, with a post-filter
 * density guard to prevent over-aggressive filtering from creating
 * disconnected sparse graphs.
 *
 * Lowered from 0.4 → 0.2: aggressive thresholds silently dropped 30-60%
 * of edges. Now uses a density floor: if filtering would drop edge density
 * below minDensity (edges/entityCount), the threshold is automatically
 * lowered until density is met.
 *
 * Edges below the final threshold are dropped; edges in the 0.2-0.5 range
 * are kept but will render with dashed lines to indicate lower confidence.
 */
export function filterLowConfidenceEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[],
  minConfidence = 0.2,
  entityCount?: number,
  minDensity = 2.0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const before = edges.length;

  // Sort by confidence descending for density-aware fallback
  const sorted = [...edges].sort((a, b) => {
    const confA = typeof a.confidence === "number" ? a.confidence : 0.8;
    const confB = typeof b.confidence === "number" ? b.confidence : 0.8;
    return confB - confA;
  });

  let filtered = sorted.filter((e) => {
    const conf = typeof e.confidence === "number" ? e.confidence : 0.8;
    return conf >= minConfidence;
  });

  // Density guard: if we know entity count, ensure filtering doesn't break the graph
  if (entityCount && entityCount > 0 && filtered.length < entityCount * minDensity) {
    const needed = Math.ceil(entityCount * minDensity);
    if (sorted.length >= needed) {
      // Take enough edges to meet density floor, even if below minConfidence
      filtered = sorted.slice(0, Math.min(needed, sorted.length));
      const lowestConf = typeof filtered[filtered.length - 1]?.confidence === "number"
        ? filtered[filtered.length - 1].confidence
        : minConfidence;
      console.log(`[sanitize] Density guard: relaxed threshold from ${minConfidence} → ${(lowestConf as number).toFixed(2)} to maintain density ${minDensity} (needed ${needed} edges for ${entityCount} entities)`);
    } else {
      // Not enough edges even with zero threshold — keep all
      filtered = sorted;
      console.log(`[sanitize] Density guard: keeping ALL ${sorted.length} edges (not enough to meet density ${minDensity} for ${entityCount} entities)`);
    }
  }

  if (before !== filtered.length) {
    console.log(`[sanitize] Confidence filter: ${before} → ${filtered.length} edges (removed ${before - filtered.length})`);
  }
  return filtered;
}

// ── Topology-equal deduplication ──
// At scale, duplicates are the #1 noise source. The LLM sometimes recognizes
// that two differently-named entities are the same concept and emits an edge
// with topology=equal instead of merging them in Tier 2. This pass collapses
// those pairs post-hoc using union-find so transitive equalities (A=B, B=C)
// collapse all three to one canonical.

interface RawEntityForMerge {
  entity_id: string;
  name: string;
  description?: unknown;
  importance?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
}

interface RawEdgeForMerge {
  source_entity_id: string;
  target_entity_id: string;
  topology?: unknown;
  relationship_type?: unknown;
  [key: string]: unknown;
}

// Importance used as a tiebreaker when picking the canonical entity.
const IMPORTANCE_RANK: Record<string, number> = {
  fundamental: 4,
  critical: 3,
  important: 2,
  moderate: 1,
};

function pickCanonical<T extends RawEntityForMerge>(a: T, b: T): T {
  // Prefer higher importance
  const impA = IMPORTANCE_RANK[String(a.importance ?? "")] ?? 0;
  const impB = IMPORTANCE_RANK[String(b.importance ?? "")] ?? 0;
  if (impA !== impB) return impA > impB ? a : b;

  // Then prefer richer description
  const descA = typeof a.description === "string" ? a.description.length : 0;
  const descB = typeof b.description === "string" ? b.description.length : 0;
  if (descA !== descB) return descA > descB ? a : b;

  // Then higher confidence
  const confA = typeof a.confidence === "number" ? a.confidence : 0;
  const confB = typeof b.confidence === "number" ? b.confidence : 0;
  if (confA !== confB) return confA > confB ? a : b;

  // Finally, stable by entity_id
  return a.entity_id < b.entity_id ? a : b;
}

/**
 * Collapse entities connected by topology=equal edges. Uses union-find so that
 * transitive equalities (A equal B, B equal C) correctly merge all three. The
 * equal-edges themselves are removed (they become self-loops after merge).
 *
 * Returns the reduced entity set plus edges with source/target remapped to
 * canonical IDs. Safe to call on any entity+edge pair — if no equal edges
 * exist, returns inputs unchanged.
 */
export function mergeByTopologyEqual<E extends RawEntityForMerge, D extends RawEdgeForMerge>(
  entities: E[],
  edges: D[],
): { entities: E[]; edges: D[]; mergesApplied: number } {
  if (entities.length === 0) return { entities, edges, mergesApplied: 0 };

  const equalEdges = edges.filter((e) => e.topology === "equal");
  if (equalEdges.length === 0) return { entities, edges, mergesApplied: 0 };

  // Union-find over entity_ids
  const parent = new Map<string, string>();
  for (const e of entities) parent.set(e.entity_id, e.entity_id);

  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur) ?? cur;
      parent.set(cur, parent.get(p) ?? p); // path compression
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };

  const byId = new Map<string, E>();
  for (const e of entities) byId.set(e.entity_id, e);

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const entA = byId.get(ra);
    const entB = byId.get(rb);
    if (!entA || !entB) {
      // One side isn't in the entity list — just link without canonical choice
      parent.set(rb, ra);
      return;
    }
    const canonical = pickCanonical(entA, entB);
    const loser = canonical.entity_id === entA.entity_id ? rb : ra;
    const winner = canonical.entity_id === entA.entity_id ? ra : rb;
    parent.set(loser, winner);
  };

  let validEqualEdges = 0;
  for (const e of equalEdges) {
    if (!byId.has(e.source_entity_id) || !byId.has(e.target_entity_id)) continue;
    if (e.source_entity_id === e.target_entity_id) continue;
    union(e.source_entity_id, e.target_entity_id);
    validEqualEdges++;
  }

  if (validEqualEdges === 0) return { entities, edges, mergesApplied: 0 };

  // Build canonical-only entity list
  const canonicalEntities: E[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    const root = find(e.entity_id);
    if (seen.has(root)) continue;
    seen.add(root);
    // Push the entity whose id IS the root — that's the canonical one picked by union()
    const canon = byId.get(root);
    if (canon) canonicalEntities.push(canon);
  }

  // Remap edges: source/target → canonical; drop self-loops; drop the equal-edges
  // themselves since the entities they related are now the same node.
  const remappedEdges: D[] = [];
  let droppedEqual = 0;
  let droppedSelfLoop = 0;
  for (const edge of edges) {
    if (edge.topology === "equal") {
      droppedEqual++;
      continue;
    }
    const src = find(edge.source_entity_id);
    const tgt = find(edge.target_entity_id);
    if (src === tgt) {
      droppedSelfLoop++;
      continue;
    }
    remappedEdges.push({
      ...edge,
      source_entity_id: src,
      target_entity_id: tgt,
    });
  }

  const mergesApplied = entities.length - canonicalEntities.length;
  if (mergesApplied > 0) {
    console.log(
      `[sanitize] Topology-equal merge: ${entities.length} → ${canonicalEntities.length} entities (${mergesApplied} merged via ${validEqualEdges} equal-edges; dropped ${droppedEqual} equal-edges and ${droppedSelfLoop} self-loops post-merge)`
    );
  }

  return { entities: canonicalEntities, edges: remappedEdges, mergesApplied };
}

// ── Entity deduplication ──

interface RawEntity {
  entity_id: string;
  name: string;
  [key: string]: unknown;
}

interface RawEdge {
  source_entity_id: string;
  target_entity_id: string;
  [key: string]: unknown;
}

/**
 * Deduplicate entities by normalized name similarity.
 * Remaps all edge references to canonical entity IDs.
 */
export function deduplicateEntities(
  entities: RawEntity[],
  edges: RawEdge[]
): { entities: RawEntity[]; edges: RawEdge[] } {
  if (entities.length === 0) return { entities, edges };

  const normalize = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\b(the|a|an|of|in|for|and|or|to)\b/g, "").trim().replace(/\s+/g, " ");

  // Group by normalized name
  const groups = new Map<string, RawEntity[]>();
  for (const e of entities) {
    const key = normalize(e.name);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(e);
    } else {
      groups.set(key, [e]);
    }
  }

  // Build remap: pick the entity with the longest description as canonical
  const remap = new Map<string, string>(); // old entity_id → canonical entity_id
  const deduped: RawEntity[] = [];

  for (const group of groups.values()) {
    // Sort by description length descending, pick first as canonical
    group.sort((a, b) => {
      const aLen = typeof a.description === "string" ? a.description.length : 0;
      const bLen = typeof b.description === "string" ? b.description.length : 0;
      return bLen - aLen;
    });
    const canonical = group[0];
    deduped.push(canonical);
    for (const e of group) {
      if (e.entity_id !== canonical.entity_id) {
        remap.set(e.entity_id, canonical.entity_id);
      }
    }
  }

  // Remap edges
  const remappedEdges = edges.map((e) => ({
    ...e,
    source_entity_id: remap.get(e.source_entity_id) ?? e.source_entity_id,
    target_entity_id: remap.get(e.target_entity_id) ?? e.target_entity_id,
  }));

  // Remove self-referencing edges after remap
  const filteredEdges = remappedEdges.filter(
    (e) => e.source_entity_id !== e.target_entity_id
  );

  if (entities.length !== deduped.length) {
    console.log(`[sanitize] Dedup: ${entities.length} → ${deduped.length} entities (merged ${entities.length - deduped.length})`);
    // Log merged entities for debugging
    for (const [key, group] of groups.entries()) {
      if (group.length > 1) {
        console.log(`[sanitize]   Merged "${key}": ${group.map(e => e.entity_id).join(", ")} → ${group[0].entity_id}`);
      }
    }
  }
  if (edges.length !== filteredEdges.length) {
    console.log(`[sanitize] Dedup edge remap: ${edges.length} → ${filteredEdges.length} edges (${edges.length - filteredEdges.length} became self-loops)`);
  }

  return { entities: deduped, edges: filteredEdges };
}

// ── Resilient batch insert ──

/**
 * Insert rows with batch-first, individual-fallback strategy.
 * Returns count of successfully inserted rows and the ID map.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Parse a PostgREST schema-cache error message to extract the missing
// column name. Supabase returns messages like:
//   "Could not find the 'depth' column of 'entities' in the schema cache"
// When that happens the DB genuinely has the column (post-migration) but
// PostgREST hasn't reloaded its introspection yet — or the migration
// hasn't run. Either way, stripping the column lets the pipeline
// produce *something* instead of inserting zero rows. Data loss is
// scoped to that single field.
function extractMissingColumn(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.match(/Could not find the '([^']+)' column/);
  return m?.[1] ?? null;
}

export async function resilientInsert<T extends Record<string, any>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  table: string,
  rows: T[],
  selectFields = "id"
): Promise<{ inserted: number; data: Array<Record<string, string>> }> {
  if (rows.length === 0) return { inserted: 0, data: [] };

  // Try batch insert first
  let workingRows: Record<string, any>[] = rows as Record<string, any>[];
  const strippedColumns: string[] = [];

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db
      .from(table)
      .insert(workingRows)
      .select(selectFields);

    if (!error && data) {
      if (strippedColumns.length > 0) {
        console.warn(
          `[resilientInsert] ${table}: inserted ${data.length} rows after stripping stale-schema columns: ${strippedColumns.join(", ")}. Run 'NOTIFY pgrst, \\'reload schema\\';' in Supabase SQL to clear the cache.`,
        );
      }
      return { inserted: data.length, data };
    }

    // If the failure is a schema-cache miss, strip the offending
    // column from every row and retry. This transforms the common
    // "migration ran but PostgREST cache is stale" failure mode
    // into a soft-degraded success instead of a full pipeline
    // blackout.
    const missingCol = extractMissingColumn(error?.message);
    if (missingCol) {
      strippedColumns.push(missingCol);
      workingRows = workingRows.map((r) => {
        const clone = { ...r };
        delete clone[missingCol];
        return clone;
      });
      continue;
    }

    // Not a schema-cache problem — break to the per-row fallback.
    console.warn(
      `[resilientInsert] Batch insert into ${table} failed: ${error?.message}. Trying individually (${rows.length} rows)`,
    );
    break;
  }

  // Per-row fallback. Uses the same stripped rows (so individual
  // inserts don't re-hit the schema-cache error 20 times) and the
  // same recovery if a new missing column surfaces row-by-row.
  const results: Array<Record<string, string>> = [];
  for (let i = 0; i < workingRows.length; i++) {
    let row = workingRows[i];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: d, error: e } = await db
        .from(table)
        .insert(row)
        .select(selectFields)
        .single();

      if (!e && d) {
        results.push(d);
        break;
      }
      const missingCol = extractMissingColumn(e?.message);
      if (missingCol) {
        if (!strippedColumns.includes(missingCol)) strippedColumns.push(missingCol);
        row = { ...row };
        delete row[missingCol];
        continue;
      }
      console.warn(
        `[resilientInsert] Row insert failed: ${e?.message}`,
        JSON.stringify(row).slice(0, 200),
      );
      break;
    }
  }

  return { inserted: results.length, data: results };
}
