// ── Axis output validator (Phase 2E · PR 2) ──
//
// Validates + repairs the JSON a per-axis generator returns. Serves
// two roles:
//
//   1. Type-narrows an arbitrary LLM output into the exact shape the
//      downstream orchestrator consumes (entities[], relationships[],
//      axis_summary). Defensive against missing fields, wrong enums,
//      extra junk, etc.
//
//   2. Implements the validation rubric we sketched in PR 1.5: a
//      GENERIC-NAME BLOCKLIST (drops entities like "General
//      Considerations"), a NORMALIZED-NAME DEDUP (drops duplicate
//      concepts in the same axis output), and a MIN-DEPTH GATE
//      (throws when the generator produced <3 usable entities so the
//      endpoint can surface an honest "thin axis" status instead of
//      pretending to succeed).
//
// The gate-throws-on-thin behavior lets the endpoint mark the
// probability_space_run as status='failed' with a specific error, and
// the shell rail can surface "this axis was too thin — skip?" to the
// user rather than silently including an empty shell.

import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

// ── Canonical output shapes ──

export type AxisEntityImportance =
  | "fundamental"
  | "critical"
  | "important"
  | "moderate";

export type AxisEntityCategory =
  | "concrete"
  | "abstract"
  | "process"
  | "relational"
  | "epistemic";

export type AxisEntitySourceTag = "explicit" | "implicit" | "assumed";

// ── Phase 2 §3.1 — richer entity schema ──
//
// Four new per-entity fields surface what an entity "does in the
// world", not just what it is. They bridge the probability-space
// output into downstream stages (intervention generator, conditional
// MC, observable-based prediction harness):
//
//   • observables       — concrete leading indicators (≥0; ≥1 strongly
//                         encouraged for fundamental/critical entities)
//   • failure_mode      — what would falsify or invalidate the entity
//   • intervention_handle — null for purely epistemic entities; for
//                         actionable ones, names the lever + grades
//                         controllability + cost so the synthesis
//                         view can rank "what to actually do"
//
// All three are nullable / defaultable so older outputs and ad-hoc
// outputs that don't supply them still validate.

export type IntervControllability = "direct" | "indirect" | "uncontrollable";
export type IntervCost = "low" | "med" | "high";

export interface InterventionHandle {
  lever: string;
  controllability: IntervControllability;
  cost: IntervCost;
}

export interface AxisGenEntity {
  id: string;
  name: string;
  description: string;
  importance: AxisEntityImportance;
  category: AxisEntityCategory;
  confidence: number; // 0..1
  source_tag: AxisEntitySourceTag;
  observables: string[];
  failure_mode: string | null;
  intervention_handle: InterventionHandle | null;
}

export type AxisRelDimension =
  | "structural"
  | "causal"
  | "temporal"
  | "logical"
  | "agentive";

export type AxisRelPolarity =
  | "positive"
  | "negative"
  | "conditional"
  | "neutral";

export type AxisRelDynamics =
  | "linear"
  | "threshold"
  | "compounding"
  | "exponential"
  | "decay"
  | "delayed";

export interface AxisGenRelationship {
  source_id: string;
  target_id: string;
  mechanism: string;
  dimension: AxisRelDimension;
  polarity: AxisRelPolarity;
  dynamics: AxisRelDynamics;
  confidence: number; // 0..1
  /** Phase 2 §3.1 — gating condition for when the edge fires. Always
   *  a string; required non-empty when polarity === "conditional"
   *  (validator drops conditional edges with empty / mechanism-equal
   *  conditions). Empty string for non-conditional polarities. */
  condition_text: string;
}

export interface AxisGenerationOutput {
  entities: AxisGenEntity[];
  relationships: AxisGenRelationship[];
  axis_summary: string;
  /** True when the output was admitted despite being thin — the
   *  endpoint will mark the axis run as 'failed' so the UI can
   *  offer a skip/retry. */
  flagged_thin?: boolean;
}

// ── Quality rubric constants ──

/**
 * Minimum entities that must SURVIVE filtering for an axis output
 * to be admitted. Matches the rubric in
 * DESIGN-self-improvement-loop.md ("coverage" dimension) and
 * axis-prompts.ts ("6-18 entities is the sweet spot; fewer = too
 * shallow"). Dropping below this throws instead of silently
 * admitting a thin output.
 */
const MIN_ENTITIES = 3;

/** Soft cap — extras beyond this get clipped, not rejected. */
const MAX_ENTITIES = 22;

/** Relationship mechanism must describe HOW, not just label it.
 *  Tightened in Phase 2 §3.1 from 10 → 40 chars: a 10-char "mechanism"
 *  is just a label ("causes", "drives"); 40 chars enforces a real
 *  sentence-fragment that names the channel. The OUTPUT_SHAPE prompt
 *  was updated to communicate this bar to the model. */
const MIN_MECHANISM_CHARS = 40;

/** Maximum observables retained per entity. Beyond this is fragmentation. */
const MAX_OBSERVABLES = 8;

/** Per-observable string cap. */
const MAX_OBSERVABLE_CHARS = 240;

/**
 * Generic-name blocklist. An entity whose entire name matches one
 * of these patterns is dropped as content-free filler. Specific
 * names like "General Partnership" (where "General" is a meaningful
 * modifier) pass because the regex anchors at start only for some
 * and requires full match for others.
 *
 * This matches the rubric from PR 1.5 validation spec.
 */
const GENERIC_NAME_BLOCKLIST: RegExp[] = [
  /^considerations?$/i,
  /^factors?$/i,
  /^things?$/i,
  /^general(\s+considerations?|\s+factors?)?$/i,
  /^issues?$/i,
  /^items?$/i,
  /^elements?$/i,
  /^aspects?$/i,
  /^various\s*(\w+)?$/i,
  /^miscellaneous/i,
  /^other(s|\s+considerations?)?$/i,
  /^additional\s+(factors?|considerations?|items?)$/i,
  /^some\s+(\w+)$/i,
];

// ── Enum validators ──

function asImportance(raw: unknown): AxisEntityImportance {
  if (raw === "fundamental" || raw === "critical" || raw === "moderate") {
    return raw;
  }
  return "important";
}

function asCategory(raw: unknown): AxisEntityCategory {
  if (
    raw === "concrete" ||
    raw === "abstract" ||
    raw === "process" ||
    raw === "relational" ||
    raw === "epistemic"
  ) {
    return raw;
  }
  return "abstract";
}

function asSourceTag(raw: unknown): AxisEntitySourceTag {
  if (raw === "explicit" || raw === "implicit" || raw === "assumed") {
    return raw;
  }
  return "assumed";
}

function asDimension(raw: unknown): AxisRelDimension {
  if (
    raw === "structural" ||
    raw === "causal" ||
    raw === "temporal" ||
    raw === "logical" ||
    raw === "agentive"
  ) {
    return raw;
  }
  return "causal";
}

function asPolarity(raw: unknown): AxisRelPolarity {
  if (
    raw === "positive" ||
    raw === "negative" ||
    raw === "conditional" ||
    raw === "neutral"
  ) {
    return raw;
  }
  return "neutral";
}

function asDynamics(raw: unknown): AxisRelDynamics {
  if (
    raw === "linear" ||
    raw === "threshold" ||
    raw === "compounding" ||
    raw === "exponential" ||
    raw === "decay" ||
    raw === "delayed"
  ) {
    return raw;
  }
  return "linear";
}

function asControllability(raw: unknown): IntervControllability {
  if (raw === "direct" || raw === "uncontrollable") return raw;
  return "indirect";
}

function asCost(raw: unknown): IntervCost {
  if (raw === "low" || raw === "high") return raw;
  return "med";
}

/**
 * Coerce intervention_handle. Returns null when:
 *   • input is null / not an object
 *   • lever string is missing or empty after trim
 * Otherwise enums fall back to safe defaults (indirect / med).
 */
function asInterventionHandle(raw: unknown): InterventionHandle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lever = typeof r.lever === "string" ? r.lever.trim() : "";
  if (lever.length === 0) return null;
  return {
    lever: lever.slice(0, 200),
    controllability: asControllability(r.controllability),
    cost: asCost(r.cost),
  };
}

/**
 * Coerce observables array. Drops non-string / blank entries, trims,
 * caps per-string length and total count. Always returns an array
 * (possibly empty); the entity-level validation step decides whether
 * an empty array is acceptable for this entity's importance tier.
 */
function asObservables(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (out.length >= MAX_OBSERVABLES) break;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.slice(0, MAX_OBSERVABLE_CHARS));
  }
  return out;
}

function asFailureMode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 280);
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isGenericName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return true;
  return GENERIC_NAME_BLOCKLIST.some((re) => re.test(trimmed));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Main validator ──

export class ThinAxisOutputError extends Error {
  public readonly admittedCount: number;
  /** Widened to string in Phase 2E · Axis Richness — ad-hoc axes
   *  (panel-minted, not in the canonical 8) also throw this error
   *  and their axis_id is not a ProbabilitySpaceAxis key. */
  public readonly axis: string;
  constructor(axis: string, admittedCount: number) {
    super(
      `axis ${axis}: only ${admittedCount} usable entit${admittedCount === 1 ? "y" : "ies"} after filtering (minimum ${MIN_ENTITIES}). Flagged thin.`,
    );
    this.name = "ThinAxisOutputError";
    this.axis = axis;
    this.admittedCount = admittedCount;
  }
}

export function validateAxisOutput(
  raw: unknown,
  /** Catalog axis key OR ad-hoc axis_id string. Only used to label
   *  ThinAxisOutputError for telemetry — no catalog lookup here. */
  axis: ProbabilitySpaceAxis | string,
): AxisGenerationOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("axis output not an object");
  }
  const obj = raw as Record<string, unknown>;

  // ── Entities ──
  const rawEntities = Array.isArray(obj.entities) ? obj.entities : [];
  const entities: AxisGenEntity[] = [];
  const seenIds = new Set<string>();
  const seenNormalizedNames = new Set<string>();

  for (const rawEntity of rawEntities) {
    if (entities.length >= MAX_ENTITIES) break;
    if (!rawEntity || typeof rawEntity !== "object") continue;
    const e = rawEntity as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (typeof e.name !== "string") continue;

    // Blocklist: skip pure-generic names
    if (isGenericName(e.name)) continue;

    // Dedup: skip duplicate concepts within this axis output
    const normalized = normalizeName(e.name);
    if (seenNormalizedNames.has(normalized)) continue;
    if (seenIds.has(e.id)) continue;
    seenIds.add(e.id);
    seenNormalizedNames.add(normalized);

    const importance = asImportance(e.importance);
    const observables = asObservables(e.observables);

    // Phase 2 §3.4 — load-bearing entities (fundamental / critical) MUST
    // ship at least one observable. We don't reject the entity outright
    // (that would shrink coverage); instead we downgrade importance one
    // tier so synthesis ranking treats it honestly. The prompt makes
    // this expectation explicit, so a downgrade signals the model
    // ignored a hard rule.
    let effectiveImportance: AxisEntityImportance = importance;
    if (
      observables.length === 0 &&
      (importance === "fundamental" || importance === "critical")
    ) {
      effectiveImportance = "important";
    }

    entities.push({
      id: e.id,
      name: e.name.trim().slice(0, 140),
      description:
        typeof e.description === "string" ? e.description.slice(0, 600) : "",
      importance: effectiveImportance,
      category: asCategory(e.category),
      confidence: clamp01(e.confidence),
      source_tag: asSourceTag(e.source_tag),
      observables,
      failure_mode: asFailureMode(e.failure_mode),
      intervention_handle: asInterventionHandle(e.intervention_handle),
    });
  }

  // ── Min-depth gate ──
  // If fewer than MIN_ENTITIES survived filtering, the generator
  // produced a thin output. Throw so the endpoint can mark the axis
  // run as 'failed' with this specific error.
  if (entities.length < MIN_ENTITIES) {
    throw new ThinAxisOutputError(axis, entities.length);
  }

  const validIds = new Set(entities.map((e) => e.id));

  // ── Relationships ──
  // Only keep relationships that:
  //   1. Point to admitted entities (cascade drop)
  //   2. Are not self-loops
  //   3. Have a meaningful mechanism string (MIN_MECHANISM_CHARS)
  // This enforces the axis-prompts.ts "every edge names a MECHANISM"
  // rule at the validator level.
  const rawRels = Array.isArray(obj.relationships) ? obj.relationships : [];
  const relationships: AxisGenRelationship[] = [];
  const seenEdgeKeys = new Set<string>();

  for (const rawRel of rawRels) {
    if (!rawRel || typeof rawRel !== "object") continue;
    const r = rawRel as Record<string, unknown>;
    if (typeof r.source_id !== "string" || typeof r.target_id !== "string") {
      continue;
    }
    if (!validIds.has(r.source_id) || !validIds.has(r.target_id)) continue;
    if (r.source_id === r.target_id) continue;
    if (typeof r.mechanism !== "string") continue;
    const mechanism = r.mechanism.trim();
    if (mechanism.length < MIN_MECHANISM_CHARS) continue;

    // Dedup edges — same (source, target) pair admitted once.
    const key = `${r.source_id}→${r.target_id}`;
    if (seenEdgeKeys.has(key)) continue;

    // Phase 2 §3.1 + §3.4 — condition_text handling.
    //
    //   • polarity === "conditional": condition_text MUST be a real
    //     non-empty gate, AND must NOT be a textual restatement of the
    //     mechanism. Edges that fail either check get dropped — a
    //     conditional edge without a condition is just a regular edge
    //     with worse semantics, and we'd rather have fewer honest
    //     edges than mislabeled ones.
    //   • Other polarities: condition_text is coerced to "" (we keep
    //     the field present so downstream consumers don't have to
    //     null-check).
    const polarity = asPolarity(r.polarity);
    const rawCondition =
      typeof r.condition_text === "string" ? r.condition_text.trim() : "";

    let conditionText: string;
    if (polarity === "conditional") {
      if (rawCondition.length === 0) continue;
      // Reject when condition is a near-restatement of the mechanism.
      // Cheap textual guard: same after lowercasing + collapsing
      // whitespace. Catches the common LLM failure where the model
      // copy-pastes the mechanism into the condition slot.
      const normMech = mechanism.toLowerCase().replace(/\s+/g, " ");
      const normCond = rawCondition.toLowerCase().replace(/\s+/g, " ");
      if (normMech === normCond) continue;
      conditionText = rawCondition.slice(0, 360);
    } else {
      conditionText = "";
    }

    seenEdgeKeys.add(key);

    relationships.push({
      source_id: r.source_id,
      target_id: r.target_id,
      mechanism: mechanism.slice(0, 500),
      dimension: asDimension(r.dimension),
      polarity,
      dynamics: asDynamics(r.dynamics),
      confidence: clamp01(r.confidence),
      condition_text: conditionText,
    });
  }

  const axis_summary =
    typeof obj.axis_summary === "string"
      ? obj.axis_summary.trim().slice(0, 900)
      : "";

  return {
    entities,
    relationships,
    axis_summary,
  };
}

/**
 * Soft fallback for unrecoverable validator failures. Marks the
 * axis as failed so the UI can surface it; the shell stays but
 * without entities.
 */
export function emptyAxisOutput(): AxisGenerationOutput {
  return {
    entities: [],
    relationships: [],
    axis_summary: "",
    flagged_thin: true,
  };
}
