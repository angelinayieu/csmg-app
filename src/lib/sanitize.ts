/**
 * Universal sanitization layer — single source of truth for all DB constraint values.
 * Every route that inserts entities/edges/cycles MUST use these functions.
 * Derived directly from supabase/schema.sql CHECK constraints.
 */

// ── Canonical enum values (match Postgres CHECK constraints exactly) ──

export const ENTITY_CATEGORIES = ["concrete", "abstract", "process", "relational", "epistemic"] as const;
export const ENTITY_SOURCE_TAGS = ["explicit", "implicit", "assumed"] as const;
export const IMPORTANCE_LEVELS = ["fundamental", "critical", "important", "moderate"] as const;

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
  importance: string;
  confidence: number;
  is_leverage_point: boolean;
  is_risk_point: boolean;
  is_master_bottleneck: boolean;
  blast_radius: number;
  centrality_rank: number | null;
  is_shared_variable: boolean;
  is_decomposable: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeEntity(raw: any, spaceId: string): SanitizedEntity {
  return {
    space_id: spaceId,
    entity_id: str(raw.entity_id, `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    name: str(raw.name, "Unknown Entity"),
    description: typeof raw.description === "string" ? raw.description.trim() : null,
    source_tag: coerce(raw.source_tag, ENTITY_SOURCE_TAGS, "implicit"),
    entity_type: str(raw.entity_type, "concept"),
    entity_category: coerce(raw.entity_category, ENTITY_CATEGORIES, "abstract"),
    layer: typeof raw.layer === "string" ? raw.layer.trim() : null,
    importance: coerce(raw.importance, IMPORTANCE_LEVELS, "moderate"),
    confidence: clampNum(raw.confidence, 0, 1, 0.8),
    is_leverage_point: bool(raw.is_leverage_point),
    is_risk_point: bool(raw.is_risk_point),
    is_master_bottleneck: bool(raw.is_master_bottleneck),
    blast_radius: clampNum(raw.blast_radius, 0, 100, 0),
    centrality_rank: typeof raw.centrality_rank === "number" ? raw.centrality_rank : null,
    is_shared_variable: bool(raw.is_shared_variable),
    is_decomposable: bool(raw.is_decomposable),
  };
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

// ── Confidence-based edge filtering ──

/**
 * Filter out edges below the confidence threshold.
 * Edges < 0.4 confidence are dropped entirely — a false edge corrupts analysis more than a missing one.
 */
export function filterLowConfidenceEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: any[],
  minConfidence = 0.4
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  return edges.filter((e) => {
    const conf = typeof e.confidence === "number" ? e.confidence : 0.8;
    return conf >= minConfidence;
  });
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

  return { entities: deduped, edges: filteredEdges };
}

// ── Resilient batch insert ──

/**
 * Insert rows with batch-first, individual-fallback strategy.
 * Returns count of successfully inserted rows and the ID map.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resilientInsert<T extends Record<string, any>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  table: string,
  rows: T[],
  selectFields = "id"
): Promise<{ inserted: number; data: Array<Record<string, string>> }> {
  if (rows.length === 0) return { inserted: 0, data: [] };

  // Try batch insert first
  const { data, error } = await db
    .from(table)
    .insert(rows)
    .select(selectFields);

  if (!error && data) {
    return { inserted: data.length, data };
  }

  // Batch failed — fall back to individual inserts
  console.warn(`[resilientInsert] Batch insert into ${table} failed: ${error?.message}. Trying individually (${rows.length} rows)`);

  const results: Array<Record<string, string>> = [];
  for (const row of rows) {
    const { data: d, error: e } = await db
      .from(table)
      .insert(row)
      .select(selectFields)
      .single();

    if (!e && d) {
      results.push(d);
    } else {
      console.warn(`[resilientInsert] Row insert failed: ${e?.message}`, JSON.stringify(row).slice(0, 200));
    }
  }

  return { inserted: results.length, data: results };
}
