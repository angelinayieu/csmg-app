// ── Per-app sub-strategy LLM prompt (Tier 3) ───────────────────────────
//
// Generates a focused refinement of one global-strategy
// `infrastructure_proposal` — the spec the app actually needs to do
// real work (predict, validate, simulate, refine agents, learn).
//
// Why a separate prompt vs. extending the global strategy prompt:
//   - Different scope: this prompt only sees ONE proposal, not the whole
//     KG + synthesis + axioms + intersections. ~1/3 the input tokens.
//   - Different output: ~6 typed sections instead of the global
//     strategy's 5 macro parts + perspectives + tactics + learning loop
//     + pre-mortem + strategy_layers.
//   - Different cadence: regen on deviation triggers, not on every
//     strategy refresh — needs to be fast + cheap.
//
// Token budget target: ~3-5K input tokens, ~2-4K output tokens. Roughly
// 1 LLM call ≈ 1/8 the cost of a global strategy generation.

import type { App } from "@/types/app";
import type { InfrastructureProposal, AgentSpec, MechanismHint } from "@/types/strategy";
import type { Prediction } from "@/types/prediction";

export interface AppStrategyPromptArgs {
  app: App;
  /** The parent global strategy's proposal that birthed this app. May be null
   *  for legacy apps generated before the proposal_id was tracked. */
  parentProposal: InfrastructureProposal | null;
  /** Title of the parent global strategy — gives the LLM macro context. */
  parentStrategyTitle?: string | null;
  /** Top-line summary of the parent strategy (recommendation.summary). */
  parentStrategySummary?: string | null;
  /** AgentSpec[] from the parent proposal — what agents this app should
   *  refine, not invent fresh. */
  parentAgentSpecs?: AgentSpec[];
  /** Recent resolved predictions for THIS app — fuel for the deviation_history
   *  section + regen rationale. Pass empty when generating a first-time
   *  sub-strategy with no prediction history yet. */
  recentPredictions?: Prediction[];
  /** Open predictions (not yet resolved) — context for what's already
   *  being tracked. */
  openPredictions?: Prediction[];
  /** Free-form trigger reason from the caller. Examples:
   *    "User clicked Generate"
   *    "Deviation surprise on metric Y triggered regen"
   *    "Initial sub-strategy at app creation" */
  triggerReason: string;
  /** When non-null, the LLM is instructed to narrow OR re-scope the
   *  focused_objective in response to the deviation pattern. */
  deviationFocusHint?: string | null;
}

export function getAppStrategyPrompt(args: AppStrategyPromptArgs): {
  system: string;
  user: string;
} {
  const {
    app,
    parentProposal,
    parentStrategyTitle,
    parentStrategySummary,
    parentAgentSpecs = [],
    recentPredictions = [],
    openPredictions = [],
    triggerReason,
    deviationFocusHint,
  } = args;

  const mechanismHints: MechanismHint[] = parentProposal?.mechanism_hints ?? [];

  // ── System: scope + structure + rules ─────────────────────────────
  const system = `You are an app-strategy refiner. The global strategy already decided WHAT app to build; your job is to specify HOW this app actually works.

The output is a structured spec the app's agents read at runtime — predictor agents read prediction_spec to know what to forecast, validator agents read validation_spec to pull hypotheses, simulator agents read simulation_spec for default scenarios.

YOU ARE NOT writing a new strategy. You are EXPANDING ONE proposal from the existing strategy into actionable specs for one specific app.

OUTPUT SECTIONS (all required unless flagged optional):

1. focused_objective — one metric this app drives. Narrower than the parent goal.
2. prediction_spec — what to forecast, at what horizons, with what confidence baseline.
3. validation_spec — hypothesis bank the validator agent draws from.
4. simulation_spec — default perturbation profiles for the simulation_lab.
5. agent_role_refinements (optional) — overrides to parent agent_specs for this app.
6. learning_loop — leading indicators + pivot criteria specific to this app.
7. mechanism_hints_covered — echo back which parent hints this spec addresses.
8. rationale — 2-3 sentences: how this connects to the parent + what's app-specific.

SCOPE RULES:
- focused_objective.metric MUST be either the parent objective metric verbatim OR a documented narrowing (e.g. parent "reduce churn" → app "reduce churn for users in trial week 2"). Do NOT invent unrelated objectives.
- prediction_spec.metrics_to_track entries should match metric labels the app's surfaced_metrics already includes when possible. New metrics are allowed but require explicit rationale.
- validation_spec.hypothesis_bank must contain 2-5 falsifiable claims, each with a metric + horizon. Vague hypotheses ("improve engagement") are rejected.
- simulation_spec.perturbation_profiles should reflect this app's domain — e.g. a churn-tracking app simulates retention shifts, not user-acquisition shifts.
- agent_role_refinements is OPTIONAL — only include when you have a real refinement (different cadence, narrower responsibility, additional collaborator). Empty object is fine.
- learning_loop.leading_indicators must reference metric labels that the app actually surfaces or could surface from its bindings.

QUALITY GATES (the validator will reject the spec if any fail):
- Every section's rationale field MUST be non-empty.
- prediction_spec.default_horizon_days must be in [1, 365].
- prediction_spec.default_confidence must be in [0, 1].
- validation_spec.hypothesis_bank must have at least 1 entry (or set is_complete=false in quality and explain why).
- simulation_spec.perturbation_profiles must have at least 1 entry when "simulation" is in mechanism_hints_covered.

DEVIATION-DRIVEN REGEN:
${deviationFocusHint ? `IMPORTANT — this regen was triggered by a deviation surprise. The focused_objective should INCORPORATE the deviation insight: ${deviationFocusHint}\nAdjust prediction_spec.deviation_thresholds if the surprise reveals the previous thresholds were too tight. Add a hypothesis to validation_spec.hypothesis_bank that tests the new pattern.` : "This is a fresh generation, not deviation-driven. Skip the deviation_history section unless past predictions provide useful calibration context."}

Return ONLY valid JSON matching the schema below. No prose outside the JSON.

SCHEMA:
{
  "focused_objective": {
    "metric": "string — narrower than parent or same",
    "baseline": "string|number|null",
    "target": "string|number|null",
    "unit": "string (optional)",
    "horizon_days": number,
    "rationale": "string — 1-2 sentences why this scope"
  },
  "prediction_spec": {
    "metrics_to_track": [
      {
        "label": "string — matches app.config.surfaced_metrics when possible",
        "tracker_id": "string (optional, FK to metric_trackers)",
        "unit": "string (optional)",
        "horizon_days": number (optional, defaults to default_horizon_days),
        "rationale": "string"
      }
    ],
    "default_horizon_days": number (1-365),
    "default_confidence": number (0-1),
    "deviation_thresholds": null OR {
      "expected_relative": number,
      "regime_shift_relative": number
    },
    "rationale": "string"
  },
  "validation_spec": {
    "hypothesis_bank": [
      {
        "id": "h1, h2, ...",
        "statement": "If we do X, then metric Y will Z within W days.",
        "metric_label": "string",
        "expected_direction": "increase | decrease | stable | either",
        "expected_magnitude": number (optional),
        "horizon_days": number,
        "rationale": "string"
      }
    ],
    "experiment_horizon_days": number,
    "success_criteria": ["string", "string", "string"],
    "rationale": "string"
  },
  "simulation_spec": {
    "perturbation_profiles": [
      {
        "id": "p1, p2, ...",
        "label": "string",
        "perturbations": [
          { "metric_label": "string", "delta_pct": number, "rationale": "string (optional)" }
        ],
        "purpose": "string"
      }
    ],
    "scenario_seeds": [
      { "id": "s1, s2, ...", "label": "string", "profile_id": "p1" }
    ],
    "rationale": "string"
  },
  "agent_role_refinements": {
    "agent_id_from_parent": {
      "responsibility": "string (optional override)",
      "measurement_spec": { "metric": "string", "cadence": "...", "compare_against": "..." } (optional),
      "add_collaborators": ["agent_id"] (optional),
      "rationale": "string"
    }
  },
  "learning_loop": {
    "leading_indicators": [
      {
        "metric_label": "string",
        "green_reading": "string",
        "yellow_reading": "string",
        "red_reading": "string",
        "cadence": "daily | weekly | biweekly | monthly"
      }
    ],
    "pivot_criteria": [
      {
        "signal": "string — observable condition",
        "response": "regenerate_substrategy | request_global_regen | archive_app | manual_review",
        "rationale": "string"
      }
    ],
    "review_cadence": "weekly | biweekly | monthly | on_deviation_only"
  },
  "mechanism_hints_covered": ["simulation", "prediction", ...],
  "rationale": "string — 2-3 sentences",

  "_quality": {
    "confidence": number (0-1, your honest self-assessment),
    "is_complete": boolean,
    "issues": [{ "severity": "warning|info", "field": "...", "message": "..." }]
  }
}`;

  // ── User: scoped context ──────────────────────────────────────────
  const parts: string[] = [];

  parts.push(`APP CONTEXT:
Name: ${app.name}
Type: ${app.app_type}
Status: ${app.status}
Tagline: ${app.config.tagline ?? "(none)"}
Rationale: ${app.config.rationale ?? "(none)"}
Surfaced metrics: ${(app.config.surfaced_metrics ?? []).map((m) => m.name).join(", ") || "(none)"}
Channels: ${(app.config.channels ?? []).map((c) => `${c.from}→${c.to}`).join(", ") || "(none)"}
Tags: ${(app.config.tags ?? []).join(", ") || "(none)"}`);

  if (parentProposal) {
    parts.push(`PARENT PROPOSAL (this app expands one of these):
ID: ${parentProposal.id}
Name: ${parentProposal.name}
Type: ${parentProposal.type}
Description: ${parentProposal.description}
Source perspective: ${parentProposal.source_perspective}
Source components: ${parentProposal.source_components.join(", ")}
Metrics tracked: ${parentProposal.metrics_tracked.join(", ")}
Mechanism hints: ${(parentProposal.mechanism_hints ?? []).join(", ") || "(none — sub-strategy can suggest some)"}
Complexity: ${parentProposal.complexity}`);
  } else {
    parts.push(`PARENT PROPOSAL: (none — this app was generated before proposal-tracking, infer scope from the app context)`);
  }

  if (parentStrategyTitle || parentStrategySummary) {
    parts.push(`PARENT STRATEGY (macro context — DO NOT replicate, just stay consistent with):
Title: ${parentStrategyTitle ?? "(unknown)"}
Summary: ${parentStrategySummary ?? "(unknown)"}`);
  }

  if (parentAgentSpecs.length > 0) {
    const agentLines = parentAgentSpecs.map((a) =>
      `  - ${a.id} (${a.role}): ${a.responsibility}` +
      (a.measurement_spec
        ? `\n      measurement: ${a.measurement_spec.metric} @ ${a.measurement_spec.cadence}, compare against ${a.measurement_spec.compare_against}`
        : "")
    );
    parts.push(`PARENT AGENT SPECS (refine these via agent_role_refinements; do NOT redefine wholesale):
${agentLines.join("\n")}`);
  }

  if (mechanismHints.length > 0) {
    parts.push(`MECHANISM HINTS (parent declared the app should support these — your spec MUST address each):
${mechanismHints.map((h) => `  - ${h}`).join("\n")}`);
  }

  if (openPredictions.length > 0) {
    const predLines = openPredictions.slice(0, 8).map((p) =>
      `  - ${p.metric_label}: predicted ${p.predicted_value ?? p.predicted_value_text ?? "?"} ` +
      `(horizon: ${new Date(p.horizon_at).toISOString().slice(0, 10)}, conf: ${p.confidence ?? "?"})`
    );
    parts.push(`OPEN PREDICTIONS for this app (already being tracked — sub-strategy can extend or narrow):
${predLines.join("\n")}`);
  }

  if (recentPredictions.length > 0) {
    const surprises = recentPredictions.filter(
      (p) => p.deviation_tag === "surprise" || p.deviation_tag === "regime_shift",
    );
    if (surprises.length > 0) {
      const lines = surprises.slice(0, 6).map((p) =>
        `  - [${p.deviation_tag}] ${p.metric_label}: predicted ${p.predicted_value}, actual ${p.resolved_actual} (${p.resolution_notes ?? "no notes"})`
      );
      parts.push(`RECENT DEVIATION SIGNALS (these surprises argue the prior sub-strategy was wrong about something):
${lines.join("\n")}`);
    }
    const expectedCount = recentPredictions.filter((p) => p.deviation_tag === "expected").length;
    if (expectedCount > 0) {
      parts.push(`CALIBRATION SIGNAL: ${expectedCount} recent predictions resolved as "expected" — the predictor agent's confidence baseline is roughly correct in this domain.`);
    }
  }

  parts.push(`TRIGGER REASON: ${triggerReason}`);
  if (deviationFocusHint) {
    parts.push(`DEVIATION FOCUS HINT (caller's instruction): ${deviationFocusHint}`);
  }

  parts.push(`Generate the sub-strategy as JSON matching the SCHEMA above. Include the _quality block with your honest confidence + any flagged issues.`);

  return { system, user: parts.join("\n\n") };
}
