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

export interface AxisGenEntity {
  id: string;
  name: string;
  description: string;
  importance: AxisEntityImportance;
  category: AxisEntityCategory;
  confidence: number; // 0..1
  source_tag: AxisEntitySourceTag;
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

/** Relationship mechanism must describe HOW, not just label it. */
const MIN_MECHANISM_CHARS = 10;

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
  public readonly axis: ProbabilitySpaceAxis;
  constructor(axis: ProbabilitySpaceAxis, admittedCount: number) {
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
  axis: ProbabilitySpaceAxis,
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

    entities.push({
      id: e.id,
      name: e.name.trim().slice(0, 140),
      description:
        typeof e.description === "string" ? e.description.slice(0, 600) : "",
      importance: asImportance(e.importance),
      category: asCategory(e.category),
      confidence: clamp01(e.confidence),
      source_tag: asSourceTag(e.source_tag),
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
    seenEdgeKeys.add(key);

    relationships.push({
      source_id: r.source_id,
      target_id: r.target_id,
      mechanism: mechanism.slice(0, 500),
      dimension: asDimension(r.dimension),
      polarity: asPolarity(r.polarity),
      dynamics: asDynamics(r.dynamics),
      confidence: clamp01(r.confidence),
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
