// ── Rich AxisSpec (Phase 2E · Axis Richness) ─────────────────────────
//
// The canonical structural metadata for a probability-space axis.
// Supersedes the old flat `AxisMeta` (label / tagline / applies_when /
// generator_focus) by adding the fields the generator, the scheduler,
// and the ranker all need in order to route ad-hoc + variant-specific
// prompts without guesswork:
//
//   • dimension          — ontological bucket the axis navigates.
//   • instrument_kind    — cognitive tool type (calibration, enumeration, ...).
//   • output_shape       — what entities this axis is expected to produce.
//   • hard_preconditions — activation gates; when all fail the axis
//                          should degrade_to its fallback (or be dropped).
//   • soft_preconditions — nice-to-have signals that boost confidence.
//   • prompt_variants    — focus-delta templates picked by panel hint.
//   • failure_mode       — plain-English description of what this axis
//                          degenerates into when misapplied. Telemetry.
//   • degrade_to         — fallback axis when preconditions fail.
//   • cost_profile       — token / wall-time envelope the scheduler
//                          uses to budget parallel generator batches.
//
// Why it lives in its own file: ad-hoc axes (proposed by the framing
// panel but not in the hardcoded catalog) are built in-memory at
// panel-consensus time and handed to the generator over HTTP. The
// type can't live in axis-catalog.ts because catalog is a closed
// enumeration; ad-hoc specs need a type that admits arbitrary
// axis_id strings.
//
// Related types:
//   • `AxisMeta` (axis-catalog.ts) — strict catalog shape; tied to
//     `ProbabilitySpaceAxis` union. Superset of AxisSpec (adds
//     catalog-only invariants). Every AxisMeta IS an AxisSpec.
//   • The `AxisSpec` declared internally in axis-prompts.ts is
//     prompt-only (role/focus/vocabulary/avoid); unrelated scope.

export type AxisDimension =
  | "money"
  | "time"
  | "people"
  | "physical"
  | "truth"
  | "meaning"
  | "causation"
  | "risk"
  | "precedent"
  | "generic";

export type AxisInstrumentKind =
  | "calibration" // bounded numeric estimation
  | "constraint" // hard bounds + failure envelope
  | "enumeration" // list-the-cases
  | "stratification" // segment-by-attribute
  | "decomposition" // break into mechanisms
  | "counterfactual" // what-if branches
  | "evidentiary"; // claim + source audit

export type AxisOutputShape =
  | "numeric_with_distribution"
  | "named_stakeholder_set"
  | "scenario_tree"
  | "claim_ledger"
  | "assumption_ledger"
  | "failure_mode_catalog"
  | "temporal_phase_map"
  | "norm_and_identity_map"
  | "constraint_envelope"
  | "precedent_set"
  | "generic_entity_set";

export interface AxisPromptVariant {
  /** Stable id used by AxisProposal.prompt_variant to select this variant. */
  id: string;
  /** Human-readable label — shown on the shell card when a non-default
   *  variant is active. */
  label: string;
  /** Swaps into the generator prompt in place of the default focus
   *  line. Should name SPECIFIC mechanisms/vocabulary for this variant. */
  focus_delta: string;
  /** Optional — override the axis's default output_shape when this
   *  variant demands a different canonical shape (e.g. financial /
   *  payback_period wants a temporal_phase_map, not raw numerics). */
  output_shape_override?: AxisOutputShape;
}

/**
 * The structural spec for a probability-space axis. Catalog axes have
 * fixed specs (see AXIS_CATALOG); ad-hoc axes have dynamically-built
 * specs constructed by the framing panel consensus pass.
 */
export interface AxisSpec {
  /** Stable identifier. For catalog axes this is the `ProbabilitySpaceAxis`
   *  key; for ad-hoc axes an arbitrary string minted by the panel. */
  axis_id: string;

  // — UI-facing shell metadata (mirrors legacy AxisMeta) —
  label: string;
  tagline: string;
  accent: string;

  /** One-line trigger condition shown to the frame-extractor LLM when
   *  deciding whether to include this axis. Prose, not a predicate. */
  applies_when: string;

  /** One-line generator hint — what KIND of entities this axis should
   *  produce. Shown to the per-axis generator prompt. */
  generator_focus: string;

  // — Rich structural fields —
  dimension: AxisDimension;
  instrument_kind: AxisInstrumentKind;
  output_shape: AxisOutputShape;

  /** Plain-English activation gates. At least one should be satisfied
   *  by the input / upstream tags for the axis to be "ripe." When all
   *  fail, `degrade_to` is the recommended fallback. Evaluated softly
   *  (panel lenses read these; no runtime predicate engine yet). */
  hard_preconditions: string[];
  /** Signals that boost confidence but don't gate activation. */
  soft_preconditions: string[];

  /** Variant templates supported by this axis. `AxisProposal.prompt_variant`
   *  names one by id; absent = default. Empty record = no variants. */
  prompt_variants: Record<string, AxisPromptVariant>;

  /** What this axis degenerates into when misapplied. Plain-English
   *  post-mortem string — surfaced to run telemetry, not to the user.
   *  Example: "Financial without numeric input = generic cost/revenue
   *  platitudes." */
  failure_mode: string;

  /** Fallback axis id when all hard preconditions fail. Null if this
   *  axis has no graceful fallback and should simply be dropped. */
  degrade_to: string | null;

  /** Cost envelope per generator call. Used by the scheduler to budget
   *  parallel batch cost. Order-of-magnitude accuracy is sufficient. */
  cost_profile: {
    tokens_estimate: number;
    seconds_estimate: number;
  };
}

// ── Ad-hoc axis minting ───────────────────────────────────────────────
//
// The framing panel can propose axes not in the canonical 8. When two
// or more lenses independently propose the same ad-hoc axis, the
// consensus pass mints a live AxisSpec for it using `buildAdHocSpec`.
// The spec rides on the AxisProposal through frame-extractor and
// into the per-axis generator over HTTP.

/**
 * Build a lightweight AxisSpec for a panel-invented axis. The panel
 * provides:
 *   • axis_id         — stable identifier (snake_case)
 *   • label / tagline — UI strings the panel chose
 *   • rationale       — what this axis is probing
 *   • dimension / instrument_kind / output_shape — best-guess from the
 *     panel's lens reasoning (panel lens prompts ask for these)
 *
 * Missing fields fall back to conservative defaults so the generator
 * can still produce usable output. Ad-hoc axes get `degrade_to: null`
 * (no automatic fallback) and a mid-range cost envelope.
 */
export function buildAdHocSpec(input: {
  axis_id: string;
  label: string;
  tagline: string;
  rationale: string;
  dimension?: AxisDimension;
  instrument_kind?: AxisInstrumentKind;
  output_shape?: AxisOutputShape;
}): AxisSpec {
  return {
    axis_id: input.axis_id,
    label: input.label,
    tagline: input.tagline,
    accent: "#64748B", // slate — neutral accent so catalog axes retain visual identity
    applies_when: input.rationale.slice(0, 200),
    generator_focus: input.rationale.slice(0, 200),
    dimension: input.dimension ?? "generic",
    instrument_kind: input.instrument_kind ?? "decomposition",
    output_shape: input.output_shape ?? "generic_entity_set",
    hard_preconditions: [],
    soft_preconditions: [],
    prompt_variants: {},
    failure_mode:
      "Ad-hoc axis with no structural specialization; may produce generic output if the panel's rationale is thin.",
    degrade_to: null,
    cost_profile: {
      tokens_estimate: 4000,
      seconds_estimate: 25,
    },
  };
}
