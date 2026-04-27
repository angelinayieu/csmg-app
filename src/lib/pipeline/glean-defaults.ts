// ── Glean defaults orchestrator (D9 — docs/KG_DEPTH_CRITIQUE.md §3) ──
//
// Single-pass targeted gleaner that runs AFTER Pass 2 of decomposition.
// For each of three under-filled fields (edge.dynamics, edge.conditions,
// entity.measurement), we:
//
//   1. Filter to candidate items where the field is at its placeholder
//      value (linear / null / null respectively).
//   2. Run a cheap yes/no preflight LLM call asking "is anything in
//      this list worth gleaning?" — skip the expensive call when no.
//   3. Run a targeted LLM call with the candidate list + field-specific
//      schema; merge results back into the source arrays in place.
//
// Soft-fail throughout — any LLM/parse failure leaves the original
// arrays untouched. The caller logs counts but never blocks the
// pipeline on gleaner errors.
//
// Empirical context (GraphRAG paper §A.2 Figure 3): self-reflection
// gleaning improved entity-reference recall 2.3× at 600-token chunks.
// Our use case is narrower (specific defaulted fields, not all
// extractions) so we expect ~1.5-2× lift on dynamics non-default rate
// and on edges-with-conditions, plus 100% backstop on D1 measurement
// gaps the Pass 2 prompt missed.
//
// Pure function. No DB I/O. Caller in decompose/route.ts owns the
// surrounding event emission and persistence.

import { llmJSON } from "@/lib/llm";
import {
  GLEAN_PREFLIGHT_SYSTEM,
  GLEAN_EDGE_DYNAMICS_SYSTEM,
  GLEAN_EDGE_CONDITIONS_SYSTEM,
  GLEAN_ENTITY_MEASUREMENT_SYSTEM,
  type PreflightResult,
  type DynamicsUpdate,
  type ConditionsUpdate,
  type MeasurementUpdate,
  type GleanResponse,
} from "@/lib/prompts/glean-defaults";
import { requiresMeasurement } from "@/types/measurement";

// ── Inputs / outputs ─────────────────────────────────────────────────

/**
 * Loose entity shape — we don't import StructuredEntity because callers
 * pass `RawEntity` from the dedup pipeline (index-signature-typed).
 * Fields we read or write are narrowed via runtime checks.
 */
type GleanableEntity = Record<string, unknown> & {
  entity_id: string;
  name: string;
  description?: string;
  importance?: string;
  entity_category?: string;
  measurement?: Record<string, unknown> | null;
};

type GleanableEdge = Record<string, unknown> & {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type?: string;
  polarity?: string;
  dynamics?: string | null;
  dynamics_properties?: Record<string, unknown> | null;
  conditions?: string | null;
};

export interface GleanDefaultsResult {
  /** How many edges had dynamics upgraded from "linear" to a more specific kind. */
  dynamics_upgraded: number;
  /** How many edges had conditions added (or were marked is_unconditional). */
  conditions_filled: number;
  /** How many fundamental/critical entities had a measurement spec added. */
  measurement_filled: number;
  /** How many fundamental/critical entities were honestly tagged "no measurement possible" with reason. */
  measurement_excused: number;
  /** Per-pass preflight outcomes — useful for telemetry. */
  preflight: {
    dynamics: "skipped_no_candidates" | "skipped_preflight_no" | "ran" | "error";
    conditions: "skipped_no_candidates" | "skipped_preflight_no" | "ran" | "error";
    measurement: "skipped_no_candidates" | "skipped_preflight_no" | "ran" | "error";
  };
  /** Total LLM call count (preflights + glean passes). 0-6 typical. */
  llm_calls: number;
}

// ── Tunables ─────────────────────────────────────────────────────────

/**
 * Cap candidate list size per glean call. With 20 candidates and a
 * 4k-token response budget the LLM can update everything in one
 * call. Larger lists fragment attention and degrade quality. If a
 * space has more candidates than this we glean the FIRST N (sorted by
 * a relevance signal — for now: importance for entities, confidence
 * for edges) and leave the rest at default.
 */
const MAX_CANDIDATES_PER_GLEAN = 20;

const PREFLIGHT_MAX_TOKENS = 200;
const GLEAN_MAX_TOKENS = 4000;

// Conditions gleaning only fires on edges where a condition is
// PLAUSIBLE — i.e. causal/enabling/inhibiting/gating relationships.
// Structural/correlational/temporal edges don't typically have IF-
// clauses and would be a waste of a gleaning slot.
const CONDITIONS_RELEVANT_RELATIONSHIPS = new Set([
  "causes",
  "contributes-to",
  "enables",
  "inhibits",
  "mediates",
  "moderates",
  "constrains",
  "requires",
  "gates",
  "triggers",
  "amplifies",
  "reduces",
  "prevents",
  "resolves",
]);

// ── Public entry ────────────────────────────────────────────────────

/**
 * Run all three glean passes, mutating `entities` and `edges` IN PLACE
 * with any updates returned by the LLM. Returns counters for telemetry.
 *
 * Soft-fail at every level: a single failed pass doesn't affect the
 * other two, and any failure reports `error` in the preflight slot for
 * the caller to log.
 */
export async function gleanDefaults(
  entities: GleanableEntity[],
  edges: GleanableEdge[],
): Promise<GleanDefaultsResult> {
  const result: GleanDefaultsResult = {
    dynamics_upgraded: 0,
    conditions_filled: 0,
    measurement_filled: 0,
    measurement_excused: 0,
    preflight: {
      dynamics: "skipped_no_candidates",
      conditions: "skipped_no_candidates",
      measurement: "skipped_no_candidates",
    },
    llm_calls: 0,
  };

  // Run the three passes in parallel — they don't share state, so
  // there's no ordering constraint. If any throws, the others still
  // report; we don't want one bad pass to block the others.
  await Promise.allSettled([
    runDynamicsGlean(edges, result),
    runConditionsGlean(edges, result),
    runMeasurementGlean(entities, result),
  ]);

  return result;
}

// ── Edge dynamics pass ──────────────────────────────────────────────

async function runDynamicsGlean(
  edges: GleanableEdge[],
  result: GleanDefaultsResult,
): Promise<void> {
  // Candidates: edges with dynamics === "linear" or null. We treat
  // null as effectively-linear (the same default that downstream
  // simulation assumes) and offer it for upgrade alongside explicit
  // linear assignments.
  const candidateIndices: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    const d = edges[i].dynamics;
    if (d === "linear" || d === null || d === undefined) {
      candidateIndices.push(i);
    }
  }
  if (candidateIndices.length === 0) return;

  const slice = candidateIndices.slice(0, MAX_CANDIDATES_PER_GLEAN);
  const candidates = slice.map((idx, i) => ({
    edge_index: i, // local index for the LLM
    source_entity_id: edges[idx].source_entity_id,
    target_entity_id: edges[idx].target_entity_id,
    relationship_type: edges[idx].relationship_type ?? "relates-to",
    polarity: edges[idx].polarity ?? "neutral",
    current_dynamics: edges[idx].dynamics ?? "linear",
  }));

  try {
    // Preflight
    const preflightUser = formatPreflightUser(
      "edge dynamics",
      `Each item is an edge currently labeled dynamics="linear". A more specific dynamics (threshold, compounding, exponential, logarithmic, decay, step_function, delayed) may apply.`,
      candidates,
    );
    const pre = await llmJSON<PreflightResult>({
      system: GLEAN_PREFLIGHT_SYSTEM,
      user: preflightUser,
      maxTokens: PREFLIGHT_MAX_TOKENS,
      temperature: 0.1,
      validator: validatePreflight,
      fallback: { any_gleaning_needed: false, rationale: "preflight failed" },
    });
    result.llm_calls += 1;

    if (!pre.any_gleaning_needed) {
      result.preflight.dynamics = "skipped_preflight_no";
      return;
    }

    // Glean
    const gleanUser = `Edges to audit:\n\n${JSON.stringify(candidates, null, 2)}\n\nReturn ONLY items you'd update. Empty updates array is valid.`;
    const gleaned = await llmJSON<GleanResponse<DynamicsUpdate>>({
      system: GLEAN_EDGE_DYNAMICS_SYSTEM,
      user: gleanUser,
      maxTokens: GLEAN_MAX_TOKENS,
      temperature: 0.2,
      validator: validateDynamicsResponse,
      fallback: { updates: [] },
    });
    result.llm_calls += 1;
    result.preflight.dynamics = "ran";

    // Apply updates — only count as upgrade when dynamics actually
    // changed from the placeholder.
    for (const u of gleaned.updates) {
      const sourceIdx = slice[u.edge_index];
      if (sourceIdx === undefined) continue;
      const before = edges[sourceIdx].dynamics ?? "linear";
      if (u.dynamics === before && !u.dynamics_properties) continue;
      edges[sourceIdx].dynamics = u.dynamics;
      if (u.dynamics_properties) {
        edges[sourceIdx].dynamics_properties = u.dynamics_properties;
      }
      if (u.dynamics !== before) result.dynamics_upgraded += 1;
    }
  } catch (err) {
    console.warn("[glean-defaults] dynamics pass failed (non-fatal):", err);
    result.preflight.dynamics = "error";
  }
}

// ── Edge conditions pass ────────────────────────────────────────────

async function runConditionsGlean(
  edges: GleanableEdge[],
  result: GleanDefaultsResult,
): Promise<void> {
  const candidateIndices: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].conditions != null) continue;
    const rel = edges[i].relationship_type;
    if (typeof rel === "string" && CONDITIONS_RELEVANT_RELATIONSHIPS.has(rel)) {
      candidateIndices.push(i);
    }
  }
  if (candidateIndices.length === 0) return;

  const slice = candidateIndices.slice(0, MAX_CANDIDATES_PER_GLEAN);
  const candidates = slice.map((idx, i) => ({
    edge_index: i,
    source_entity_id: edges[idx].source_entity_id,
    target_entity_id: edges[idx].target_entity_id,
    relationship_type: edges[idx].relationship_type,
    polarity: edges[idx].polarity ?? "neutral",
  }));

  try {
    const preflightUser = formatPreflightUser(
      "edge conditions",
      `Each item is a causal/enabling edge with conditions=null. Many of these have implicit conditions the initial pass missed.`,
      candidates,
    );
    const pre = await llmJSON<PreflightResult>({
      system: GLEAN_PREFLIGHT_SYSTEM,
      user: preflightUser,
      maxTokens: PREFLIGHT_MAX_TOKENS,
      temperature: 0.1,
      validator: validatePreflight,
      fallback: { any_gleaning_needed: false, rationale: "preflight failed" },
    });
    result.llm_calls += 1;

    if (!pre.any_gleaning_needed) {
      result.preflight.conditions = "skipped_preflight_no";
      return;
    }

    const gleanUser = `Edges to audit:\n\n${JSON.stringify(candidates, null, 2)}\n\nReturn ONLY edges you'd update or mark unconditional. Don't guess.`;
    const gleaned = await llmJSON<GleanResponse<ConditionsUpdate>>({
      system: GLEAN_EDGE_CONDITIONS_SYSTEM,
      user: gleanUser,
      maxTokens: GLEAN_MAX_TOKENS,
      temperature: 0.2,
      validator: validateConditionsResponse,
      fallback: { updates: [] },
    });
    result.llm_calls += 1;
    result.preflight.conditions = "ran";

    for (const u of gleaned.updates) {
      const sourceIdx = slice[u.edge_index];
      if (sourceIdx === undefined) continue;
      if (typeof u.conditions === "string" && u.conditions.trim().length > 0) {
        edges[sourceIdx].conditions = u.conditions.trim().slice(0, 1000);
        result.conditions_filled += 1;
      } else if (u.is_unconditional) {
        // Tag explicitly so future audits don't re-glean. Stored as a
        // sentinel string in conditions; downstream consumers can
        // treat "[unconditional]" as null-equivalent.
        edges[sourceIdx].conditions = "[unconditional]";
        result.conditions_filled += 1;
      }
    }
  } catch (err) {
    console.warn("[glean-defaults] conditions pass failed (non-fatal):", err);
    result.preflight.conditions = "error";
  }
}

// ── Entity measurement pass (D1 follow-up) ──────────────────────────

async function runMeasurementGlean(
  entities: GleanableEntity[],
  result: GleanDefaultsResult,
): Promise<void> {
  const candidateIndices: number[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!requiresMeasurement(e.importance, e.entity_category)) continue;
    // Already has a non-null measurement? skip.
    const m = e.measurement;
    if (m && typeof m === "object" && typeof m.unit === "string" && m.unit.trim()) {
      continue;
    }
    candidateIndices.push(i);
  }
  if (candidateIndices.length === 0) return;

  const slice = candidateIndices.slice(0, MAX_CANDIDATES_PER_GLEAN);
  const candidates = slice.map((idx, i) => ({
    entity_index: i,
    entity_id: entities[idx].entity_id,
    name: entities[idx].name,
    description:
      typeof entities[idx].description === "string"
        ? (entities[idx].description as string).slice(0, 500)
        : "",
    importance: entities[idx].importance,
    entity_category: entities[idx].entity_category,
  }));

  try {
    const preflightUser = formatPreflightUser(
      "entity measurement",
      `Each item is a fundamental/critical entity in a quantifiable category that lacks a measurement spec from D1. Some genuinely resist measurement; others do not.`,
      candidates,
    );
    const pre = await llmJSON<PreflightResult>({
      system: GLEAN_PREFLIGHT_SYSTEM,
      user: preflightUser,
      maxTokens: PREFLIGHT_MAX_TOKENS,
      temperature: 0.1,
      validator: validatePreflight,
      fallback: { any_gleaning_needed: false, rationale: "preflight failed" },
    });
    result.llm_calls += 1;

    if (!pre.any_gleaning_needed) {
      result.preflight.measurement = "skipped_preflight_no";
      return;
    }

    const gleanUser = `Entities to audit:\n\n${JSON.stringify(candidates, null, 2)}\n\nReturn ONLY entities you'd update. Empty updates array is valid.`;
    const gleaned = await llmJSON<GleanResponse<MeasurementUpdate>>({
      system: GLEAN_ENTITY_MEASUREMENT_SYSTEM,
      user: gleanUser,
      maxTokens: GLEAN_MAX_TOKENS,
      temperature: 0.2,
      validator: validateMeasurementResponse,
      fallback: { updates: [] },
    });
    result.llm_calls += 1;
    result.preflight.measurement = "ran";

    for (const u of gleaned.updates) {
      const sourceIdx = slice[u.entity_index];
      if (sourceIdx === undefined) continue;
      const m = u.measurement;
      if (
        m &&
        typeof m === "object" &&
        typeof m.unit === "string" &&
        m.unit.trim() &&
        typeof m.scale === "string" &&
        ["continuous", "ordinal", "categorical", "binary"].includes(m.scale)
      ) {
        // Preserve nested measurement shape so sanitizeEntity picks it
        // up via either nested-or-flat extraction path.
        entities[sourceIdx].measurement = {
          unit: m.unit.trim().slice(0, 200),
          scale: m.scale,
          ...(m.protocol &&
          typeof m.protocol === "object" &&
          m.protocol !== null
            ? { protocol: m.protocol }
            : {}),
          ...(typeof m.cost_estimate === "number" && m.cost_estimate >= 0
            ? { cost_estimate: m.cost_estimate }
            : {}),
          ...(typeof m.observability === "string" &&
          [
            "directly_observable",
            "proxy_required",
            "inferred_only",
            "unobservable",
          ].includes(m.observability)
            ? { observability: m.observability }
            : {}),
        };
        result.measurement_filled += 1;
      } else if (
        typeof u.missing_reason === "string" &&
        u.missing_reason.trim().length > 0
      ) {
        // Honest "no measurement possible" finding — record as an
        // annotation on the entity so the coverage gate can surface
        // it as an excused gap rather than a missing one.
        entities[sourceIdx].measurement = null;
        // Stash the reason in provenance (existing JSONB) so D1
        // coverage-gate's UI eventually surfaces "marked unmeasurable
        // because: <reason>" instead of just "missing".
        const provRaw = entities[sourceIdx].provenance;
        const prov =
          typeof provRaw === "object" && provRaw !== null
            ? (provRaw as Record<string, unknown>)
            : {};
        prov.measurement_excused_reason = u.missing_reason.trim().slice(0, 500);
        entities[sourceIdx].provenance = prov;
        result.measurement_excused += 1;
      }
    }
  } catch (err) {
    console.warn("[glean-defaults] measurement pass failed (non-fatal):", err);
    result.preflight.measurement = "error";
  }
}

// ── Validators (lenient — soft-fail to fallback on shape error) ─────

function validatePreflight(data: unknown): PreflightResult {
  if (typeof data !== "object" || data === null) {
    return { any_gleaning_needed: false, rationale: "non-object response" };
  }
  const obj = data as Record<string, unknown>;
  return {
    any_gleaning_needed: obj.any_gleaning_needed === true,
    rationale:
      typeof obj.rationale === "string" ? obj.rationale.slice(0, 500) : "",
  };
}

function validateDynamicsResponse(
  data: unknown,
): GleanResponse<DynamicsUpdate> {
  if (typeof data !== "object" || data === null) return { updates: [] };
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.updates)) return { updates: [] };
  const ALLOWED = [
    "linear",
    "threshold",
    "compounding",
    "exponential",
    "logarithmic",
    "decay",
    "step_function",
    "delayed",
  ];
  const updates: DynamicsUpdate[] = [];
  for (const u of obj.updates) {
    if (typeof u !== "object" || u === null) continue;
    const r = u as Record<string, unknown>;
    if (typeof r.edge_index !== "number") continue;
    if (typeof r.dynamics !== "string" || !ALLOWED.includes(r.dynamics)) continue;
    updates.push({
      edge_index: r.edge_index,
      dynamics: r.dynamics as DynamicsUpdate["dynamics"],
      dynamics_properties:
        typeof r.dynamics_properties === "object" &&
        r.dynamics_properties !== null
          ? (r.dynamics_properties as Record<string, unknown>)
          : null,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
    });
  }
  return { updates };
}

function validateConditionsResponse(
  data: unknown,
): GleanResponse<ConditionsUpdate> {
  if (typeof data !== "object" || data === null) return { updates: [] };
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.updates)) return { updates: [] };
  const updates: ConditionsUpdate[] = [];
  for (const u of obj.updates) {
    if (typeof u !== "object" || u === null) continue;
    const r = u as Record<string, unknown>;
    if (typeof r.edge_index !== "number") continue;
    updates.push({
      edge_index: r.edge_index,
      conditions: typeof r.conditions === "string" ? r.conditions : null,
      is_unconditional: r.is_unconditional === true,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
    });
  }
  return { updates };
}

function validateMeasurementResponse(
  data: unknown,
): GleanResponse<MeasurementUpdate> {
  if (typeof data !== "object" || data === null) return { updates: [] };
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.updates)) return { updates: [] };
  const updates: MeasurementUpdate[] = [];
  for (const u of obj.updates) {
    if (typeof u !== "object" || u === null) continue;
    const r = u as Record<string, unknown>;
    if (typeof r.entity_index !== "number") continue;
    const m =
      typeof r.measurement === "object" && r.measurement !== null
        ? (r.measurement as MeasurementUpdate["measurement"])
        : null;
    updates.push({
      entity_index: r.entity_index,
      measurement: m,
      missing_reason:
        typeof r.missing_reason === "string" ? r.missing_reason : null,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
    });
  }
  return { updates };
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatPreflightUser(
  label: string,
  context: string,
  candidates: Array<Record<string, unknown>>,
): string {
  return [
    `Field under audit: ${label}`,
    "",
    `Context: ${context}`,
    "",
    `${candidates.length} item(s):`,
    JSON.stringify(candidates, null, 2),
    "",
    `Reply { "any_gleaning_needed": true|false, "rationale": "<one sentence>" }.`,
  ].join("\n");
}
