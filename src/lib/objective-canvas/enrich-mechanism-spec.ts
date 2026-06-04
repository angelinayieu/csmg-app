// ── Mechanism Technical-Depth Spec ─────────────────────────────────
//
// Arc 3.1 — turns a FEATURE/MECHANISM card from a shallow label +
// 2-3 sentence `definition` into an engineering-grade technical spec.
// The drawer already carries:
//
//   • definition  (2-3 sentences — what it IS)
//   • variations  (3-5 internal implementation patterns — "different
//                  methods of achieving the same thing")
//   • planning    (assumes / depends_on / risks)
//
// …but none of that says HOW the mechanism actually works as a
// system. The user's critique: "mechanisms too vague — need
// technical system design detail + research templates." This fills
// exactly that gap, drawing the template from four cross-domain
// gold-standards so it flexes across use cases:
//
//   • TIDieR (Template for Intervention Description & Replication) —
//     the procedure / materials / dosage / fidelity spine.
//   • BCT Taxonomy + Mechanisms of Action — "active ingredients"
//     (smallest replicable components carrying the causal load) and
//     the mechanism_of_action (the process the components drive).
//   • Logic model / Theory of Change — the causal "why it works"
//     layer that names the variables moved.
//   • Feature-spec vs PRD — the system_components (what to build) +
//     fidelity_signals (acceptance criteria) for the app case.
//
// Output (all net-new vs definition/variations/planning):
//
//   mechanism_of_action  — the causal process. MUST name which root
//                          cause(s) of the room's pains the active
//                          ingredients engage AND which outcome
//                          indicator(s) the mechanism moves, with the
//                          directional path between them. This is the
//                          "solution → variables/mechanisms → problem"
//                          spine the user asked for.
//   active_ingredients[] — the smallest replicable components that
//                          actually carry the causal load (BCT). Each
//                          carries the specific role it plays.
//   how_it_works[]       — ordered operational procedure: what
//                          actually happens, step by step (TIDieR
//                          procedure / logic-model activities).
//   system_components[]  — the concrete parts that must be built /
//                          provisioned. Use-case adaptive (app:
//                          data/ui/logic; health: materials/schedule/
//                          provider; scientific: apparatus/protocol).
//   dosage               — intensity × frequency × duration (TIDieR
//                          how-much). Null when the mechanism has no
//                          meaningful cadence (rare for health/habit,
//                          common for one-shot app affordances).
//   fidelity_signals[]   — how you'd know the mechanism is being
//                          DELIVERED as intended vs drifting. Separates
//                          "the theory was wrong" from "it was never
//                          actually run" (TIDieR how-well / acceptance).
//   research_basis       — evidence_strength + what's known + a
//                          concrete validation experiment to confirm
//                          the mechanism HERE (the "research template").
//
// Storage: writes go into the existing entities.expanded_detail JSONB
// under a new `mechanism_spec` key. No new columns. Additive — every
// existing reader tolerates undefined.
//
// Architecture: standalone library + endpoint, NOT folded into
// expandItemDetail(). This matches the established codebase pattern
// (enrich-chain.ts, refine-mechanism.ts, compose-variations.ts are
// all separate enrichment calls per distinct goal) and keeps the
// already-large expand call from getting slower / more failure-prone.
// Feature-only: pains + outcomes don't get a mechanism spec.

import { llmGenerate, llmJSON, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import {
  composeDesignArtifactWithClaude,
  fallbackDesignArtifactFromSpec,
  type DesignArtifact,
} from "./mechanism-design-artifact";
import {
  buildConstraintsBlock,
  resolveUseCaseMode,
  type OperationalConstraints,
  type UseCaseMode,
} from "./constraints";
import { loadUiSkillSystem } from "./ui-skill-system";
import {
  buildRegistryPromptContext,
  type SpaceDataUnitRegistry,
} from "./data-unit-registry";

export interface MechanismActiveIngredient {
  /** Short noun phrase — the component, e.g. "fixed 25-min work
   *  interval", "implementation-intention prompt", "visible streak
   *  counter". NOT the whole feature — the specific element. */
  name: string;
  /** The causal role this ingredient plays — one sentence. Why it's
   *  load-bearing, not decorative. */
  role: string;
}

export interface MechanismComponent {
  /** What to build / provision — short noun phrase. */
  name: string;
  /** Use-case-adaptive category. App: "data" | "ui" | "logic" |
   *  "integration". Health: "materials" | "schedule" | "cue" |
   *  "provider" | "instrument". Scientific: "apparatus" | "protocol"
   *  | "instrument" | "control". Free string — the LLM picks the
   *  vocabulary that fits the mode. */
  category: string;
  /** One sentence — what this component is + the minimum it must do. */
  detail: string;
}

export interface MechanismResearchBasis {
  /** How well-supported the mechanism is, mapped to the Pearl-ish
   *  ladder the rest of the canvas uses:
   *    "established"  — well-replicated, causal support is strong
   *    "plausible"    — credible mechanism, partial / indirect support
   *    "speculative"  — reasoned-from-first-principles, untested here */
  evidence_strength: "established" | "plausible" | "speculative";
  /** What's actually known — the cited mechanism class or the
   *  first-principles argument. 1-2 sentences. */
  basis: string;
  /** A concrete experiment to validate THIS mechanism in THIS
   *  context — the "research template". Use-case adaptive: app → an
   *  instrumented A/B test; health/habit → an N-of-1 or pre-post with
   *  a validated instrument; scientific → a controlled study with the
   *  confirming endpoint. 1-2 sentences, specific enough to run. */
  validation_experiment: string;
}

// ── v2 (gold-standard) structures ──────────────────────────────────
// The user's standard: a mechanism is an EXECUTABLE technical causal
// chain, not an explanation. These fields separate what/why (PRD),
// how (design doc), why-this-choice (ADR), and whether-it-works
// (validation) — and force a quality gate.

/** "If X → then Y because Z" — the falsifiable mechanism hypothesis. */
export interface MechanismHypothesis {
  /** The system action / intervention. */
  if_do: string;
  /** What measurably improves. */
  then_improves: string;
  /** The causal reason it works — the load-bearing "because". */
  because: string;
}

/** One row of the runtime sequence: step · component · data flow ·
 *  what the user sees. The executable spine. */
export interface MechanismRuntimeStep {
  /** What happens at this step (imperative). */
  step: string;
  /** Which component performs it. */
  component: string;
  /** Data in → out (or "—"). */
  data: string;
  /** User-visible effect at this step, or "—" when internal. */
  user_sees: string;
  /** v3 — structured data tokens this step EMITS. Token IDs
   *  (snake_case, ≤40 chars) that other steps can `consumes`.
   *  Wires `runtime_flow` into a directed DAG so the L3 data-flow
   *  view can render the exact dependency graph instead of parsing
   *  the `data` free-text. Empty array = step emits nothing
   *  consumable by later steps. Optional on the interface (old
   *  stored rows lack it). */
  produces?: string[];
  /** v3 — token IDs this step REQUIRES from upstream (input_data or
   *  earlier `produces`). Pairs with `produces` to build the DAG. */
  consumes?: string[];
  /** v3 — what KIND of user-facing surface this step manifests on,
   *  when it manifests at all. Drives the Experience tab's per-step
   *  iconography (screen → device frame, notification → toast, etc).
   *  Null when the step is purely internal (`user_sees === "—"`). */
  visual_intent?:
    | "screen"
    | "notification"
    | "ambient"
    | "physical"
    | "background"
    | null;
  /** v3 — concise 1-2 sentence sketch of what the user DOES at this
   *  step and how it feels — the experience layer that turns
   *  `user_sees` from a description into a designed moment. Null
   *  when the step is internal. */
  interaction_sketch?: string | null;
}

/** v3 — opinionated design intent for the mechanism's Experience
 *  view. Composed from existing globals.css tokens so the Experience
 *  renderer doesn't need to invent new design language — it just
 *  picks slots from the established Vision-Pro substrate.
 *
 *  All fields required when present on a spec: the model is asked to
 *  COMMIT to a design direction, not punt. The Experience view
 *  reuses these to choose glass tier, accent color, density,
 *  motion, and hero composition. */
export interface MechanismDesignIntent {
  /** Glass elevation from the existing 4-tier system
   *  (`.glass-plate`/`.glass-card`/`.glass-float`/`.glass-hero`). */
  glass_tier: "plate" | "card" | "float" | "hero";
  /** Semantic accent — picks the existing accent palette by intent,
   *  not by raw color. */
  accent_intent: "signal" | "warning" | "growth" | "insight" | "neutral";
  /** Information density target for the Experience hero. */
  density: "airy" | "comfortable" | "dense";
  /** Default motion vocabulary on mount + interaction. */
  motion_intent: "still" | "breathing" | "reveal" | "responsive";
  /** Dominant pattern for the hero composition. The Experience
   *  renderer dispatches on this to pick the right layout. */
  hero_pattern:
    | "metric"
    | "flow"
    | "cycle"
    | "before_after"
    | "evidence"
    | "decision";
  /** MoSCoW reduction trace from the UI skill pack: what was kept
   *  (Must), what was deferred (Could/Should), what was removed
   *  (Won't) — with one-line rationale each. Tells the user WHY the
   *  Experience view is shaped this way. 2-6 entries. */
  reduction_log: string[];
}

/** One way to BUILD the mechanism — the implementation-method
 *  comparison (template D). The ADR picks among these. */
export interface MechanismImplementationMethod {
  name: string;
  /** How it works in one line. */
  how: string;
  /** Data / infrastructure it needs. */
  required_data: string;
  strength: string;
  weakness: string;
  risk: string;
  difficulty: "low" | "medium" | "high";
  /** The call: use now / test later / reject. */
  decision: "use" | "test_later" | "reject";
}

/** Architecture Decision Record — WHY this method, what was ruled
 *  out, and the consequences. The "why this choice" layer. */
export interface MechanismDecisionRecord {
  /** The selected method/approach. */
  chosen: string;
  /** Why it was chosen given the context/constraints. */
  rationale: string;
  /** Alternatives considered + why each was ruled out. */
  alternatives_rejected: Array<{ name: string; why_not: string }>;
  /** What this decision commits you to / its downstream load. */
  consequences: string;
}

/** The internal quality gate. Each axis 0..1. A mechanism that scores
 *  low on any axis is "still vague" and triggers one regeneration. */
export interface MechanismQualityScore {
  /** Is it specific (not generic platitudes)? */
  specificity: number;
  /** Could an engineer build from it? */
  technical_depth: number;
  /** Can the system measure whether it worked? */
  measurability: number;
  /** Does it connect to actual user-visible UI/behavior? */
  ui_connection: number;
  /** Is it actually buildable under the constraints? */
  feasibility: number;
  /** Are the failure modes named clearly? */
  failure_mode_clarity: number;
}

export interface MechanismSpec {
  /** The causal process — names the root cause engaged + indicator
   *  moved + the path between. ≤ ~700 chars. */
  mechanism_of_action: string;
  /** v2 — the falsifiable "if → then → because" hypothesis. */
  mechanism_hypothesis: MechanismHypothesis;
  /** v2 — what data the mechanism consumes (logic-model inputs). */
  input_data: string[];
  /** Smallest replicable components carrying the causal load (BCT).
   *  2-5 typical. */
  active_ingredients: MechanismActiveIngredient[];
  /** Ordered operational procedure — what actually happens. 3-7
   *  steps. */
  how_it_works: string[];
  /** v2 — the executable runtime sequence (step · component · data ·
   *  user_sees). Deeper than how_it_works; the engineering spine. */
  runtime_flow: MechanismRuntimeStep[];
  /** Concrete parts to build / provision. Use-case adaptive. 2-6. */
  system_components: MechanismComponent[];
  /** v2 — what the USER actually sees/experiences — connects the
   *  mechanism to real UI/behavior (the missing mechanism→UI link). */
  user_visible_behavior: string;
  /** v2 — different methods of achieving the same result, COMPARED
   *  (template D). 2-4. */
  implementation_methods: MechanismImplementationMethod[];
  /** v2 — ADR: why the chosen method over the rejected alternatives. */
  decision_record: MechanismDecisionRecord;
  /** Intensity × frequency × duration. Null when no meaningful
   *  cadence. */
  dosage: string | null;
  /** How you'd know the mechanism is being delivered correctly.
   *  2-4. */
  fidelity_signals: string[];
  /** v2 — when to ABANDON this mechanism (kill criteria). 2-4. */
  kill_criteria: string[];
  /** P1.2 — testable "done / working" conditions a coding agent can
   *  build against (definition of done). 2-5. Distinct from
   *  fidelity_signals (delivered-as-intended) + kill_criteria (abandon). */
  acceptance_criteria: string[];
  /** P1.2 — what this mechanism explicitly is NOT doing (scope
   *  boundaries / non-goals). 2-5. The per-feature anti-drift control the
   *  agent-build-spec aggregates. */
  scope_boundaries: string[];
  /** Evidence + a concrete validation experiment. */
  research_basis: MechanismResearchBasis;
  /** v2 — the internal quality gate's final 6-axis score. */
  quality_score: MechanismQualityScore;
  /** Which use-case mode framed this spec — lets the UI label the
   *  vocabulary ("clinical protocol" vs "feature spec") + lets a
   *  re-gen detect a mode change. */
  use_case_mode: UseCaseMode;
  /** ISO timestamp this spec was generated. */
  generated_at: string;
  /** Which tier produced this — for the MethodBadge. Always "rubric"
   *  (single analytic LLM pass). */
  evaluation_method: "rubric";
  /** v3 — opinionated design intent for the Experience view.
   *  Optional on the interface so old stored specs (which lack it)
   *  still parse cleanly; required in the LLM schema so every new
   *  generation commits to a direction. */
  design_intent?: MechanismDesignIntent;
  /** v3 — stable identity slug shared with the room glossary +
   *  cross-room weave. Reserved here so the parallel concept-slug
   *  workstream can populate it without a schema migration; the
   *  generator emits null until that lands. See
   *  ROOM_ANNOTATION_GLOSSARY_PHASE2_PLAN.md +
   *  MACRO_ROLLUP_AND_COORDINATION_SPEC.md Step 5. */
  concept_slug?: string | null;
  /** v3 — Claude-composed structured design artifact. Captures
   *  per-section UI composition (hero + moments + flow + stats +
   *  callouts + before/after) with headline-level copy Claude wrote
   *  specifically for THIS mechanism. Renders via
   *  `mechanism-design-artifact-view.tsx`. Closes the user's
   *  session-1 ask: "Claude generates the final UI artifacts."
   *  Done as a STRUCTURED artifact (not raw JSX) to avoid sandbox/
   *  XSS risk while preserving Claude's compositional control.
   *
   *  Generated by `composeDesignArtifactWithClaude` (Sonnet) when
   *  `USE_CLAUDE_DESIGN_ARTIFACT` is not "false" — falls back to a
   *  minimal `fallbackDesignArtifactFromSpec` derivation when
   *  Claude is unavailable. Optional on the interface so pre-v3
   *  specs and the env-disabled case parse cleanly. */
  design_artifact?: DesignArtifact | null;
}

export interface EnrichMechanismSpecInput {
  feature: {
    name: string;
    positive_outcome?: string;
    first_principles?: string[];
    /** The drawer's existing 2-3 sentence definition, when present —
     *  grounds the spec so it EXTENDS the definition rather than
     *  restating it. */
    definition?: string;
  };
  /** The user's elected variation(s) for this feature, when any. The
   *  spec describes the CHOSEN direction concretely; falls back to
   *  the generic feature when nothing is elected. */
  elected_variations?: Array<{
    name: string;
    description: string;
    tradeoff: string;
  }>;
  /** Room pains — so mechanism_of_action can name WHICH problem (and
   *  which root cause) the mechanism engages. */
  room_pains: Array<{
    name: string;
    negative_outcome?: string;
    root_causes?: string[];
  }>;
  /** Room outcomes — so mechanism_of_action can name WHICH indicator
   *  the mechanism moves, grounded in the baseline→target gap when
   *  the user has set one. */
  room_outcomes: Array<{
    name: string;
    measured_by?: string;
    indicators?: string[];
    indicator_baselines?: Record<
      string,
      {
        baseline_value?: string;
        target_value?: string;
        unit?: string;
      }
    >;
  }>;
  sub_objective_title: string;
  core_objective_text: string;
  constraints: OperationalConstraints | null;
  /** Phase B — the chain enrichment already authored by enrich-chain
   *  (read from the feature's edges' agent_feedback). The chain owns the
   *  COARSE edge-level causal story — which root cause is engaged, the
   *  mediators, where the path is weak. The spec's mechanism_of_action
   *  must DEEPEN this into the fine feature-internal mechanism, not
   *  re-derive a parallel (possibly contradicting) story. This kills the
   *  highest-drift redundancy: two stages authoring the same mechanism
   *  narrative blind to each other. Undefined when chains aren't
   *  enriched yet (chain enrichment runs at room-gen; the spec runs
   *  post-election, so the narrative usually already exists). */
  chain_context?: {
    narrative?: string;
    causal_flow_rationale?: string;
    outcome_closes_loop?: string;
    mediators?: Array<{ name: string; assumption: string; effect: string }>;
    weak_points?: string[];
    chain_strength?: number;
  } | null;
  /** v3 — the space's data-unit registry, when populated. When
   *  provided, the LLM is given the list of registered slugs so it
   *  picks from the existing vocabulary for `runtime_flow.produces`/
   *  `consumes` instead of inventing fresh synonyms (the silent
   *  drift that breaks downstream depends_on derivation + the
   *  macro data-flow view). Optional + soft: an empty/missing
   *  registry falls back to free-text token emission with no
   *  behavior change. See `data-unit-registry.ts`. */
  registry?: SpaceDataUnitRegistry | null;
  /** Cooperation Plan v2 Fix E — rubric composite_score (0..1) of the
   *  representative variation (elected first, top-scored fallback).
   *  Drives TWO behaviors:
   *    1. PROSE CALIBRATION — the prompt instructs the LLM to use
   *       decisive language when ≥0.7 (high confidence the mechanism
   *       works), exploratory + flagged-uncertainty when <0.4 (low
   *       confidence — the spec should hedge in mechanism_of_action).
   *    2. SPECIFICITY FLOOR — the quality-gate retry decision uses
   *       max(self_score.specificity, top_variation_score) so a
   *       strongly-scored variation doesn't trigger retry on the
   *       specificity axis just because the spec's own self-grade is
   *       conservative. Prevents the "better grading → same retry
   *       behavior" perverse outcome (Finding X2 of the v2 review).
   *  Undefined when no variation has been scored yet — calibration
   *  and floor both no-op. */
  top_variation_score?: number;
  /** Cooperation Plan v2 Fix E — technical research anchors from
   *  detail_research.technical, up to ~5 items with { title, informs }.
   *  Drives the `research_basis` field's evidence: when present, the
   *  LLM cites real source titles instead of hallucinating precedents.
   *  Empty array OR undefined → research_basis falls back to existing
   *  behavior (LLM-generated framing without grounded citations).
   *  Caller is responsible for normalizing legacy bundle shapes — the
   *  enricher trusts the array as-is. */
  research_anchors?: Array<{ title: string; informs: string }>;
  /** Cooperation Plan v2 Fix E — retry guard. When true, the
   *  quality-gate retry is SUPPRESSED even if the first attempt's
   *  minQuality is below QUALITY_THRESHOLD. Caller sets this when
   *  the low quality is EXPECTED (e.g. top_variation_score < 0.4 —
   *  the underlying mechanism is uncertain, retrying won't make the
   *  spec more specific because the input itself is shaky). The
   *  first-attempt spec is persisted with quality_calibrated_uncertainty
   *  metadata. Prevents the retry loop on inherently uncertain
   *  variations (Q4 resolution in the v2 plan §8). */
  accept_on_first_attempt?: boolean;
}

// ── Use-case-adaptive framing — same template, different vocabulary ──
//
// The mechanism spec template is universal; what differs across modes
// is what system_components / dosage / active_ingredients / the
// validation experiment concretely MEAN. This block makes the same
// engine produce a feature spec for an app builder, a clinical
// intervention protocol for a health user, and a controlled-study
// design for a scientist.

const MODE_FRAMING: Record<UseCaseMode, string> = {
  consumer_app: `USE-CASE: CONSUMER APP / PRODUCT.
This mechanism is a product feature. Frame the spec like a feature specification (the "how exactly does this work" doc, not the PRD):
  • active_ingredients — the specific interaction-design / algorithmic elements that carry the behavioral load (e.g. "default-on toggle", "loss-framed nudge copy", "decayed-recency ranking"), NOT generic UI parts.
  • system_components — categories: "data" (models / events to log), "ui" (surfaces / states incl. empty + error), "logic" (the algorithm / rules), "integration" (3rd-party / platform APIs).
  • dosage — engagement cadence: how often the feature fires or is used (e.g. "1 nudge/day, capped at 3/week"). Null only if genuinely one-shot.
  • research_basis.validation_experiment — a shippable instrumented A/B test or fake-door / prototype with the metric that would confirm the mechanism.`,

  personal_health: `USE-CASE: PERSONAL HEALTH INTERVENTION (incl. habit stacks).
This mechanism is a behavioral / physiological intervention for the user or a patient. Frame the spec like a clinical intervention protocol (TIDieR) + behavior-change design:
  • active_ingredients — the behavior-change techniques (BCTs) that carry the load (e.g. "implementation intentions", "self-monitoring", "cue-response binding", "graded exposure"). Name the technique, not the wrapper.
  • system_components — categories: "materials" (what the person needs), "schedule" (when), "cue" (the trigger that fires the behavior — critical for habit stacks: name the anchor behavior), "provider" (self / coach / clinician role), "instrument" (what tracks it).
  • dosage — the prescription: intensity × frequency × duration (e.g. "20 min, 5×/week, 8 weeks"). Almost always non-null for health.
  • research_basis.validation_experiment — an N-of-1 / single-case (ABAB) design or a pre-post with a VALIDATED instrument (name it — GAD-7, PSQI, actigraphy, etc.).`,

  scientific: `USE-CASE: SCIENTIFIC PREDICTION / EFFECT ESTIMATION.
This mechanism is a manipulated causal factor whose effect you're predicting across a population. Frame the spec like an experimental method section:
  • active_ingredients — the isolated causal factors being manipulated, separated from confounds. Name what is varied and what is held constant.
  • system_components — categories: "apparatus", "protocol" (the manipulation procedure), "instrument" (measurement), "control" (the comparison condition).
  • dosage — the exposure / dose parameter and its levels (e.g. "0 / 200 / 400 mg").
  • research_basis — cite the established mechanism class + the effect-size range literature would predict; validation_experiment = a controlled design (RCT / quasi-experiment) with the confirming endpoint + the threshold that would falsify the mechanism.`,
};

const SYSTEM_PROMPT = `You are a mechanism-design engineer. A mechanism is NOT an explanation — it is an EXECUTABLE TECHNICAL CAUSAL CHAIN. Turn a named feature/mechanism into a rigorous, replicable spec deep enough that an ENGINEER could build it, a DESIGNER knows what the user sees, a RESEARCHER knows the hypothesis + test, and the SYSTEM can measure whether it worked. You are NOT writing marketing copy or restating the definition.

You will be told the USE-CASE so you use the right vocabulary (product feature vs clinical protocol vs experimental method). Adapt — the template is universal, the concretes are not.

Produce these fields:

1. mechanism_of_action (1 paragraph, ≤700 chars)
   The causal process. MUST name: (a) WHICH root cause of the room's pain(s) the active ingredients engage, (b) WHICH outcome indicator(s) it moves, (c) the directional path ("by X → which shifts Y → observably moving Z"). When an indicator carries a BASELINE → TARGET gap, ground the path in closing THAT gap. Mechanistic, not aspirational.

2. mechanism_hypothesis — the falsifiable claim, as three parts:
   • if_do — the system action / intervention ("the system ranks candidate actions by goal-relevance + distraction-risk and gates the low-value ones")
   • then_improves — what measurably improves ("goal-relevant task completion rises, irrelevant navigation falls")
   • because — the load-bearing causal reason ("the comparison happens BEFORE attention is spent, so the detour never reaches the main surface")

3. input_data (3-7) — the data the mechanism consumes to do its work (logic-model inputs). Concrete ("user's active goal", "knowledge-graph dependencies", "session attention history") — not "user data".

4. active_ingredients (2-5) — the SMALLEST replicable components that carry the causal load — the parts that, if removed, break the effect. Each: name + role (why load-bearing). Decompose; don't list the whole feature as one ingredient.

5. how_it_works (3-7 ordered steps) — the operational procedure / transformation logic, trigger → effect. Each ≤140 chars.

6. runtime_flow (4-8 rows) — the EXECUTABLE sequence. Each row carries BOTH the engineering spine AND the experience layer:
   • step — what happens (imperative)
   • component — which component does it
   • data — data in → out (free-text, or "—")
   • user_sees — what the user observes at this step, or "—" if internal
   • produces — token IDs this step EMITS (snake_case, ≤40 chars each). Used by later steps' \`consumes\` to wire a DAG. Empty array if nothing consumable. Example: ["ranked_candidates", "ranking_explanation"].
   • consumes — token IDs this step REQUIRES from earlier steps' \`produces\` or from input_data. Empty array if self-contained. Example: ["user_active_goal", "ranked_candidates"].
   • visual_intent — what KIND of surface this step manifests on, or null when purely internal (user_sees === "—"). One of: "screen" (a primary view), "notification" (toast / push / banner), "ambient" (peripheral signal — color, hum, glow), "physical" (a real-world object or action), "background" (silent server-side work the user only notices by its result).
   • interaction_sketch — 1-2 concise sentences on what the USER DOES at this step + how it should FEEL. Lead with verb. Null when purely internal. Examples: "User flicks the deck up; the top card eases out with a subtle spring while the next one breathes forward." / "User taps Approve; the row collapses into a single confirmed line and the next item slides into focus."
   This is the engineering spine AND the experience layer — be concrete about both. The L3 Data-flow view consumes produces/consumes; the Experience view consumes visual_intent/interaction_sketch.

7. system_components (2-6) — concrete parts to build/provision. Each: name + category (per USE-CASE framing) + detail.

8. user_visible_behavior (1-2 sentences) — what the USER actually sees / experiences. This connects the mechanism to real UI/behavior — never leave it abstract.

9. implementation_methods (2-4) — different TECHNICAL ways to BUILD the chosen mechanism. These are ENGINEERING approaches to implement the SAME chosen direction — NOT design alternatives (the feature's design variants / "IV candidates" are picked elsewhere; do not re-list them here). Examples: rule-based vs embedding-similarity vs graph-dependency vs learned/adaptive vs hybrid; or manual vs scripted vs sensor-driven for a health protocol. Each: name, how (1 line), required_data, strength, weakness, risk, difficulty ("low"|"medium"|"high"), decision ("use"|"test_later"|"reject"). At least one "use".

10. decision_record (ADR — why THIS method over the others):
   • chosen — the selected method/approach
   • rationale — why, given the context + constraints
   • alternatives_rejected — the methods you marked test_later/reject, each with why_not
   • consequences — what choosing this commits you to (its downstream load / dependency)

11. dosage (string or null) — intensity × frequency × duration per USE-CASE framing. Null only if genuinely no cadence.

12. fidelity_signals (2-4) — how you'd know the mechanism is being DELIVERED as intended (RAN as specified), not whether it worked. Separates "theory wrong" from "never done". Specific + observable.

13. kill_criteria (2-4) — when to ABANDON this mechanism. Specific failure conditions ("users override the ranking >50% of the time", "no completion lift after tuning").

14. research_basis:
   • evidence_strength — "established" / "plausible" / "speculative". Be honest — most novel mechanisms are "plausible" at best.
   • basis — what's actually known (cited mechanism class or first-principles argument).
   • validation_experiment — a concrete, runnable test per USE-CASE framing.

15. quality_score — HONESTLY self-grade the spec you just wrote, each 0.0–1.0:
   • specificity — is it specific, not generic platitudes?
   • technical_depth — could an engineer build from it?
   • measurability — can the system measure whether it worked?
   • ui_connection — how well does the spec connect to actual user-visible UI/behavior? Grade against three concrete checks: (a) every runtime_flow row where user_sees ≠ "—" has a non-null visual_intent AND a concrete interaction_sketch; (b) design_intent's glass_tier / accent_intent / density / motion_intent / hero_pattern form a COHERENT story (e.g. "dense + reveal + cycle" is plausible, "dense + still + decision" is contradictory); (c) the reduction_log shows at least one MoSCoW kept-or-dropped choice with rationale. Three checks pass → ≥0.8; two → ~0.6; one or zero → ≤0.4.
   • feasibility — is it buildable under the constraints?
   • failure_mode_clarity — are the failure modes named clearly?
   Score honestly — a low score is a useful signal, not a failure. Do NOT inflate.

16. acceptance_criteria (2-5) — testable "done / working" conditions an engineer or coding agent can build against. Observable + checkable ("a returning user sees their top-3 ranked items in <200ms", "completing a task increments the streak exactly once"). Definition of DONE — not whether the theory holds (that's validation_experiment).

17. scope_boundaries (2-5) — what this mechanism explicitly does NOT do, to stop scope creep ("does not handle multi-user shared streaks", "no offline mode in v1"). Concrete non-goals, not vague disclaimers.

18. design_intent — opinionated design direction for the Experience view. Every field is REQUIRED — commit to a choice, don't punt:
   • glass_tier — pick the elevation tier from the existing glass system: "plate" (subtle), "card" (default), "float" (elevated panel), "hero" (the highest, most-blurred surface — reserved for showstopper moments).
   • accent_intent — pick by MEANING, not color: "signal" (information / live data), "warning" (caution / fragile state), "growth" (progress / positive momentum), "insight" (analytical / synthesized), "neutral" (default).
   • density — "airy" (lots of breathing room, one big idea), "comfortable" (balanced — the default for most mechanisms), "dense" (many small data points, reserved for instruments/dashboards).
   • motion_intent — "still" (no animation, archival feel), "breathing" (subtle ambient pulse — for live/running state), "reveal" (mount-in choreography — for new generations), "responsive" (motion ties tightly to user input — for direct-manipulation feel).
   • hero_pattern — the dominant composition of the Experience hero. Pick by the SHAPE of the mechanism: "metric" (one big number + delta — for measurement mechanisms), "flow" (3-step ribbon — for transformation mechanisms), "cycle" (loop diagram — for feedback-loop mechanisms), "before_after" (split — for state-change mechanisms), "evidence" (quotes + citations — for research-grounded mechanisms), "decision" (fork — for branching / gating mechanisms).
   • reduction_log (2-6 items) — your MoSCoW reduction trace per the UI skill pack: what you KEPT and what you DROPPED, each one-line with rationale. Format: "Kept: X — because Y" / "Dropped: A — because B". Show the discipline.

19. concept_slug — set to null. Reserved for a parallel workstream that stamps a stable identity slug on annotations + room entities; the generator does not populate it yet.

Rules:
- EVERY field references something specific from the feature, its elected direction, the room's pains/root_causes, or the outcomes/indicators. Generic filler is forbidden.
- If the user ELECTED a variation, spec THAT chosen direction concretely.
- Respect the operational constraints. A spec the user can't build is wasted.
- Be honest about evidence_strength + quality_score.
- design_intent must be COHERENT with the mechanism's nature: a slow archival audit mechanism should not pick "responsive" motion + "dense" + "decision"; a live monitoring instrument should not pick "still" + "airy". Reduction_log should reflect at least one real tradeoff you made.

Return JSON matching the response schema. No prose outside the JSON.`;

function indicatorLine(
  name: string,
  baselines:
    | Record<
        string,
        { baseline_value?: string; target_value?: string; unit?: string }
      >
    | undefined,
): string {
  if (!baselines) return name;
  let entry = baselines[name];
  if (!entry) {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(baselines)) {
      if (k.toLowerCase() === lower) {
        entry = v;
        break;
      }
    }
  }
  if (!entry) return name;
  const parts: string[] = [];
  if (entry.baseline_value) parts.push(`BASELINE ${entry.baseline_value}`);
  if (entry.target_value) parts.push(`→ TARGET ${entry.target_value}`);
  if (entry.unit) parts.push(`(${entry.unit})`);
  return parts.length === 0 ? name : `${name} [${parts.join(" ")}]`;
}

function buildUserPrompt(ctx: EnrichMechanismSpecInput, mode: UseCaseMode): string {
  const constraintsBlock = ctx.constraints
    ? `\n${buildConstraintsBlock(ctx.constraints)}\n`
    : "";

  const fp =
    ctx.feature.first_principles && ctx.feature.first_principles.length > 0
      ? `\n  first_principles: ${ctx.feature.first_principles
          .slice(0, 5)
          .join(" · ")}`
      : "";
  const def = ctx.feature.definition
    ? `\n  definition (EXTEND this, don't restate): ${ctx.feature.definition.slice(0, 400)}`
    : "";
  const positive = ctx.feature.positive_outcome
    ? `\n  intended positive_outcome: ${ctx.feature.positive_outcome}`
    : "";

  const electedBlock =
    ctx.elected_variations && ctx.elected_variations.length > 0
      ? `\n\nELECTED DIRECTION (the user chose ${
          ctx.elected_variations.length === 1 ? "this approach" : "these approaches"
        } — spec THIS, not the generic feature):\n${ctx.elected_variations
          .slice(0, 4)
          .map(
            (v) =>
              `  • ${v.name} — ${v.description.slice(0, 160)}${
                v.tradeoff ? ` (tradeoff: ${v.tradeoff.slice(0, 120)})` : ""
              }`,
          )
          .join("\n")}`
      : "";

  const painsBlock =
    ctx.room_pains.length > 0
      ? `\n\nROOM PAINS (name which root cause the mechanism engages):\n${ctx.room_pains
          .slice(0, 5)
          .map((p) => {
            const rc =
              p.root_causes && p.root_causes.length > 0
                ? `\n      root_causes: ${p.root_causes.slice(0, 4).join(" · ")}`
                : "";
            const neg = p.negative_outcome
              ? `\n      negative_outcome: ${p.negative_outcome.slice(0, 160)}`
              : "";
            return `  • ${p.name}${neg}${rc}`;
          })
          .join("\n")}`
      : "";

  const outcomesBlock =
    ctx.room_outcomes.length > 0
      ? `\n\nROOM OUTCOMES (name which indicator the mechanism moves):\n${ctx.room_outcomes
          .slice(0, 5)
          .map((o) => {
            const inds =
              o.indicators && o.indicators.length > 0
                ? `\n      indicators:\n${o.indicators
                    .slice(0, 5)
                    .map(
                      (ind) =>
                        `        • ${indicatorLine(ind, o.indicator_baselines)}`,
                    )
                    .join("\n")}`
                : "";
            const mb = o.measured_by
              ? `\n      measured_by: ${o.measured_by.slice(0, 120)}`
              : "";
            return `  • ${o.name}${mb}${inds}`;
          })
          .join("\n")}`
      : "";

  // Phase B — chain context. The chain analyst already authored the
  // COARSE edge-level causal story (which root cause → which outcome,
  // mediators, weak points). The spec must DEEPEN it, not re-derive a
  // parallel one. This is the single source of truth for the chain-level
  // narrative; the spec owns only the feature-internal mechanism.
  const cc = ctx.chain_context;
  const hasChain =
    !!cc &&
    (!!cc.narrative ||
      !!cc.causal_flow_rationale ||
      (Array.isArray(cc.weak_points) && cc.weak_points.length > 0) ||
      (Array.isArray(cc.mediators) && cc.mediators.length > 0));
  const chainBlock = hasChain
    ? `\n\nCHAIN ANALYSIS — the COARSE causal story is ALREADY established (by the chain analyst, at the edge level). Go DEEPER; do NOT re-derive it:${
        cc!.narrative ? `\n  Edge narrative: ${cc!.narrative.slice(0, 500)}` : ""
      }${
        cc!.causal_flow_rationale
          ? `\n  Why this path (not direct): ${cc!.causal_flow_rationale.slice(0, 240)}`
          : ""
      }${
        cc!.outcome_closes_loop
          ? `\n  How the outcome closes the loop: ${cc!.outcome_closes_loop.slice(0, 200)}`
          : ""
      }${
        cc!.mediators && cc!.mediators.length > 0
          ? `\n  Mediators (variables that moderate the chain): ${cc!.mediators
              .slice(0, 5)
              .map((m) => `${m.name} (${m.effect})`)
              .join(" · ")}`
          : ""
      }${
        cc!.weak_points && cc!.weak_points.length > 0
          ? `\n  Known WEAK POINTS in the chain: ${cc!.weak_points.slice(0, 3).join("; ")}`
          : ""
      }
  COARSE→FINE RULE: the narrative above is the EDGE-LEVEL story — which root cause connects to which outcome, and where the path is fragile. Your mechanism_of_action must stay CONSISTENT with it and go FINER: explain HOW the feature INTERNALLY produces the effect the chain claims, naming the SAME root cause + indicator. Do NOT restate the narrative. Fold the chain's mediators into runtime_flow / fidelity_signals where they're load-bearing, and make your kill_criteria + fidelity_signals directly address the chain's named weak points.`
    : "";

  // Cooperation Plan v2 Fix E — research anchors block. When present,
  // the LLM cites real source titles in research_basis instead of
  // hallucinating precedents. Cap at 5; the prompt budget is already
  // tight after chain_context + variations + room context.
  const researchBlock =
    ctx.research_anchors && ctx.research_anchors.length > 0
      ? `\n\nRESEARCH ANCHORS (real precedents for research_basis — cite by title in research_basis.what_we_know, do NOT invent sources):\n${ctx.research_anchors
          .slice(0, 5)
          .map(
            (a, i) =>
              `  T${i + 1}. ${a.title.slice(0, 120)}${a.informs ? ` — ${a.informs.slice(0, 140)}` : ""}`,
          )
          .join("\n")}`
      : "";

  // Cooperation Plan v2 Fix E — score calibration block. Tells the
  // LLM how confident to be in mechanism_of_action prose. The 0.4 and
  // 0.7 thresholds match the route-side accept_on_first_attempt
  // decision so the spec's tone is consistent with the retry policy.
  const scoreBlock =
    typeof ctx.top_variation_score === "number"
      ? `\n\nVARIATION CONFIDENCE (rubric composite, 0..1): ${ctx.top_variation_score.toFixed(2)}
  CALIBRATION:
    ≥0.7 — the rubric grades this variation as strongly plausible. Be DECISIVE in mechanism_of_action: name the mechanism class, commit to the active_ingredients, don't hedge.
    0.4-0.7 — moderate. Standard tone is fine; surface honest uncertainty in fidelity_signals + kill_criteria.
    <0.4 — the rubric flags this variation as weak. Be EXPLORATORY in mechanism_of_action: use "candidate" / "we hypothesize" / "investigates whether" language, name the specific uncertainty in research_basis.what_we_dont_know, and make validation_experiment the load-bearing element. Do NOT inflate certainty to pass the quality gate — the caller will accept a calibrated-uncertainty spec on first attempt without retry.`
      : "";

  return `${MODE_FRAMING[mode]}

PARENT OBJECTIVE:
"""
${ctx.core_objective_text.slice(0, 800)}
"""

SUB-OBJECTIVE (room scope):
"""
${ctx.sub_objective_title}
"""

THE MECHANISM TO SPEC:

[FEATURE / MECHANISM] ${ctx.feature.name}${positive}${fp}${def}${electedBlock}${painsBlock}${outcomesBlock}${chainBlock}${researchBlock}${scoreBlock}
${constraintsBlock}
Produce the technical mechanism spec per the system instructions. Be specific, be honest about evidence, and make mechanism_of_action name the root cause engaged + the indicator moved.`;
}

const SPEC_SCHEMA = {
  name: "mechanism_spec",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mechanism_of_action: { type: "string" },
      mechanism_hypothesis: {
        type: "object",
        additionalProperties: false,
        properties: {
          if_do: { type: "string" },
          then_improves: { type: "string" },
          because: { type: "string" },
        },
        required: ["if_do", "then_improves", "because"],
      },
      input_data: { type: "array", items: { type: "string" } },
      active_ingredients: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            role: { type: "string" },
          },
          required: ["name", "role"],
        },
      },
      how_it_works: {
        type: "array",
        items: { type: "string" },
      },
      runtime_flow: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            step: { type: "string" },
            component: { type: "string" },
            data: { type: "string" },
            user_sees: { type: "string" },
            // v3 — produces/consumes wire the steps into a DAG so the
            // L3 data-flow view can render the exact dependency
            // graph without parsing the free-text `data` field.
            // Strict mode forces these to be REQUIRED in the schema;
            // the LLM emits [] when the step has nothing to declare.
            produces: {
              type: "array",
              items: { type: "string" },
            },
            consumes: {
              type: "array",
              items: { type: "string" },
            },
            // v3 — visual_intent + interaction_sketch drive the
            // Experience tab. Null when the step is purely internal
            // (i.e. user_sees === "—").
            visual_intent: {
              type: ["string", "null"],
              enum: [
                "screen",
                "notification",
                "ambient",
                "physical",
                "background",
                null,
              ],
            },
            interaction_sketch: { type: ["string", "null"] },
          },
          required: [
            "step",
            "component",
            "data",
            "user_sees",
            "produces",
            "consumes",
            "visual_intent",
            "interaction_sketch",
          ],
        },
      },
      system_components: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            detail: { type: "string" },
          },
          required: ["name", "category", "detail"],
        },
      },
      user_visible_behavior: { type: "string" },
      implementation_methods: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            how: { type: "string" },
            required_data: { type: "string" },
            strength: { type: "string" },
            weakness: { type: "string" },
            risk: { type: "string" },
            difficulty: { type: "string", enum: ["low", "medium", "high"] },
            decision: {
              type: "string",
              enum: ["use", "test_later", "reject"],
            },
          },
          required: [
            "name",
            "how",
            "required_data",
            "strength",
            "weakness",
            "risk",
            "difficulty",
            "decision",
          ],
        },
      },
      decision_record: {
        type: "object",
        additionalProperties: false,
        properties: {
          chosen: { type: "string" },
          rationale: { type: "string" },
          alternatives_rejected: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                why_not: { type: "string" },
              },
              required: ["name", "why_not"],
            },
          },
          consequences: { type: "string" },
        },
        required: [
          "chosen",
          "rationale",
          "alternatives_rejected",
          "consequences",
        ],
      },
      dosage: { type: ["string", "null"] },
      fidelity_signals: {
        type: "array",
        items: { type: "string" },
      },
      kill_criteria: {
        type: "array",
        items: { type: "string" },
      },
      acceptance_criteria: {
        type: "array",
        items: { type: "string" },
      },
      scope_boundaries: {
        type: "array",
        items: { type: "string" },
      },
      research_basis: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidence_strength: {
            type: "string",
            enum: ["established", "plausible", "speculative"],
          },
          basis: { type: "string" },
          validation_experiment: { type: "string" },
        },
        required: ["evidence_strength", "basis", "validation_experiment"],
      },
      quality_score: {
        type: "object",
        additionalProperties: false,
        properties: {
          specificity: { type: "number" },
          technical_depth: { type: "number" },
          measurability: { type: "number" },
          ui_connection: { type: "number" },
          feasibility: { type: "number" },
          failure_mode_clarity: { type: "number" },
        },
        required: [
          "specificity",
          "technical_depth",
          "measurability",
          "ui_connection",
          "feasibility",
          "failure_mode_clarity",
        ],
      },
      // v3 — opinionated design intent for the Experience view.
      // Every new generation commits; old stored rows (which lack
      // this) keep working because the TS interface marks it
      // optional. parseSpec defaults to a neutral block on absence.
      design_intent: {
        type: "object",
        additionalProperties: false,
        properties: {
          glass_tier: {
            type: "string",
            enum: ["plate", "card", "float", "hero"],
          },
          accent_intent: {
            type: "string",
            enum: ["signal", "warning", "growth", "insight", "neutral"],
          },
          density: {
            type: "string",
            enum: ["airy", "comfortable", "dense"],
          },
          motion_intent: {
            type: "string",
            enum: ["still", "breathing", "reveal", "responsive"],
          },
          hero_pattern: {
            type: "string",
            enum: [
              "metric",
              "flow",
              "cycle",
              "before_after",
              "evidence",
              "decision",
            ],
          },
          reduction_log: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "glass_tier",
          "accent_intent",
          "density",
          "motion_intent",
          "hero_pattern",
          "reduction_log",
        ],
      },
      // v3 — concept_slug reserved for the parallel concept-slug
      // workstream. Generator emits null until that lands; the
      // glossary/cross-room weave will populate it later.
      concept_slug: { type: ["string", "null"] },
    },
    required: [
      "mechanism_of_action",
      "mechanism_hypothesis",
      "input_data",
      "active_ingredients",
      "how_it_works",
      "runtime_flow",
      "system_components",
      "user_visible_behavior",
      "implementation_methods",
      "decision_record",
      "dosage",
      "fidelity_signals",
      "kill_criteria",
      "acceptance_criteria",
      "scope_boundaries",
      "research_basis",
      "quality_score",
      "design_intent",
      "concept_slug",
    ],
  },
};

const QUALITY_THRESHOLD = 0.6;

/** Clamp a raw quality axis to 0..1; default 0.7 when missing/invalid. */
function clampAxis(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(1, v))
    : 0.7;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strArr(v: unknown, max: number, maxLen: number): string[] {
  return Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, maxLen))
        .slice(0, max)
    : [];
}

/** Parse one raw LLM payload into a MechanismSpec. Returns null when
 *  the load-bearing mechanism_of_action is missing. */
function parseSpec(
  raw: Record<string, unknown>,
  mode: UseCaseMode,
): MechanismSpec | null {
  const mechanism_of_action = str(raw?.mechanism_of_action, 900);
  if (!mechanism_of_action) return null;

  const h = (raw?.mechanism_hypothesis as Record<string, unknown>) ?? {};
  const mechanism_hypothesis: MechanismHypothesis = {
    if_do: str(h.if_do, 280),
    then_improves: str(h.then_improves, 280),
    because: str(h.because, 360),
  };

  const input_data = strArr(raw?.input_data, 8, 120);

  const active_ingredients: MechanismActiveIngredient[] = [];
  for (const a of (raw?.active_ingredients as Array<Record<string, unknown>>) ?? []) {
    const name = str(a?.name, 90);
    const role = str(a?.role, 240);
    if (!name || !role) continue;
    active_ingredients.push({ name, role });
    if (active_ingredients.length >= 6) break;
  }

  const how_it_works = strArr(raw?.how_it_works, 8, 200);

  const VISUAL_INTENT_ALLOWED = new Set([
    "screen",
    "notification",
    "ambient",
    "physical",
    "background",
  ]);
  const runtime_flow: MechanismRuntimeStep[] = [];
  for (const r of (raw?.runtime_flow as Array<Record<string, unknown>>) ?? []) {
    const step = str(r?.step, 200);
    if (!step) continue;
    const user_sees = str(r?.user_sees, 160) || "—";
    const isInternal = user_sees === "—";

    // visual_intent — clamp to enum, force null when the step is
    // purely internal (matches the schema's intent + the parseSpec
    // contract: internal steps don't have a visual surface).
    const rawVi =
      typeof r?.visual_intent === "string" ? r.visual_intent : "";
    const visual_intent: MechanismRuntimeStep["visual_intent"] = isInternal
      ? null
      : VISUAL_INTENT_ALLOWED.has(rawVi)
        ? (rawVi as NonNullable<MechanismRuntimeStep["visual_intent"]>)
        : null;

    // interaction_sketch — null when internal; trimmed + capped.
    const rawSketch = str(r?.interaction_sketch, 280);
    const interaction_sketch: string | null = isInternal
      ? null
      : rawSketch.length > 0
        ? rawSketch
        : null;

    runtime_flow.push({
      step,
      component: str(r?.component, 90) || "—",
      data: str(r?.data, 160) || "—",
      user_sees,
      produces: strArr(r?.produces, 8, 40),
      consumes: strArr(r?.consumes, 8, 40),
      visual_intent,
      interaction_sketch,
    });
    if (runtime_flow.length >= 9) break;
  }

  const system_components: MechanismComponent[] = [];
  for (const c of (raw?.system_components as Array<Record<string, unknown>>) ?? []) {
    const name = str(c?.name, 90);
    const detail = str(c?.detail, 240);
    if (!name || !detail) continue;
    system_components.push({
      name,
      category: str(c?.category, 40) || "component",
      detail,
    });
    if (system_components.length >= 6) break;
  }

  const user_visible_behavior = str(raw?.user_visible_behavior, 400);

  const implementation_methods: MechanismImplementationMethod[] = [];
  for (const m of (raw?.implementation_methods as Array<Record<string, unknown>>) ?? []) {
    const name = str(m?.name, 90);
    if (!name) continue;
    const difficulty =
      m?.difficulty === "low" || m?.difficulty === "high"
        ? m.difficulty
        : "medium";
    const decision =
      m?.decision === "use" || m?.decision === "reject"
        ? m.decision
        : "test_later";
    implementation_methods.push({
      name,
      how: str(m?.how, 200),
      required_data: str(m?.required_data, 160),
      strength: str(m?.strength, 160),
      weakness: str(m?.weakness, 160),
      risk: str(m?.risk, 160),
      difficulty: difficulty as MechanismImplementationMethod["difficulty"],
      decision: decision as MechanismImplementationMethod["decision"],
    });
    if (implementation_methods.length >= 5) break;
  }

  const dr = (raw?.decision_record as Record<string, unknown>) ?? {};
  const alternatives_rejected: Array<{ name: string; why_not: string }> = [];
  for (const a of (dr.alternatives_rejected as Array<Record<string, unknown>>) ?? []) {
    const name = str(a?.name, 90);
    const why_not = str(a?.why_not, 240);
    if (!name) continue;
    alternatives_rejected.push({ name, why_not });
    if (alternatives_rejected.length >= 5) break;
  }
  const decision_record: MechanismDecisionRecord = {
    chosen: str(dr.chosen, 160),
    rationale: str(dr.rationale, 400),
    alternatives_rejected,
    consequences: str(dr.consequences, 400),
  };

  const dosageRaw = str(raw?.dosage, 200);
  const dosage =
    dosageRaw && !/^(null|none|n\/a|na)$/i.test(dosageRaw) ? dosageRaw : null;

  const fidelity_signals = strArr(raw?.fidelity_signals, 4, 200);
  const kill_criteria = strArr(raw?.kill_criteria, 4, 200);
  const acceptance_criteria = strArr(raw?.acceptance_criteria, 5, 240);
  const scope_boundaries = strArr(raw?.scope_boundaries, 5, 240);

  const rb = (raw?.research_basis as Record<string, unknown>) ?? {};
  const evidence_strength: MechanismResearchBasis["evidence_strength"] =
    rb.evidence_strength === "established" ||
    rb.evidence_strength === "speculative"
      ? rb.evidence_strength
      : "plausible";
  const research_basis: MechanismResearchBasis = {
    evidence_strength,
    basis: str(rb.basis, 500),
    validation_experiment: str(rb.validation_experiment, 500),
  };

  const qs = (raw?.quality_score as Record<string, unknown>) ?? {};
  const quality_score: MechanismQualityScore = {
    specificity: clampAxis(qs.specificity),
    technical_depth: clampAxis(qs.technical_depth),
    measurability: clampAxis(qs.measurability),
    ui_connection: clampAxis(qs.ui_connection),
    feasibility: clampAxis(qs.feasibility),
    failure_mode_clarity: clampAxis(qs.failure_mode_clarity),
  };

  // ── design_intent — clamp each enum, fall back to a neutral
  // mid-density / card / breathing / flow block when the LLM
  // omitted or mis-emitted the field. Strict mode means a fresh
  // generation always has it; the defaults only kick in for old
  // stored rows replayed through parseSpec (rare).
  const di = (raw?.design_intent as Record<string, unknown>) ?? {};
  const GLASS_TIER_ALLOWED = new Set(["plate", "card", "float", "hero"]);
  const ACCENT_INTENT_ALLOWED = new Set([
    "signal",
    "warning",
    "growth",
    "insight",
    "neutral",
  ]);
  const DENSITY_ALLOWED = new Set(["airy", "comfortable", "dense"]);
  const MOTION_INTENT_ALLOWED = new Set([
    "still",
    "breathing",
    "reveal",
    "responsive",
  ]);
  const HERO_PATTERN_ALLOWED = new Set([
    "metric",
    "flow",
    "cycle",
    "before_after",
    "evidence",
    "decision",
  ]);

  const rawGT = typeof di.glass_tier === "string" ? di.glass_tier : "";
  const rawAI = typeof di.accent_intent === "string" ? di.accent_intent : "";
  const rawDen = typeof di.density === "string" ? di.density : "";
  const rawMI = typeof di.motion_intent === "string" ? di.motion_intent : "";
  const rawHP = typeof di.hero_pattern === "string" ? di.hero_pattern : "";

  const design_intent: MechanismDesignIntent = {
    glass_tier: GLASS_TIER_ALLOWED.has(rawGT)
      ? (rawGT as MechanismDesignIntent["glass_tier"])
      : "card",
    accent_intent: ACCENT_INTENT_ALLOWED.has(rawAI)
      ? (rawAI as MechanismDesignIntent["accent_intent"])
      : "neutral",
    density: DENSITY_ALLOWED.has(rawDen)
      ? (rawDen as MechanismDesignIntent["density"])
      : "comfortable",
    motion_intent: MOTION_INTENT_ALLOWED.has(rawMI)
      ? (rawMI as MechanismDesignIntent["motion_intent"])
      : "breathing",
    hero_pattern: HERO_PATTERN_ALLOWED.has(rawHP)
      ? (rawHP as MechanismDesignIntent["hero_pattern"])
      : "flow",
    reduction_log: strArr(di.reduction_log, 6, 240),
  };

  // ── concept_slug — reserved stub. Generator emits null today;
  // tolerate any prior populated value if a parallel session ever
  // wrote one (forward-compat).
  const rawSlug = str(raw?.concept_slug, 80);
  const concept_slug: string | null = rawSlug.length > 0 ? rawSlug : null;

  return {
    mechanism_of_action,
    mechanism_hypothesis,
    input_data,
    active_ingredients,
    how_it_works,
    runtime_flow,
    system_components,
    user_visible_behavior,
    implementation_methods,
    decision_record,
    dosage,
    fidelity_signals,
    kill_criteria,
    acceptance_criteria,
    scope_boundaries,
    research_basis,
    quality_score,
    use_case_mode: mode,
    generated_at: new Date().toISOString(),
    evaluation_method: "rubric",
    design_intent,
    concept_slug,
  };
}

/** Single-feature mechanism spec (v2). Soft-fails on LLM error.
 *
 *  Quality gate: the LLM self-scores 6 axes; if any axis lands below
 *  QUALITY_THRESHOLD, the spec is "still vague" so we regenerate ONCE
 *  with the weak axes named, then keep whichever draft scores higher.
 *  Mirrors enrichChain()'s soft-fail contract. */
export async function enrichMechanismSpec(
  ctx: EnrichMechanismSpecInput,
): Promise<MechanismSpec | null> {
  const mode = resolveUseCaseMode(ctx.constraints);
  const userPrompt = buildUserPrompt(ctx, mode);

  // Load the UI design skill pack as a system-prompt PREFIX. Stable
  // across calls + cached at module scope, so it forms an
  // identical-prefix message that OpenAI's automatic prompt cache
  // can hit on repeated generations within the cache window. Empty
  // string when the pack is missing — generator degrades cleanly.
  const uiSkillPrefix = await loadUiSkillSystem();

  // v3 — data unit registry context. Goes in the USER prompt (not
  // system) because it's per-space data; the SYSTEM_PROMPT stays
  // byte-identical across calls so the prefix cache still hits.
  // Empty string when registry isn't provided OR is empty — the LLM
  // falls back to free-text token emission with no behavior change.
  const registryPrefix = ctx.registry
    ? buildRegistryPromptContext(ctx.registry)
    : "";
  const userPromptWithRegistry = registryPrefix
    ? `${registryPrefix}\n${userPrompt}`
    : userPrompt;

  async function attempt(systemSuffix: string): Promise<MechanismSpec | null> {
    let raw: Record<string, unknown>;
    try {
      raw = await llmJSON({
        // Order matters for prefix-cache hits: STABLE prefix first
        // (skill + base prompt), VARYING suffix last (weak-axes
        // regenerate message on the retry path).
        system: uiSkillPrefix + SYSTEM_PROMPT + systemSuffix,
        user: userPromptWithRegistry,
        responseSchema: SPEC_SCHEMA,
        temperature: 0.3,
        maxTokens: 3800,
      });
    } catch (err) {
      console.warn(
        "[enrich-mechanism-spec] LLM failed (soft-fail):",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    return parseSpec(raw, mode);
  }

  const first = await attempt("");
  if (!first) return null;

  // Cooperation Plan v2 Fix E — specificity floor. When a strongly-
  // scored variation underlies the spec, the spec's specificity axis
  // self-score is at least the rubric composite. Prevents the perverse
  // "better rubric grading → same retry behavior" outcome (Finding X2):
  // a clearly-plausible variation (composite 0.85) producing a spec
  // whose self-graded specificity is 0.55 shouldn't trigger a retry
  // just because the spec author was modest. Only LIFTS specificity in
  // the retry decision; the persisted quality_score is unchanged
  // (consumers see the LLM's honest self-grade).
  const effectiveMinQuality = (s: MechanismSpec): number => {
    const axes = { ...s.quality_score };
    if (typeof ctx.top_variation_score === "number") {
      axes.specificity = Math.max(axes.specificity, ctx.top_variation_score);
    }
    return Math.min(...Object.values(axes));
  };

  if (effectiveMinQuality(first) >= QUALITY_THRESHOLD) return first;

  // Cooperation Plan v2 Fix E — retry guard. When the caller says
  // accept_on_first_attempt (e.g. top_variation_score < 0.4: the
  // underlying mechanism is weak, retrying can't fix that — see Q4 in
  // AUTOPILOT_COOPERATION_PLAN.md §8), persist the first attempt with
  // a calibrated_uncertainty marker rather than burning budget on a
  // retry that will produce a similarly hedged spec. The scoreBlock in
  // buildUserPrompt has already instructed the LLM to be honestly
  // exploratory in this case, so the first attempt is the right tone.
  if (ctx.accept_on_first_attempt === true) {
    return {
      ...first,
      quality_calibrated_uncertainty: true,
    } as MechanismSpec & { quality_calibrated_uncertainty: true };
  }

  // Weak — regenerate once, naming the axes that fell short.
  const weak = (
    Object.entries(first.quality_score) as Array<[string, number]>
  )
    .filter(([, v]) => v < QUALITY_THRESHOLD)
    .map(([k]) => k);
  const suffix = `\n\nYOUR PREVIOUS DRAFT SCORED LOW ON: ${weak.join(", ")}. That means it is STILL TOO VAGUE on those axes. Regenerate the FULL spec, materially stronger on exactly those axes (more specific, more buildable, more measurable, better connected to user-visible behavior, more feasible, or clearer failure modes — as applicable). Earn the score; do not inflate it.`;
  const retry = await attempt(suffix);
  // Keep the stronger draft (prefer the retry on ties). Uses the
  // specificity-floored comparator so a high-composite variation
  // doesn't inadvertently pick a worse retry just because the retry's
  // raw self-grade dipped.
  const chosen: MechanismSpec = !retry
    ? first
    : effectiveMinQuality(retry) >= effectiveMinQuality(first)
      ? retry
      : first;

  // v3 — Claude design refinement pass. The mechanism spec itself
  // came from OpenAI gpt-4o (because llmJSON requires strict mode,
  // which Anthropic doesn't reliably support yet). For the
  // design_intent block specifically — which is the load-bearing UI
  // direction the brief renders — Anthropic's Claude has stronger
  // alignment with the `UI agent /` skill pack (which is itself an
  // Anthropic-format skill). Refine the design_intent through Claude
  // Sonnet (cheaper than Opus, sufficient for enum picks +
  // reduction_log prose). Soft-fail: if Claude is unavailable, the
  // env flag is off, or the response is unparseable, keep the
  // OpenAI design_intent unchanged.
  //
  // Opt out: set USE_CLAUDE_DESIGN=false (any non-empty value other
  // than "true" / "1" disables). Default: enabled.
  const useClaudeDesign =
    (process.env.USE_CLAUDE_DESIGN ?? "true").toLowerCase() !== "false" &&
    process.env.USE_CLAUDE_DESIGN !== "0";
  let finalSpec = chosen;
  if (useClaudeDesign && chosen.design_intent) {
    const refined = await refineDesignIntentWithClaude(
      chosen,
      uiSkillPrefix,
    );
    if (refined) {
      finalSpec = { ...chosen, design_intent: refined };
    }
  }

  // v3 — Claude design artifact composition (Gap 4 from the
  // session). After design_intent is refined, ask Claude to compose
  // the FULL designed artifact — 2-5 sections (hero + moments +
  // flow + stats + callouts + before/after) with headline copy
  // Claude wrote for THIS mechanism specifically. Renders as a
  // premium poster via `mechanism-design-artifact-view.tsx`.
  //
  // Done as a STRUCTURED artifact (not raw JSX strings) to avoid
  // sandbox/XSS risk while still giving Claude compositional
  // control: section order, headline copy, micro-copy, layout
  // primitive per section, tone per callout.
  //
  // Opt out via env `USE_CLAUDE_DESIGN_ARTIFACT=false`. Default
  // enabled. Falls back to a minimal derived artifact when Claude
  // is unavailable / disabled — never leaves the field null when
  // there's a design_intent to work with.
  const useArtifact =
    (process.env.USE_CLAUDE_DESIGN_ARTIFACT ?? "true").toLowerCase() !== "false" &&
    process.env.USE_CLAUDE_DESIGN_ARTIFACT !== "0";
  if (finalSpec.design_intent) {
    let artifact: DesignArtifact | null = null;
    if (useArtifact) {
      artifact = await composeDesignArtifactWithClaude(
        finalSpec,
        uiSkillPrefix,
      );
    }
    if (!artifact) {
      // Cheap derived fallback so the renderer always has something
      // when design_intent is present (even with Claude disabled).
      artifact = fallbackDesignArtifactFromSpec(finalSpec);
    }
    finalSpec = { ...finalSpec, design_artifact: artifact };
  }

  return finalSpec;
}

// ─── Claude design_intent refinement (v3, Anthropic-side) ────────

const CLAUDE_DESIGN_REFINER_MODEL = BEST_FAST_CLAUDE_MODEL;

/** Build the refiner prompt — a focused critique-and-rewrite pass
 *  over the OpenAI draft. Claude reads the mechanism's behavioral
 *  context + the UI skill pack and decides whether to keep or
 *  rewrite the design_intent. */
function buildClaudeDesignPrompt(spec: MechanismSpec): {
  system: string;
  user: string;
} {
  const di = spec.design_intent!;
  const visibleSteps = (spec.runtime_flow ?? [])
    .filter((s) => !!s.user_sees && s.user_sees !== "—")
    .slice(0, 6)
    .map(
      (s, i) =>
        `  ${i + 1}. ${s.step} → user sees: ${s.user_sees}${s.visual_intent ? ` [surface: ${s.visual_intent}]` : ""}${s.interaction_sketch ? `\n     sketch: ${s.interaction_sketch}` : ""}`,
    )
    .join("\n");

  const system = `You are a senior UI/UX design lead. The UI skill pack above is your operating manual — apply its cognitive-load + MoSCoW reduction discipline strictly.

You will be given a MECHANISM (the executable behavior) and a DRAFT design_intent (written by a different model). Decide whether the draft is right, and if not, rewrite the design_intent to be MORE COHERENT with the mechanism's actual nature.

Coherence checks to enforce:
  • A mechanism that runs silently in the background should NOT pick "responsive" motion or "dense" density.
  • A mechanism that grounds a claim in evidence should usually pick "evidence" hero_pattern + "insight" or "neutral" accent.
  • A mechanism that moves a measurable metric naturally fits "metric" hero_pattern.
  • A mechanism with a feedback-loop runtime_flow naturally fits "cycle" hero_pattern.
  • A mechanism that branches based on a decision should pick "decision" hero_pattern.
  • "Hero" glass_tier is reserved for showstopper moments — most mechanisms should pick "card" (default).
  • Reduction_log MUST cite 2-4 concrete kept/dropped choices with one-line rationale each (MoSCoW: "Kept X — because Y" / "Dropped A — because B"). Not generic.

Return STRICT JSON matching exactly this shape (no markdown, no prose, no code fences):
{
  "glass_tier": "plate" | "card" | "float" | "hero",
  "accent_intent": "signal" | "warning" | "growth" | "insight" | "neutral",
  "density": "airy" | "comfortable" | "dense",
  "motion_intent": "still" | "breathing" | "reveal" | "responsive",
  "hero_pattern": "metric" | "flow" | "cycle" | "before_after" | "evidence" | "decision",
  "reduction_log": ["…", "…"]
}`;

  const user = `MECHANISM: ${spec.mechanism_of_action.slice(0, 600)}

USER-VISIBLE BEHAVIOR: ${spec.user_visible_behavior ?? "(none specified)"}

RUNTIME FLOW (user-visible steps only):
${visibleSteps || "  (no user-visible steps — purely internal)"}

EVIDENCE STRENGTH: ${spec.research_basis.evidence_strength}

DRAFT design_intent (from an earlier model — refine or replace):
  glass_tier: ${di.glass_tier}
  accent_intent: ${di.accent_intent}
  density: ${di.density}
  motion_intent: ${di.motion_intent}
  hero_pattern: ${di.hero_pattern}
  reduction_log:
${(di.reduction_log ?? []).map((r) => `    - ${r}`).join("\n") || "    (empty)"}

Return the refined design_intent as strict JSON. If the draft is already coherent, you may return it unchanged — but the reduction_log MUST be specific to THIS mechanism, never generic.`;

  return { system, user };
}

/** Parse Claude's JSON output. Tolerates leading/trailing whitespace
 *  and optional ``` fences (Claude sometimes adds them despite
 *  instruction). Returns null on any parse / shape failure. */
function parseClaudeDesignIntent(raw: string): MechanismDesignIntent | null {
  let text = raw.trim();
  // Strip code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const GT = new Set(["plate", "card", "float", "hero"]);
    const AI = new Set(["signal", "warning", "growth", "insight", "neutral"]);
    const DEN = new Set(["airy", "comfortable", "dense"]);
    const MI = new Set(["still", "breathing", "reveal", "responsive"]);
    const HP = new Set([
      "metric",
      "flow",
      "cycle",
      "before_after",
      "evidence",
      "decision",
    ]);
    const gt = typeof obj.glass_tier === "string" ? obj.glass_tier : "";
    const ai = typeof obj.accent_intent === "string" ? obj.accent_intent : "";
    const den = typeof obj.density === "string" ? obj.density : "";
    const mi = typeof obj.motion_intent === "string" ? obj.motion_intent : "";
    const hp = typeof obj.hero_pattern === "string" ? obj.hero_pattern : "";
    if (!GT.has(gt) || !AI.has(ai) || !DEN.has(den) || !MI.has(mi) || !HP.has(hp)) {
      return null;
    }
    const reduction_log = Array.isArray(obj.reduction_log)
      ? (obj.reduction_log as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 240))
          .slice(0, 6)
      : [];
    if (reduction_log.length === 0) return null; // require real notes
    return {
      glass_tier: gt as MechanismDesignIntent["glass_tier"],
      accent_intent: ai as MechanismDesignIntent["accent_intent"],
      density: den as MechanismDesignIntent["density"],
      motion_intent: mi as MechanismDesignIntent["motion_intent"],
      hero_pattern: hp as MechanismDesignIntent["hero_pattern"],
      reduction_log,
    };
  } catch {
    return null;
  }
}

/** Run the Claude refinement pass. Returns the refined design_intent
 *  or null on any failure (caller keeps the OpenAI draft). Soft-fail
 *  by design — design refinement is enrichment, never a blocker. */
async function refineDesignIntentWithClaude(
  spec: MechanismSpec,
  uiSkillPrefix: string,
): Promise<MechanismDesignIntent | null> {
  try {
    const { system, user } = buildClaudeDesignPrompt(spec);
    const raw = await llmGenerate({
      provider: "anthropic",
      model: CLAUDE_DESIGN_REFINER_MODEL,
      // Prepend the cached UI skill pack — Anthropic auto-prefix-caches
      // identical leading content within the cache window. Empty
      // string when the pack is missing (degrades to skill-less
      // refinement, still valuable).
      system: uiSkillPrefix + system,
      user,
      temperature: 0.4,
      maxTokens: 600,
    });
    return parseClaudeDesignIntent(raw);
  } catch (err) {
    // Anthropic quota / network / parsing failure — silent fall-through
    // is correct here; the OpenAI design_intent draft remains in place.
    console.warn(
      "[enrich-mechanism-spec] Claude design refinement failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
