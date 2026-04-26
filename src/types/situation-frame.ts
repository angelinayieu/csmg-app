// ── Situation Frame ──────────────────────────────────────────────────
//
// The output of the framing-panel stage (piece 2 of the 4-piece plan
// from the 2026-04-23 architectural review). Persisted on
// spaces.situation_frame and consumed by frame-extractor, decompose,
// and synthesis.
//
// This type is the *scaffold* that answers "what does the situation
// actually need" — not as a flat list of topical dimensions, but as a
// coordinate grid over the existing KG ontology:
//
//     layer (4)     × category (5)    = 20 cells
//     internal        concrete
//     conceptual      abstract
//     external        process
//     bridge          relational
//                     epistemic
//
// For each cell the panel decides: required / permitted / irrelevant.
// Axes are chosen to populate the required cells. Downstream coverage
// checks verify the KG actually landed entities in the required cells
// before synthesis is allowed to commit.
//
// Why it lives here (not inline in a pipeline file): multiple stages
// read this shape — frame-extractor, layer-density gate, synthesis,
// eventually the Lab for its "chamber prerequisites" mode. One
// canonical type prevents drift.
//
// Design rules enforced by this shape:
//   1. Every cell's status is justified (rationale, supporting_lenses).
//   2. Coverage per layer is explicit — you can't silently skip a
//      layer; if it's empty the panel must mark it intentionally_empty
//      with a reason.
//   3. Disagreement is a first-class artifact (divergences array) —
//      not averaged away. Matches the existing ranker pattern
//      (src/lib/pipeline/space-strategizer/ranker.ts).
//   4. Ad-hoc axes require ≥2 lens_support_count to be admitted —
//      prevents a single hallucinated axis from polluting the frame.
//
// Versioned via the `version` field so future schema changes can be
// migrated without breaking persisted frames.

import type { KnowledgeLayer } from "./layer";

// ── Entity category ──────────────────────────────────────────────────
//
// Canonical 5-value enum matching entity_category in the database
// (src/types/database.types.ts) and used in axis generators, signature
// materializer, hierarchical decomposition. Declared here as the
// authoritative top-level type — other files should eventually import
// from here instead of re-declaring inline.

export type EntityCategory =
  | "concrete"
  | "abstract"
  | "process"
  | "relational"
  | "epistemic";

// ── Cell coordinates ─────────────────────────────────────────────────

export type CellStatus = "required" | "permitted" | "irrelevant";

/** One cell of the (layer × category) grid with the panel's verdict. */
export interface FrameCell {
  layer: KnowledgeLayer;
  category: EntityCategory;
  status: CellStatus;
  /** Plain-English justification. ≤200 chars — surfaced to the user in
   *  a "why does this matter" tooltip. */
  rationale: string;
  /** Lens IDs (e.g. "systems_analyst", "skeptic") that flagged this
   *  cell at this status. Used to compute lens_support_count +
   *  divergence when lenses disagree about the same cell. */
  supporting_lenses: string[];
  /** 0..1 aggregate confidence. Computed by the consensus pass from
   *  supporting_lenses count + per-lens self-rated confidence. Cells
   *  below 0.4 are promoted to `permitted` rather than `required`
   *  unless explicitly overridden. */
  confidence: number;
}

// ── Axis proposals ───────────────────────────────────────────────────

/** An axis the panel proposes to populate one or more required cells.
 *  Catalog axes are pre-defined in src/lib/probability-space/axis-
 *  catalog.ts; ad_hoc axes are panel-invented and require ≥2 lens
 *  support to be admitted. */
export interface AxisProposal {
  axis_id: string;
  source: "catalog" | "ad_hoc";
  rationale: string;
  /** The cells this axis is intended to populate. Each cell must
   *  correspond to a `required` or `permitted` FrameCell in the same
   *  frame (validated at consensus time). */
  target_cells: Array<{ layer: KnowledgeLayer; category: EntityCategory }>;
  /** Hint for prompt variant selection — e.g. for `financial`:
   *  "payback_period" | "unit_economics" | "opportunity_cost". Axis
   *  generators that support variants honor this; others ignore. */
  prompt_variant?: string;
  /** How many lenses independently named this axis. Ad-hoc axes
   *  admitted only when ≥2. Catalog axes recorded as-is (≥1 lens
   *  sufficient since catalog quality is already curated). */
  lens_support_count: number;

  // ── Ad-hoc spec hints (Phase 2E · Axis Richness, 2026-04-24) ──
  //
  // When source="ad_hoc", lens prompts can optionally propose which
  // structural bucket the ad-hoc axis belongs to. These hints feed
  // `buildAdHocSpec` at frame-extractor time to pick a stance-aware
  // generator prompt. All three are optional; missing hints fall
  // back to conservative defaults (generic/decomposition/generic_
  // entity_set) at spec-construction time.
  //
  // Ignored entirely when source="catalog" — catalog axes already
  // have fixed specs in AXIS_CATALOG.

  /** Ontological bucket the axis probes — "money", "time", "people",
   *  "physical", "truth", "meaning", "causation", "risk", "precedent",
   *  "generic". Maps to AxisDimension in axis-spec.ts. */
  dimension_hint?: string;
  /** Cognitive instrument type — "calibration", "constraint",
   *  "enumeration", "stratification", "decomposition", "counterfactual",
   *  "evidentiary". Maps to AxisInstrumentKind in axis-spec.ts. Drives
   *  the ad-hoc prompt's analyst role + stance note. */
  instrument_kind_hint?: string;
  /** Expected output structure — matches AxisOutputShape values in
   *  axis-spec.ts. Drives the shape note added to the ad-hoc prompt. */
  output_shape_hint?: string;
  /** Human-readable label the panel invented. Shown on the space
   *  shell card. Defaults to title-cased axis_id when absent. */
  label?: string;
  /** Short tagline for the shell card. Defaults to rationale slice. */
  tagline?: string;
}

// ── Divergence ───────────────────────────────────────────────────────
//
// When lenses disagree about a cell's status or propose incompatible
// axes, the disagreement is preserved rather than averaged away. This
// is the main value-add of the panel over a single LLM call: divergence
// IS information about framing ambiguity.

export interface FramingDivergence {
  /** One-line topic of disagreement. E.g. "whether financial axis
   *  should fire" or "internal×epistemic cell status". */
  topic: string;
  /** Each stance taken by some subset of lenses. Typically 2–3
   *  positions per divergence. */
  positions: Array<{
    stance: string;
    supporting_lenses: string[];
    /** What becomes true downstream if this stance wins. Lets the
     *  user (or a resolution LLM) pick based on consequences. */
    implication_if_true: string;
  }>;
  /** How the pipeline should handle this disagreement:
   *    block   — must be resolved (by user or resolution pass) before
   *              frame-extractor commits axes.
   *    surface — frame proceeds with majority; divergence shown to
   *              user as "we made this call, here's what we're
   *              unsure about" for them to correct.
   *    note    — logged for telemetry only, no user-visible surface. */
  severity: "block" | "surface" | "note";
}

// ── Layer coverage ───────────────────────────────────────────────────
//
// Per-layer summary for the coverage gate. The gate is soft today
// (metrics-only) but promotable to hard (block synthesis on gaps)
// once confidence in the panel is high.

export interface LayerCoverage {
  layer: KnowledgeLayer;
  /** How many cells in this layer the panel marked required. */
  required_cell_count: number;
  /** How many cells in this layer the panel marked permitted. */
  permitted_cell_count: number;
  /** True if the panel explicitly declared this layer empty on
   *  purpose. Used to distinguish "we forgot" from "genuinely N/A". */
  intentionally_empty: boolean;
  /** Required when intentionally_empty=true. Why is the layer empty?
   *  Example: "pure-idea intake; no external data exists to anchor
   *  external-layer entities yet." */
  empty_rationale?: string;
  /** Computed final status. `missing` triggers the coverage gate. */
  status: "covered" | "intentionally_empty" | "missing";
}

// ── Load-bearing assumptions ─────────────────────────────────────────

export interface LoadBearingAssumption {
  /** The assumption itself, phrased declaratively. */
  assumption: string;
  /** Lens IDs that independently named this assumption. Repetition
   *  across lenses = high confidence the frame genuinely depends on
   *  it. */
  named_by: string[];
  /** What falls apart if this assumption is wrong. Surfaced to user
   *  so they can correct before the pipeline runs on a wrong frame. */
  if_false_implication: string;
}

// ── Gate status ──────────────────────────────────────────────────────
//
// The panel's recommendation to the orchestrator:
//   pass              — frame is usable, proceed to frame-extractor.
//   needs_user_input  — one or more `block` divergences exist OR a
//                       required layer has no coverage; user must
//                       clarify before pipeline proceeds.
//   needs_more_lenses — ensemble had low confidence across the board;
//                       retry with more/different lenses before
//                       committing.

export type FrameGateStatus = "pass" | "needs_user_input" | "needs_more_lenses";

// ── The frame itself ─────────────────────────────────────────────────

export interface SituationFrame {
  /** Schema version. Bump when the shape changes in breaking ways. */
  version: 1;
  /** ISO timestamp. */
  framed_at: string;
  /** Lens IDs that participated in this framing pass. */
  lenses_used: string[];
  /** Per-layer coverage summary. Always includes all 4 canonical
   *  layers (internal, conceptual, external, bridge) — if a layer
   *  is uncovered the entry says so rather than being absent. */
  layer_coverage: LayerCoverage[];
  /** All cells the panel had opinions about. Cells the panel didn't
   *  discuss are implicitly `permitted` with confidence 0. */
  cells: FrameCell[];
  /** Axes proposed by the panel, derived from required cells. */
  axes: AxisProposal[];
  /** Points of disagreement across the panel. Ordered by severity
   *  (block > surface > note). */
  divergences: FramingDivergence[];
  /** Load-bearing assumptions flagged by at least one lens. */
  load_bearing_assumptions: LoadBearingAssumption[];
  /** Aggregate confidence in the framing, 0..1. Composite of per-
   *  cell confidence and inverse of divergence count. */
  framing_confidence: number;
  /** The panel's recommendation to the orchestrator. */
  gate_status: FrameGateStatus;
}

// ── Type guards ──────────────────────────────────────────────────────

export const KNOWLEDGE_LAYERS: readonly KnowledgeLayer[] = [
  "internal",
  "conceptual",
  "external",
  "bridge",
];

export const ENTITY_CATEGORIES: readonly EntityCategory[] = [
  "concrete",
  "abstract",
  "process",
  "relational",
  "epistemic",
];

export function isKnowledgeLayer(x: unknown): x is KnowledgeLayer {
  return typeof x === "string" && (KNOWLEDGE_LAYERS as readonly string[]).includes(x);
}

export function isEntityCategory(x: unknown): x is EntityCategory {
  return typeof x === "string" && (ENTITY_CATEGORIES as readonly string[]).includes(x);
}
