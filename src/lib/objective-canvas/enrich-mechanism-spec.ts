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

import { llmJSON } from "@/lib/llm";
import {
  buildConstraintsBlock,
  resolveUseCaseMode,
  type OperationalConstraints,
  type UseCaseMode,
} from "./constraints";

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

6. runtime_flow (4-8 rows) — the EXECUTABLE sequence. Each row: { step (what happens), component (which component does it), data (data in → out, or "—"), user_sees (the user-visible effect at this step, or "—" if internal) }. This is the engineering spine — be concrete about which component touches which data.

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
   • ui_connection — does it connect to actual user-visible UI/behavior?
   • feasibility — is it buildable under the constraints?
   • failure_mode_clarity — are the failure modes named clearly?
   Score honestly — a low score is a useful signal, not a failure. Do NOT inflate.

16. acceptance_criteria (2-5) — testable "done / working" conditions an engineer or coding agent can build against. Observable + checkable ("a returning user sees their top-3 ranked items in <200ms", "completing a task increments the streak exactly once"). Definition of DONE — not whether the theory holds (that's validation_experiment).

17. scope_boundaries (2-5) — what this mechanism explicitly does NOT do, to stop scope creep ("does not handle multi-user shared streaks", "no offline mode in v1"). Concrete non-goals, not vague disclaimers.

Rules:
- EVERY field references something specific from the feature, its elected direction, the room's pains/root_causes, or the outcomes/indicators. Generic filler is forbidden.
- If the user ELECTED a variation, spec THAT chosen direction concretely.
- Respect the operational constraints. A spec the user can't build is wasted.
- Be honest about evidence_strength + quality_score.

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

[FEATURE / MECHANISM] ${ctx.feature.name}${positive}${fp}${def}${electedBlock}${painsBlock}${outcomesBlock}${chainBlock}
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
          },
          required: ["step", "component", "data", "user_sees"],
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

  const runtime_flow: MechanismRuntimeStep[] = [];
  for (const r of (raw?.runtime_flow as Array<Record<string, unknown>>) ?? []) {
    const step = str(r?.step, 200);
    if (!step) continue;
    runtime_flow.push({
      step,
      component: str(r?.component, 90) || "—",
      data: str(r?.data, 160) || "—",
      user_sees: str(r?.user_sees, 160) || "—",
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
  };
}

/** Lowest of the 6 quality axes. */
function minQuality(s: MechanismSpec): number {
  return Math.min(...Object.values(s.quality_score));
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

  async function attempt(systemSuffix: string): Promise<MechanismSpec | null> {
    let raw: Record<string, unknown>;
    try {
      raw = await llmJSON({
        system: SYSTEM_PROMPT + systemSuffix,
        user: userPrompt,
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
  if (minQuality(first) >= QUALITY_THRESHOLD) return first;

  // Weak — regenerate once, naming the axes that fell short.
  const weak = (
    Object.entries(first.quality_score) as Array<[string, number]>
  )
    .filter(([, v]) => v < QUALITY_THRESHOLD)
    .map(([k]) => k);
  const suffix = `\n\nYOUR PREVIOUS DRAFT SCORED LOW ON: ${weak.join(", ")}. That means it is STILL TOO VAGUE on those axes. Regenerate the FULL spec, materially stronger on exactly those axes (more specific, more buildable, more measurable, better connected to user-visible behavior, more feasible, or clearer failure modes — as applicable). Earn the score; do not inflate it.`;
  const retry = await attempt(suffix);
  if (!retry) return first;
  // Keep the stronger draft (prefer the retry on ties).
  return minQuality(retry) >= minQuality(first) ? retry : first;
}
