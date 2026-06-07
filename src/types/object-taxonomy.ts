/**
 * ── Object Taxonomy for Objective Canvas ──────────────────────────────
 *
 * Strict schema defining every object type that appears on the whiteboard.
 * The canvas is NOT a generic card dump — every object has a semantic type
 * that drives behavior, validation, and rendering.
 *
 * Replaces ad-hoc `entity_type` strings with a discriminated union.
 * Single source of truth for what can exist on the board.
 *
 * Reference: AGENTS.md "Object Taxonomy" section.
 */

// ── Card Type Enum ─────────────────────────────────────────────────────
//
// 13 semantic types, each with specific invariants, required fields, and
// lifecycle rules.

export type ObjectTypeDiscriminator =
  | "raw_input"
  | "pain_point"
  | "desired_result"
  | "variable"
  | "lever"
  | "assumption"
  | "uncertainty"
  | "mechanism"
  | "feature"
  | "experiment"
  | "evidence"
  | "decision"
  | "spec";

// ── Status enums ───────────────────────────────────────────────────────

export type CardStatus =
  | "exploratory"   // Open question; no closure expected yet.
  | "active"        // In play; actively refined/tested.
  | "validated"     // Evidence-backed; confidence ↑.
  | "invalidated"   // Disproven or rejected.
  | "locked"        // User favorite; treated as fact.
  | "archived";     // Kept for record; not in active reasoning.

export type CardSource =
  | "user_input"    // User typed it directly.
  | "ai_generated"  // AI produced via reasoning.
  | "imported"      // External system / API.
  | "literature"    // Research / citation.
  | "inferred";     // Derived from other cards.

/**
 * Measurement of how certain the system is about a card's content,
 * separate from the user's subjective validation. 0..1.
 */
export type ConfidenceLevel = number; // 0.0 .. 1.0

/**
 * How relevant is this card to the stated objective?
 * Separate from confidence; a card can be high-confidence but low-relevance.
 * 0..1.
 */
export type RelevanceScore = number; // 0.0 .. 1.0

// ── Common Fields ──────────────────────────────────────────────────────
//
// Every card has these. Type-specific fields live in the discriminated
// union below.

export interface ObjectBaseFields {
  /** Globally unique card ID. Prefix by type for easy scanning: `var_123`, `pain_456`, etc. */
  id: string;

  /** Discriminator: the type of object this is. */
  type: ObjectTypeDiscriminator;

  /** User-facing title / headline. */
  title: string;

  /** Longer explanation if title needs context. */
  description?: string;

  /** Current lifecycle state. */
  status: CardStatus;

  /** Where did this card originate? */
  source: CardSource;

  /** AI confidence in this card's semantics (0..1). */
  confidence: ConfidenceLevel;

  /** How much does this card matter to solving the objective? (0..1). */
  relevance_score: RelevanceScore;

  /** IDs of other cards this connects to (edges, references, etc). */
  connected_to?: string[];

  /** Is this card visible to the user, or is it AI-internal reasoning? */
  visibility: "user_visible" | "ai_internal" | "shared";

  /** When was this card created? */
  created_at: string;

  /** Last edit. */
  updated_at: string;

  /** Free-form tags for filtering / organization. */
  tags?: string[];

  /** User notes or annotations. */
  notes?: string;
}

// ── Type-Specific Card Schemas ─────────────────────────────────────────

/**
 * Raw Input — What the user originally said (or the system ingested).
 * Unprocessed; no AI interpretation yet.
 *
 * Invariant:
 *   - source is always "user_input" or "imported"
 *   - confidence should be HIGH (user stated it directly)
 *   - status is usually "active" or "locked"
 */
export interface RawInputCard extends ObjectBaseFields {
  type: "raw_input";
  /** The exact text the user provided (immutable for audit). */
  original_text: string;
  /** Optional source URL / file name if imported. */
  source_reference?: string;
}

/**
 * Pain Point — A specific problem, friction, or blocker the user faces.
 *
 * Invariant:
 *   - Must be concrete (not vague). "Slow login" ✓; "Things are bad" ✗
 *   - Implies a Desired Result card exists that inverts it.
 *   - Usually generated from Raw Input via AI analysis.
 */
export interface PainPointCard extends ObjectBaseFields {
  type: "pain_point";
  /** Severity: how much does this hurt? 1..10. */
  severity?: number;
  /** Frequency: how often does this occur? */
  frequency?: "constant" | "often" | "sometimes" | "rare";
  /** Who is affected by this pain? */
  affected_parties?: string[];
  /** Quantified impact if available (e.g., "costs 3 hours/week"). */
  quantified_impact?: string;
}

/**
 * Desired Result — The inverse of a pain point; what the user wants to achieve.
 *
 * Invariant:
 *   - Must be outcome-focused ("users log in instantly" not "add cache").
 *   - Should pair with a Pain Point.
 *   - Success metric should be measurable.
 */
export interface DesiredResultCard extends ObjectBaseFields {
  type: "desired_result";
  /** Measurable success criterion (e.g., "Login under 2s"). */
  success_metric?: string;
  /** How will the user know this is achieved? */
  evidence_of_success?: string;
  /** Timeline / deadline if relevant. */
  target_timeline?: string;
  /** Business value or user value. */
  value_proposition?: string;
}

/**
 * Variable — A factor that influences a result but is not necessarily
 * actionable by the user.
 *
 * Invariant:
 *   - Distinguishes from Lever (Variables can't be pulled; Levers can).
 *   - Could be measurable or abstract.
 *   - May be external (weather, market) or internal (user mood).
 */
export interface VariableCard extends ObjectBaseFields {
  type: "variable";
  /** Can the user directly control this? */
  controllability: "controllable" | "partially_controllable" | "uncontrollable";
  /** What domain is this in? */
  domain?: string;
  /** How does this variable influence the outcome? */
  influence_on_outcome?: string;
  /** Estimated range or distribution if quantifiable. */
  range_or_distribution?: string;
}

/**
 * Lever — A variable or action with high expected impact. Something
 * the user can pull to move the needle.
 *
 * Invariant:
 *   - Must be controllable (by definition).
 *   - High expected ROI / impact-to-effort ratio.
 *   - Generated from Analysis / scoring, not user input.
 */
export interface LeverCard extends ObjectBaseFields {
  type: "lever";
  /** Expected effect size if pulled. */
  expected_impact?: "high" | "medium" | "low";
  /** Effort / cost to activate this lever. */
  activation_cost?: "high" | "medium" | "low";
  /** ROI ratio: impact / effort. */
  impact_to_effort_ratio?: number;
  /** Variable or mechanism this lever directly affects. */
  affects?: string[];
  /** Is this a quick win or long-term play? */
  time_horizon?: "immediate" | "short_term" | "medium_term" | "long_term";
}

/**
 * Assumption — Something the AI (or the system) thinks is true but has
 * not yet proven.
 *
 * Invariant:
 *   - Must be falsifiable (otherwise it's not an assumption).
 *   - Should have a test or evidence plan.
 *   - High risk if wrong.
 */
export interface AssumptionCard extends ObjectBaseFields {
  type: "assumption";
  /** What would make this assumption false? */
  falsification_test?: string;
  /** How critical is this assumption to the strategy? */
  criticality: "existential" | "high" | "medium" | "low";
  /** Current belief in this assumption (separate from confidence). */
  belief_likelihood?: number; // 0..1
  /** What evidence would validate this? */
  validation_criteria?: string;
}

/**
 * Uncertainty — Something unclear, unresolved, or ambiguous that the
 * system flagged.
 *
 * Invariant:
 *   - Less specific than an Assumption; no clear falsification test yet.
 *   - Should drive research or clarification.
 */
export interface UncertaintyCard extends ObjectBaseFields {
  type: "uncertainty";
  /** What specifically is unclear? */
  ambiguity_source?: string;
  /** What would resolve this uncertainty? */
  resolution_path?: string;
  /** How much does this ambiguity block progress? */
  blocking_severity: "blocks_all" | "blocks_major" | "blocks_minor" | "cosmetic";
  /** Suggested next step. */
  clarification_suggestion?: string;
}

/**
 * Mechanism — How a change is supposed to produce an effect. The "because"
 * in "if we do X, Y happens because Z".
 *
 * Invariant:
 *   - Must describe a causal chain.
 *   - Should reference a Lever (the input) and Desired Result (the output).
 *   - Includes assumptions embedded in the causal claim.
 */
export interface MechanismCard extends ObjectBaseFields {
  type: "mechanism";
  /** The input (lever, action, or event). */
  input?: string;
  /** The output (desired result or intermediate state). */
  output?: string;
  /** The causal logic: "because...". */
  causal_logic: string;
  /** Embedded assumptions this mechanism relies on. */
  embedded_assumptions?: string[];
  /** Prior evidence for this mechanism existing in the wild. */
  precedent?: string;
}

/**
 * Feature — A concrete product capability or service offering.
 *
 * Invariant:
 *   - Must be buildable / implementable (not aspirational).
 *   - Should trace back to Desired Result via a Mechanism.
 *   - Scoped enough to spec out.
 */
export interface FeatureCard extends ObjectBaseFields {
  type: "feature";
  /** High-level use case. */
  use_case?: string;
  /** Who benefits? */
  user_segment?: string;
  /** Estimated effort / complexity. */
  implementation_complexity?: "simple" | "moderate" | "complex" | "very_complex";
  /** Dependencies (other features or systems that must exist first). */
  dependencies?: string[];
  /** Rough estimate of build time. */
  estimated_timeline?: string;
}

/**
 * Experiment — A test designed to validate an assumption, mechanism, or
 * lever's effectiveness.
 *
 * Invariant:
 *   - Must have a clear success criterion.
 *   - Should reduce a specific uncertainty or test an assumption.
 *   - Includes a control/baseline.
 */
export interface ExperimentCard extends ObjectBaseFields {
  type: "experiment";
  /** What is being tested? */
  hypothesis: string;
  /** How will you measure success? */
  success_criterion: string;
  /** Duration or sample size. */
  scope?: string;
  /** Cost / effort to run. */
  cost_estimate?: string;
  /** Assumption or uncertainty this experiment targets. */
  targets?: string[];
  /** Expected timeline to completion. */
  estimated_duration?: string;
}

/**
 * Evidence — Research, user feedback, prior decision, metric, or example
 * that informs the reasoning.
 *
 * Invariant:
 *   - Must have a source (literature, experiment, user, etc).
 *   - Can be qualitative or quantitative.
 *   - May validate or contradict other cards.
 */
export interface EvidenceCard extends ObjectBaseFields {
  type: "evidence";
  /** Type of evidence: study, anecdote, metric, precedent, etc. */
  evidence_type:
    | "research_study"
    | "user_feedback"
    | "metric"
    | "precedent"
    | "expert_opinion"
    | "experiment_result"
    | "other";
  /** Citation / reference. */
  citation?: string;
  /** What does this evidence support or contradict? */
  bears_on?: string[];
  /** Confidence in this evidence's quality. */
  evidence_strength?: "strong" | "moderate" | "weak";
  /** Link to external source if available. */
  source_url?: string;
}

/**
 * Decision — A choice the user has made or locked in. Treated as ground
 * truth for downstream reasoning.
 *
 * Invariant:
 *   - Usually status = "locked".
 *   - Visibility often "user_visible" (user chose this).
 *   - Should have a clear rationale / evidence.
 */
export interface DecisionCard extends ObjectBaseFields {
  type: "decision";
  /** What were the alternatives? */
  alternatives_considered?: string[];
  /** Why was this choice made? */
  decision_rationale: string;
  /** Who made this decision? */
  decided_by?: string;
  /** When can this decision be revisited? */
  revisit_trigger?: string;
}

/**
 * Spec — Implementation-ready instruction. Detailed enough for a team to
 * execute without ambiguity.
 *
 * Invariant:
 *   - Must be specific and unambiguous.
 *   - Should be scoped to a single piece of work (one developer, ~1-2 weeks).
 *   - Traces back to a Feature and/or Mechanism.
 */
export interface SpecCard extends ObjectBaseFields {
  type: "spec";
  /** What is being built / done? */
  deliverable: string;
  /** Step-by-step instructions or description. */
  instructions: string;
  /** Acceptance criteria. */
  acceptance_criteria?: string[];
  /** Edge cases / gotchas. */
  edge_cases?: string[];
  /** Links to related specs, features, or design docs. */
  references?: string[];
  /** Priority: must-have, should-have, nice-to-have. */
  priority?: "must_have" | "should_have" | "nice_to_have";
}

// ── Discriminated Union ────────────────────────────────────────────────
//
// Use this type to work with cards polymorphically.

export type ObjectiveCanvasCard =
  | RawInputCard
  | PainPointCard
  | DesiredResultCard
  | VariableCard
  | LeverCard
  | AssumptionCard
  | UncertaintyCard
  | MechanismCard
  | FeatureCard
  | ExperimentCard
  | EvidenceCard
  | DecisionCard
  | SpecCard;

// ── Type guards ────────────────────────────────────────────────────────

export function isRawInput(card: ObjectiveCanvasCard): card is RawInputCard {
  return card.type === "raw_input";
}

export function isPainPoint(card: ObjectiveCanvasCard): card is PainPointCard {
  return card.type === "pain_point";
}

export function isDesiredResult(
  card: ObjectiveCanvasCard
): card is DesiredResultCard {
  return card.type === "desired_result";
}

export function isVariable(card: ObjectiveCanvasCard): card is VariableCard {
  return card.type === "variable";
}

export function isLever(card: ObjectiveCanvasCard): card is LeverCard {
  return card.type === "lever";
}

export function isAssumption(card: ObjectiveCanvasCard): card is AssumptionCard {
  return card.type === "assumption";
}

export function isUncertainty(
  card: ObjectiveCanvasCard
): card is UncertaintyCard {
  return card.type === "uncertainty";
}

export function isMechanism(card: ObjectiveCanvasCard): card is MechanismCard {
  return card.type === "mechanism";
}

export function isFeature(card: ObjectiveCanvasCard): card is FeatureCard {
  return card.type === "feature";
}

export function isExperiment(card: ObjectiveCanvasCard): card is ExperimentCard {
  return card.type === "experiment";
}

export function isEvidence(card: ObjectiveCanvasCard): card is EvidenceCard {
  return card.type === "evidence";
}

export function isDecision(card: ObjectiveCanvasCard): card is DecisionCard {
  return card.type === "decision";
}

export function isSpec(card: ObjectiveCanvasCard): card is SpecCard {
  return card.type === "spec";
}

// ── Type Metadata ────────────────────────────────────────────────────
//
// Static registry for UI + generation logic. Each type has a label,
// description, icon, default color, etc.

export interface TypeMetadata {
  label: string;
  description: string;
  icon: string; // lucide icon slug
  color: string; // hex or tailwind color
  plural: string;
  /** Is this type user-visible by default? */
  default_visibility: "user_visible" | "ai_internal";
}

export const OBJECT_TYPE_METADATA: Record<ObjectTypeDiscriminator, TypeMetadata> = {
  raw_input: {
    label: "Input",
    description: "What the user originally said (immutable record)",
    icon: "input",
    color: "#6366f1",
    plural: "Inputs",
    default_visibility: "user_visible",
  },
  pain_point: {
    label: "Pain Point",
    description: "A specific problem or friction the user faces",
    icon: "alert-circle",
    color: "#ef4444",
    plural: "Pain Points",
    default_visibility: "user_visible",
  },
  desired_result: {
    label: "Desired Result",
    description: "What the user wants to achieve (outcome-focused)",
    icon: "target",
    color: "#10b981",
    plural: "Desired Results",
    default_visibility: "user_visible",
  },
  variable: {
    label: "Variable",
    description: "A factor that influences outcomes",
    icon: "sliders",
    color: "#f59e0b",
    plural: "Variables",
    default_visibility: "user_visible",
  },
  lever: {
    label: "Leverage Point",
    description: "A high-impact variable or action the user can control",
    icon: "zap",
    color: "#ec4899",
    plural: "Leverage Points",
    default_visibility: "user_visible",
  },
  assumption: {
    label: "Assumption",
    description: "Something believed but not yet proven",
    icon: "help-circle",
    color: "#a78bfa",
    plural: "Assumptions",
    default_visibility: "ai_internal",
  },
  uncertainty: {
    label: "Uncertainty",
    description: "Something unclear that needs resolution",
    icon: "help-circle",
    color: "#94a3b8",
    plural: "Uncertainties",
    default_visibility: "ai_internal",
  },
  mechanism: {
    label: "Mechanism",
    description: "How a change produces an effect (causal logic)",
    icon: "workflow",
    color: "#06b6d4",
    plural: "Mechanisms",
    default_visibility: "user_visible",
  },
  feature: {
    label: "Feature",
    description: "A concrete product capability or service",
    icon: "package",
    color: "#8b5cf6",
    plural: "Features",
    default_visibility: "user_visible",
  },
  experiment: {
    label: "Experiment",
    description: "A test to validate assumptions or mechanisms",
    icon: "flask",
    color: "#14b8a6",
    plural: "Experiments",
    default_visibility: "user_visible",
  },
  evidence: {
    label: "Evidence",
    description: "Research, feedback, metrics, or examples",
    icon: "book",
    color: "#0ea5e9",
    plural: "Evidence",
    default_visibility: "user_visible",
  },
  decision: {
    label: "Decision",
    description: "A locked-in choice with rationale",
    icon: "check-circle",
    color: "#22c55e",
    plural: "Decisions",
    default_visibility: "user_visible",
  },
  spec: {
    label: "Spec",
    description: "Implementation-ready instructions",
    icon: "list",
    color: "#f97316",
    plural: "Specs",
    default_visibility: "user_visible",
  },
};

// ── Conversion Helpers ─────────────────────────────────────────────────
//
// Map old `entity_type` strings to new discriminators. Use during migration.

const LEGACY_TYPE_TO_NEW: Record<string, ObjectTypeDiscriminator> = {
  // Legacy types that map to the new taxonomy
  "user_input": "raw_input",
  "problem": "pain_point",
  "pain": "pain_point",
  "friction": "pain_point",
  "goal": "desired_result",
  "outcome": "desired_result",
  "variable": "variable",
  "factor": "variable",
  "lever": "lever",
  "leverage_point": "lever",
  "assumption": "assumption",
  "uncertainty": "uncertainty",
  "ambiguity": "uncertainty",
  "mechanism": "mechanism",
  "causal_claim": "mechanism",
  "feature": "feature",
  "capability": "feature",
  "experiment": "experiment",
  "test": "experiment",
  "evidence": "evidence",
  "research": "evidence",
  "finding": "evidence",
  "decision": "decision",
  "choice": "decision",
  "spec": "spec",
  "implementation": "spec",
};

/**
 * Convert a legacy entity_type string to a new ObjectTypeDiscriminator.
 * Falls back to the input if no mapping exists (for already-new types).
 */
export function migrateEntityType(
  legacyType: string
): ObjectTypeDiscriminator {
  const mapped = LEGACY_TYPE_TO_NEW[legacyType.toLowerCase()];
  if (mapped) return mapped;
  // If it's already a new type, pass through.
  if (isValidObjectType(legacyType as ObjectTypeDiscriminator))
    return legacyType as ObjectTypeDiscriminator;
  // Default fallback: treat as exploratory variable.
  return "variable";
}

/**
 * Validate that a string is a known ObjectTypeDiscriminator.
 */
export function isValidObjectType(
  type: string
): type is ObjectTypeDiscriminator {
  const valid: ObjectTypeDiscriminator[] = [
    "raw_input",
    "pain_point",
    "desired_result",
    "variable",
    "lever",
    "assumption",
    "uncertainty",
    "mechanism",
    "feature",
    "experiment",
    "evidence",
    "decision",
    "spec",
  ];
  return valid.includes(type as ObjectTypeDiscriminator);
}
