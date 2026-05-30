// ── Experience Brief Section Composer ─────────────────────────────
//
// Takes a `MechanismSpec` with v3 fields (`design_intent`,
// `runtime_flow.visual_intent`, `interaction_sketch`,
// `produces`/`consumes`, `reduction_log`) and produces a structured
// `ExperienceBriefSection` the parallel brief renderer can drop
// into `RoomBlock.mechanism_specs[]` or `AgentBuildSpec.features[]`.
//
// Today (verified via deep-read 2026-05-29) the brief consumes ~45%
// of MechanismSpec — most of the v3 fields I added in Step 2 are
// never read. This composer closes that gap WITHOUT modifying the
// parallel-owned brief files: when they're ready, they import this
// composer and drop one call in their feature-assembly loop.
//
// Output is structured + markdown — the brief panel renders the
// structured form, the markdown export uses the rendered form.
//
// Reference:
//   • INTAKE_TO_BRIEF_SURFACING_PLAN.md (where this fits)
//   • compile-agent-build-spec.ts:27-37 (AgentBuildFeature shape)
//   • strategy-brief-view.tsx:919-1055 (RoomBlock.mechanism_specs)
//   • MECHANISM_EXPERIENCE_SPEC.md §2 (the v3 fields)

import type {
  MechanismDesignIntent,
  MechanismRuntimeStep,
  MechanismSpec,
} from "./enrich-mechanism-spec";

// ─── Output shape ─────────────────────────────────────────────────

export interface ExperienceTouchpoint {
  step_index: number;
  /** machine kind for icon dispatch on the brief render side. */
  kind: NonNullable<MechanismRuntimeStep["visual_intent"]>;
  /** human label for the brief text. */
  label: string;
  user_sees: string;
}

export interface ExperienceInteractionBeat {
  step_index: number;
  sketch: string;
}

/** Summary of the data-token spine across a mechanism's runtime_flow.
 *  Tells the user (and the brief) how the mechanism handles data: do
 *  its steps share state internally, does it pull a lot from
 *  upstream, does it emit a lot for downstream features? */
export interface DataSpineSummary {
  /** Distinct token slugs across all steps' produces+consumes. */
  n_unique_tokens: number;
  /** Tokens this mechanism CONSUMES but never produces internally —
   *  they must come from upstream (input_data, other features, or
   *  the environment). These are the mechanism's dependencies. */
  n_input_tokens: number;
  /** Tokens this mechanism PRODUCES but no internal step consumes —
   *  they're emitted for downstream features / observers. */
  n_output_tokens: number;
  /** Tokens that are both produced AND consumed within this
   *  mechanism — purely internal state. */
  n_internal_tokens: number;
  /** Verbatim lists for the brief to render as chip clusters. Capped
   *  at 8 each to keep render compact. */
  input_token_slugs: string[];
  output_token_slugs: string[];
  internal_token_slugs: string[];
}

export interface ExperienceBriefSection {
  /** Machine slug — drives icon + grouping on the brief side. */
  hero_pattern: MechanismDesignIntent["hero_pattern"];
  /** Human caption — "transforms in a flow", "moves a metric", etc. */
  hero_pattern_caption: string;
  /** Machine slug. */
  accent_intent: MechanismDesignIntent["accent_intent"];
  /** Machine slug. */
  density: MechanismDesignIntent["density"];
  /** Machine slug. */
  motion_intent: MechanismDesignIntent["motion_intent"];
  /** A single-line summary the brief can render as the section
   *  headline: "Designed as a flow · airy density · breathing motion". */
  intent_summary: string;
  /** User-visible step touchpoints. */
  touchpoints: ExperienceTouchpoint[];
  /** Per-step interaction sketches in flow order. */
  interaction_beats: ExperienceInteractionBeat[];
  /** MoSCoW reduction log — honesty trace of what was kept / dropped. */
  reduction_log: string[];
  /** Data-token spine summary. */
  data_spine: DataSpineSummary;
}

// ─── Visual-intent label map ──────────────────────────────────────

const VISUAL_INTENT_LABEL: Record<
  NonNullable<MechanismRuntimeStep["visual_intent"]>,
  string
> = {
  screen: "Screen",
  notification: "Notification",
  ambient: "Ambient signal",
  physical: "Physical interaction",
  background: "Background process",
};

// ─── Caption helpers ──────────────────────────────────────────────

function captionHeroPattern(p: MechanismDesignIntent["hero_pattern"]): string {
  switch (p) {
    case "metric":       return "moves a metric";
    case "flow":         return "transforms in a flow";
    case "cycle":        return "establishes a feedback loop";
    case "before_after": return "changes a state";
    case "evidence":     return "grounds in evidence";
    case "decision":     return "branches by decision";
  }
}

function captionAccentIntent(a: MechanismDesignIntent["accent_intent"]): string {
  switch (a) {
    case "signal":  return "signal";
    case "warning": return "warning";
    case "growth":  return "growth";
    case "insight": return "insight";
    case "neutral": return "neutral";
  }
}

function captionDensity(d: MechanismDesignIntent["density"]): string {
  switch (d) {
    case "airy":        return "airy";
    case "comfortable": return "comfortable";
    case "dense":       return "dense";
  }
}

function captionMotion(m: MechanismDesignIntent["motion_intent"]): string {
  switch (m) {
    case "still":      return "still";
    case "breathing":  return "breathing";
    case "reveal":     return "reveal-on-mount";
    case "responsive": return "responsive-to-input";
  }
}

// ─── Token spine analysis ────────────────────────────────────────

function analyzeDataSpine(steps: ReadonlyArray<MechanismRuntimeStep>): DataSpineSummary {
  const allProduced = new Set<string>();
  const allConsumed = new Set<string>();
  for (const s of steps) {
    for (const t of s.produces ?? []) {
      const slug = t.trim();
      if (slug.length > 0) allProduced.add(slug);
    }
    for (const t of s.consumes ?? []) {
      const slug = t.trim();
      if (slug.length > 0) allConsumed.add(slug);
    }
  }
  const inputs: string[] = [];
  const outputs: string[] = [];
  const internal: string[] = [];
  const unique = new Set<string>([...allProduced, ...allConsumed]);
  for (const t of unique) {
    const isProduced = allProduced.has(t);
    const isConsumed = allConsumed.has(t);
    if (isConsumed && !isProduced) inputs.push(t);
    else if (isProduced && !isConsumed) outputs.push(t);
    else if (isProduced && isConsumed) internal.push(t);
  }
  inputs.sort();
  outputs.sort();
  internal.sort();
  return {
    n_unique_tokens: unique.size,
    n_input_tokens: inputs.length,
    n_output_tokens: outputs.length,
    n_internal_tokens: internal.length,
    input_token_slugs: inputs.slice(0, 8),
    output_token_slugs: outputs.slice(0, 8),
    internal_token_slugs: internal.slice(0, 8),
  };
}

// ─── Main composer ───────────────────────────────────────────────

/**
 * Compose an `ExperienceBriefSection` from a `MechanismSpec`.
 *
 * Returns `null` when the spec has no `design_intent` (pre-v3 spec).
 * The parallel brief composer should branch on null: if null, skip
 * the section; if non-null, render it under the mechanism's body.
 */
export function composeExperienceBriefSection(
  spec: MechanismSpec | null | undefined,
): ExperienceBriefSection | null {
  if (!spec || !spec.design_intent) return null;

  const di = spec.design_intent;
  const runtime = spec.runtime_flow ?? [];

  const touchpoints: ExperienceTouchpoint[] = [];
  const beats: ExperienceInteractionBeat[] = [];
  runtime.forEach((step, i) => {
    if (
      step.visual_intent != null &&
      step.user_sees &&
      step.user_sees !== "—"
    ) {
      touchpoints.push({
        step_index: i,
        kind: step.visual_intent,
        label: VISUAL_INTENT_LABEL[step.visual_intent],
        user_sees: step.user_sees,
      });
    }
    if (
      step.interaction_sketch &&
      step.interaction_sketch.trim().length > 0
    ) {
      beats.push({
        step_index: i,
        sketch: step.interaction_sketch.trim(),
      });
    }
  });

  const intentSummary = [
    `Designed as a ${captionHeroPattern(di.hero_pattern).replace(/^moves|^transforms|^establishes|^changes|^grounds|^branches/, (m) => m)}`,
    `${captionDensity(di.density)} density`,
    `${captionMotion(di.motion_intent)} motion`,
  ].join(" · ");

  return {
    hero_pattern: di.hero_pattern,
    hero_pattern_caption: captionHeroPattern(di.hero_pattern),
    accent_intent: di.accent_intent,
    density: di.density,
    motion_intent: di.motion_intent,
    intent_summary: intentSummary,
    touchpoints,
    interaction_beats: beats,
    reduction_log: (di.reduction_log ?? []).slice(0, 6),
    data_spine: analyzeDataSpine(runtime),
  };
}

// ─── Markdown renderer ───────────────────────────────────────────

/**
 * Render an `ExperienceBriefSection` as markdown for the strategy
 * brief's export path. Mirrors the existing markdown idiom in
 * `strategy-brief-view.tsx` (`##` for section, `**bold**` for keys,
 * `-` for bullets).
 *
 * Returns "" when section is null so the caller can splice it in
 * unconditionally.
 */
export function renderExperienceBriefSectionMarkdown(
  section: ExperienceBriefSection | null,
  opts?: { featureName?: string; mechanismName?: string },
): string {
  if (!section) return "";
  const heading = opts?.featureName
    ? `### Experience — ${opts.featureName}`
    : opts?.mechanismName
      ? `### Experience — ${opts.mechanismName}`
      : "### Experience";

  const lines: string[] = [heading, "", `_${section.intent_summary}_`, ""];

  if (section.touchpoints.length > 0) {
    lines.push("**Touchpoints**");
    for (const tp of section.touchpoints) {
      lines.push(`- ${tp.label}: ${tp.user_sees}`);
    }
    lines.push("");
  }

  if (section.interaction_beats.length > 0) {
    lines.push("**Interaction script**");
    section.interaction_beats.forEach((b, i) => {
      lines.push(`${i + 1}. ${b.sketch}`);
    });
    lines.push("");
  }

  if (section.data_spine.n_unique_tokens > 0) {
    lines.push("**Data spine**");
    lines.push(
      `- Inputs (${section.data_spine.n_input_tokens}): ${section.data_spine.input_token_slugs.join(", ") || "—"}`,
    );
    lines.push(
      `- Outputs (${section.data_spine.n_output_tokens}): ${section.data_spine.output_token_slugs.join(", ") || "—"}`,
    );
    lines.push(
      `- Internal (${section.data_spine.n_internal_tokens}): ${section.data_spine.internal_token_slugs.join(", ") || "—"}`,
    );
    lines.push("");
  }

  if (section.reduction_log.length > 0) {
    lines.push("**Design notes (MoSCoW)**");
    for (const item of section.reduction_log) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
