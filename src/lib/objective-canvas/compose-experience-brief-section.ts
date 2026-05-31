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

// ─── Room-level design language (cross-mechanism coherence) ─────
//
// The per-mechanism `design_intent` block (`ExperienceBriefSection`)
// captures ONE mechanism's UI direction. But a room is typically 3-5
// mechanisms that the user experiences as ONE coherent system. If
// every mechanism picks its design intent independently the result
// reads as "stitched modules" instead of a unified product.
//
// `composeRoomDesignLanguage` does cross-mechanism design aggregation:
//   • Finds the dominant value per axis (accent / glass_tier / density / motion)
//   • Scores harmony (% of mechanisms matching dominant, averaged)
//   • Identifies tensions where a mechanism diverges, with suggested
//     resolution copy the brief renders as a "design tension" note
//   • Surfaces SHARED data tokens — produces/consumes slugs that
//     appear across multiple mechanisms (the data handoffs that
//     define cross-feature integration)
//
// Pure derivation, no LLM. Renders in the brief's RoomBlock as a
// "Design language" eyebrow band so the user reads "this room is
// designed as X" before drilling into per-mechanism specs.

export interface RoomDesignTension {
  /** The mechanism whose design intent diverges from the dominant. */
  mechanism_name: string;
  /** Which axis diverges. */
  axis: "accent" | "glass" | "density" | "motion";
  /** What this mechanism picked. */
  their_choice: string;
  /** What the rest of the room picked. */
  dominant_choice: string;
  /** Suggested resolution copy the brief surfaces verbatim. */
  resolution: string;
}

export interface RoomDesignLanguage {
  /** How many mechanisms in this room carry a v3 design_intent block. */
  mechanism_count: number;
  /** Dominant choice per axis across mechanisms with design_intent. */
  dominant_accent: MechanismDesignIntent["accent_intent"];
  dominant_glass_tier: MechanismDesignIntent["glass_tier"];
  dominant_density: MechanismDesignIntent["density"];
  dominant_motion: MechanismDesignIntent["motion_intent"];
  /** 0..1 — average of per-axis (% matching dominant). 1 = total
   *  coherence; 0 = every mechanism picked something different on
   *  every axis. */
  harmony_score: number;
  /** Mechanisms whose design intent diverges from the dominant, with
   *  resolution copy. Capped at 4 — beyond that, the room is
   *  unfocused and the user should reconsider grouping. */
  tensions: RoomDesignTension[];
  /** Data tokens that appear in MULTIPLE mechanisms' produces or
   *  consumes — the cross-feature handoffs that define how this room
   *  integrates internally. Empty when mechanisms are silos. ≤8. */
  shared_tokens: string[];
  /** Single-line human caption: "Coherent · signal · card · airy ·
   *  breathing" (harmony ≥0.8) or "Mixed · signal-leaning · 2
   *  outliers" (harmony 0.4-0.8) or "Unfocused — 5 different
   *  directions" (harmony <0.4). */
  caption: string;
}

/** Pure helper — counts occurrences and returns the mode + how many
 *  matched it. Stable on ties (first occurrence wins). */
function modeOf<T extends string>(
  values: ReadonlyArray<T>,
): { mode: T; maxCount: number } {
  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let mode = values[0];
  let maxCount = 0;
  for (const [v, c] of counts.entries()) {
    if (c > maxCount) {
      mode = v;
      maxCount = c;
    }
  }
  return { mode, maxCount };
}

/** Caption a tension's resolution — terse, prescriptive, designerly. */
function captionTensionResolution(
  axis: RoomDesignTension["axis"],
  theirs: string,
  dominant: string,
): string {
  switch (axis) {
    case "accent":
      return `Let ${theirs} own a single callout; ${dominant} stays the chrome accent.`;
    case "glass":
      return `Elevate to ${theirs} only when this mechanism takes hero focus; otherwise blend at ${dominant}.`;
    case "density":
      return `Use ${theirs} density inside this mechanism's surface; the room's shell stays ${dominant}.`;
    case "motion":
      return `Reserve ${theirs} motion for this mechanism's interactive moments; ambient elsewhere stays ${dominant}.`;
  }
}

/** Caption the overall room design language. */
function captionRoomLanguage(
  harmony: number,
  dominant: {
    accent: MechanismDesignIntent["accent_intent"];
    glass: MechanismDesignIntent["glass_tier"];
    density: MechanismDesignIntent["density"];
    motion: MechanismDesignIntent["motion_intent"];
  },
  tensionCount: number,
): string {
  const tokens = `${dominant.accent} · ${dominant.glass} · ${dominant.density} · ${dominant.motion}`;
  if (harmony >= 0.8) return `Coherent · ${tokens}`;
  if (harmony >= 0.5) {
    return `Mixed · ${dominant.accent}-leaning · ${tensionCount} outlier${tensionCount === 1 ? "" : "s"}`;
  }
  return `Unfocused — ${Math.round((1 - harmony) * 100)}% divergence across mechanisms`;
}

/**
 * Aggregate per-mechanism `design_intent` blocks into a room-level
 * design language. Returns null when no mechanism in the room
 * carries a v3 design_intent (pre-v3 specs).
 *
 * `specImpactByName` is an optional map from mechanism name to its
 * MechanismSpec — used to extract names for the tension notes. When
 * not provided, tensions still render but with a "this mechanism"
 * placeholder.
 */
export function composeRoomDesignLanguage(
  specs: ReadonlyArray<{ name: string; spec: MechanismSpec | null | undefined }>,
): RoomDesignLanguage | null {
  const valid = specs.filter(
    (s): s is { name: string; spec: MechanismSpec } =>
      !!s.spec && !!s.spec.design_intent,
  );
  if (valid.length === 0) return null;

  // Per-axis mode.
  const accentMode = modeOf(valid.map((v) => v.spec.design_intent!.accent_intent));
  const glassMode = modeOf(valid.map((v) => v.spec.design_intent!.glass_tier));
  const densityMode = modeOf(valid.map((v) => v.spec.design_intent!.density));
  const motionMode = modeOf(valid.map((v) => v.spec.design_intent!.motion_intent));

  // Per-axis harmony (fraction matching the dominant), averaged.
  const accentHarmony = accentMode.maxCount / valid.length;
  const glassHarmony = glassMode.maxCount / valid.length;
  const densityHarmony = densityMode.maxCount / valid.length;
  const motionHarmony = motionMode.maxCount / valid.length;
  const harmony_score =
    (accentHarmony + glassHarmony + densityHarmony + motionHarmony) / 4;

  // Tensions — divergences from dominant per axis. Cap at 4 total
  // (prioritize accent > glass > density > motion since accent
  // visibility is the loudest design dimension).
  const tensions: RoomDesignTension[] = [];
  const AXES: Array<{
    name: RoomDesignTension["axis"];
    get: (di: MechanismDesignIntent) => string;
    dominant: string;
  }> = [
    {
      name: "accent",
      get: (di) => di.accent_intent,
      dominant: accentMode.mode,
    },
    { name: "glass", get: (di) => di.glass_tier, dominant: glassMode.mode },
    { name: "density", get: (di) => di.density, dominant: densityMode.mode },
    {
      name: "motion",
      get: (di) => di.motion_intent,
      dominant: motionMode.mode,
    },
  ];
  for (const ax of AXES) {
    for (const v of valid) {
      if (tensions.length >= 4) break;
      const theirs = ax.get(v.spec.design_intent!);
      if (theirs !== ax.dominant) {
        tensions.push({
          mechanism_name: v.name,
          axis: ax.name,
          their_choice: theirs,
          dominant_choice: ax.dominant,
          resolution: captionTensionResolution(ax.name, theirs, ax.dominant),
        });
      }
    }
  }

  // Shared tokens — produces/consumes slugs that appear across ≥2
  // mechanisms. These are the cross-feature handoffs.
  const tokenOccurrences = new Map<string, number>();
  for (const v of valid) {
    const tokens = new Set<string>();
    for (const step of v.spec.runtime_flow ?? []) {
      for (const t of step.produces ?? []) {
        const s = t.trim();
        if (s) tokens.add(s);
      }
      for (const t of step.consumes ?? []) {
        const s = t.trim();
        if (s) tokens.add(s);
      }
    }
    for (const t of tokens) {
      tokenOccurrences.set(t, (tokenOccurrences.get(t) ?? 0) + 1);
    }
  }
  const shared_tokens = Array.from(tokenOccurrences.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug)
    .slice(0, 8);

  return {
    mechanism_count: valid.length,
    dominant_accent: accentMode.mode,
    dominant_glass_tier: glassMode.mode,
    dominant_density: densityMode.mode,
    dominant_motion: motionMode.mode,
    harmony_score,
    tensions: tensions.slice(0, 4),
    shared_tokens,
    caption: captionRoomLanguage(
      harmony_score,
      {
        accent: accentMode.mode,
        glass: glassMode.mode,
        density: densityMode.mode,
        motion: motionMode.mode,
      },
      tensions.length,
    ),
  };
}
