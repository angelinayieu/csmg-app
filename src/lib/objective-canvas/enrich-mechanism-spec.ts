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

export interface MechanismSpec {
  /** The causal process — names the root cause engaged + indicator
   *  moved + the path between. ≤ ~700 chars. */
  mechanism_of_action: string;
  /** Smallest replicable components carrying the causal load (BCT).
   *  2-5 typical. */
  active_ingredients: MechanismActiveIngredient[];
  /** Ordered operational procedure — what actually happens. 3-7
   *  steps. */
  how_it_works: string[];
  /** Concrete parts to build / provision. Use-case adaptive. 2-6. */
  system_components: MechanismComponent[];
  /** Intensity × frequency × duration. Null when no meaningful
   *  cadence. */
  dosage: string | null;
  /** How you'd know the mechanism is being delivered correctly.
   *  2-4. */
  fidelity_signals: string[];
  /** Evidence + a concrete validation experiment. */
  research_basis: MechanismResearchBasis;
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

const SYSTEM_PROMPT = `You are a mechanism-design engineer. You turn a named feature/mechanism into a rigorous, replicable TECHNICAL SPEC — deep enough that a competent builder could implement it and a skeptic could test it. You are NOT writing marketing copy or restating the definition.

You will be told the USE-CASE so you use the right vocabulary (product feature vs clinical protocol vs experimental method). Adapt — the template is universal, the concretes are not.

Produce these fields:

1. mechanism_of_action (1 paragraph, ≤700 chars)
   The causal process. This is the load-bearing field. You MUST name:
     (a) WHICH root cause of the room's pain(s) the active ingredients engage,
     (b) WHICH outcome indicator(s) the mechanism moves, and
     (c) the directional path between them ("by X → which shifts Y → observably moving Z").
   When an indicator carries a BASELINE → TARGET gap, ground the path in closing THAT specific gap. Be mechanistic, not aspirational. If the honest answer is "the path is weak / indirect", say so.

2. active_ingredients (2-5)
   The SMALLEST replicable components that actually carry the causal load — the parts that, if removed, break the effect. Each: name (the component) + role (why it's load-bearing, one sentence). Do NOT list the whole feature as one ingredient; decompose it. Do NOT list decorative parts.

3. how_it_works (3-7 ordered steps)
   The operational procedure — what actually happens, in sequence, from trigger to effect. Concrete enough to follow. Each step ≤140 chars.

4. system_components (2-6)
   The concrete parts that must be built / provisioned for the mechanism to exist. Each: name + category (use the categories from the USE-CASE framing) + detail (what it is + the minimum it must do, one sentence).

5. dosage (string or null)
   Intensity × frequency × duration, per the USE-CASE framing. Null ONLY when the mechanism genuinely has no meaningful cadence.

6. fidelity_signals (2-4)
   How you'd know the mechanism is being DELIVERED as intended (not whether it worked — whether it actually RAN as specified). These separate "the theory was wrong" from "it was never properly done". Specific + observable. E.g. "user completes ≥3 intervals/day" not "user engages".

7. research_basis
   • evidence_strength — "established" (well-replicated causal support) / "plausible" (credible, partial/indirect support) / "speculative" (first-principles, untested here). Be honest — most novel mechanisms are "plausible" at best.
   • basis — what's actually known: the cited mechanism class or the first-principles argument (1-2 sentences).
   • validation_experiment — a concrete, runnable test to confirm THIS mechanism HERE, per the USE-CASE framing (1-2 sentences).

Rules:
- EVERY field must reference something specific from the feature, its elected direction, the room's pains/root_causes, or the outcomes/indicators. Generic spec filler is forbidden.
- If the user has ELECTED a variation, the spec describes THAT chosen direction concretely — not the generic feature.
- Respect the operational constraints (time / budget / team / risk / compliance). A spec the user can't build or run is wasted.
- Be honest about evidence_strength. Padding it is dishonest.

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

[FEATURE / MECHANISM] ${ctx.feature.name}${positive}${fp}${def}${electedBlock}${painsBlock}${outcomesBlock}
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
      dosage: { type: ["string", "null"] },
      fidelity_signals: {
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
    },
    required: [
      "mechanism_of_action",
      "active_ingredients",
      "how_it_works",
      "system_components",
      "dosage",
      "fidelity_signals",
      "research_basis",
    ],
  },
};

/** Single-feature mechanism spec. Soft-fails on LLM error — returns
 *  null so the caller can render "couldn't generate" without crashing
 *  the drawer. Mirrors enrichChain()'s contract. */
export async function enrichMechanismSpec(
  ctx: EnrichMechanismSpecInput,
): Promise<MechanismSpec | null> {
  const mode = resolveUseCaseMode(ctx.constraints);

  let raw: {
    mechanism_of_action?: unknown;
    active_ingredients?: Array<{ name?: unknown; role?: unknown }>;
    how_it_works?: unknown[];
    system_components?: Array<{
      name?: unknown;
      category?: unknown;
      detail?: unknown;
    }>;
    dosage?: unknown;
    fidelity_signals?: unknown[];
    research_basis?: {
      evidence_strength?: unknown;
      basis?: unknown;
      validation_experiment?: unknown;
    };
  };
  try {
    raw = await llmJSON({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(ctx, mode),
      responseSchema: SPEC_SCHEMA,
      temperature: 0.3,
      maxTokens: 2200,
    });
  } catch (err) {
    console.warn(
      "[enrich-mechanism-spec] LLM failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  // ── Clean + validate ──
  const mechanism_of_action =
    typeof raw?.mechanism_of_action === "string"
      ? raw.mechanism_of_action.trim().slice(0, 900)
      : "";
  if (!mechanism_of_action) return null;

  const active_ingredients: MechanismActiveIngredient[] = [];
  for (const a of raw?.active_ingredients ?? []) {
    const name = typeof a?.name === "string" ? a.name.trim().slice(0, 90) : "";
    const role = typeof a?.role === "string" ? a.role.trim().slice(0, 240) : "";
    if (!name || !role) continue;
    active_ingredients.push({ name, role });
    if (active_ingredients.length >= 6) break;
  }

  const how_it_works = Array.isArray(raw?.how_it_works)
    ? raw.how_it_works
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 200))
        .slice(0, 8)
    : [];

  const system_components: MechanismComponent[] = [];
  for (const c of raw?.system_components ?? []) {
    const name = typeof c?.name === "string" ? c.name.trim().slice(0, 90) : "";
    const category =
      typeof c?.category === "string" ? c.category.trim().slice(0, 40) : "";
    const detail =
      typeof c?.detail === "string" ? c.detail.trim().slice(0, 240) : "";
    if (!name || !detail) continue;
    system_components.push({
      name,
      category: category || "component",
      detail,
    });
    if (system_components.length >= 6) break;
  }

  const dosageRaw =
    typeof raw?.dosage === "string" ? raw.dosage.trim().slice(0, 200) : "";
  // Treat empty / "null" / "n/a" sentinel strings as genuinely null.
  const dosage =
    dosageRaw && !/^(null|none|n\/a|na)$/i.test(dosageRaw) ? dosageRaw : null;

  const fidelity_signals = Array.isArray(raw?.fidelity_signals)
    ? raw.fidelity_signals
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 200))
        .slice(0, 4)
    : [];

  const rb = raw?.research_basis ?? {};
  const evidence_strength: MechanismResearchBasis["evidence_strength"] =
    rb.evidence_strength === "established" ||
    rb.evidence_strength === "speculative"
      ? rb.evidence_strength
      : "plausible";
  const research_basis: MechanismResearchBasis = {
    evidence_strength,
    basis:
      typeof rb.basis === "string" ? rb.basis.trim().slice(0, 500) : "",
    validation_experiment:
      typeof rb.validation_experiment === "string"
        ? rb.validation_experiment.trim().slice(0, 500)
        : "",
  };

  return {
    mechanism_of_action,
    active_ingredients,
    how_it_works,
    system_components,
    dosage,
    fidelity_signals,
    research_basis,
    use_case_mode: mode,
    generated_at: new Date().toISOString(),
    evaluation_method: "rubric",
  };
}
