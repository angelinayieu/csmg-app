// ── Subject conditions / modulators ──────────────────────────────
//
// Vocabulary + math for the "Sleep / Stress / Caffeine / Time-of-day"
// slider stack on the lab. Lives as a TS constant for v1 (easy to
// extend, no migration churn). Promote to a per-space DB table when
// users want to author their own modulators.
//
// Design note: modulators DON'T mutate the entity's stored
// `parameters` JSONB. They're applied at lab read-time by
// `applyModulators(conditions, baseParams)` so multiple Subjects
// can experiment with the same entity under different conditions
// without clobbering each other's state.
//
// See:
//   - src/lib/lab-formulas.ts (InstrumentParameters shape)
//   - src/types/subject.ts (Subject.conditions field)
//   - supabase/migrations/20260608_subjects_and_lab_scaffolds.sql
//     (subjects.conditions JSONB column)

import type {
  InstrumentParameters,
  ParameterKey,
} from "@/lib/lab-formulas";

/** A single condition that can be slid by the user.
 *  Keys are stored on subject.conditions as { [key]: number }. */
export interface ModulatorSpec {
  /** Stable key — used as the JSONB property name. */
  key: string;
  /** User-facing label for the slider. */
  label: string;
  /** Display units after the value (e.g. "h", "mg", "0–10"). */
  units: string;
  /** Allowed range. */
  range: [number, number];
  /** Default value used when the subject hasn't set this modulator. */
  default: number;
  /** Slider step granularity. */
  step: number;
  /** One-line tooltip explanation. */
  description: string;
  /** How this modulator affects entity parameters. The math is
   *  intentionally simple for v1 — see `applyModulators` below. */
  affects: ModulatorEffect[];
  /** Display group — drives sidebar section grouping. */
  group: "physiology" | "context" | "environment" | "intent";
}

export interface ModulatorEffect {
  /** Which entity parameter this modulator pushes on. */
  paramKey: ParameterKey;
  /** Effect strength, signed. Magnitude is normalized to the
   *  modulator's range, so a `weight` of 0.15 means "at the top of
   *  the range, this modulator pushes paramKey up by 15% of its
   *  current value (relative to the modulator's default)." */
  weight: number;
  /** Mapping curve. v1 supports linear + simple sigmoid. */
  curve: "linear" | "sigmoid";
}

/** Starter vocabulary. Modeled after the cognitive-performance
 *  example in the design discussion (sleep/stress/caffeine/time).
 *  Values are illustrative — domain-specific weights would come
 *  from validated literature in a real clinical use case. */
export const STARTER_MODULATORS: ModulatorSpec[] = [
  {
    key: "sleep_h",
    label: "Sleep",
    units: "h",
    range: [0, 12],
    default: 8,
    step: 0.5,
    description: "Hours of sleep in the last 24h.",
    group: "physiology",
    // More sleep → more capacity (K) + slightly slower decay (tau).
    affects: [
      { paramKey: "K", weight: 0.15, curve: "sigmoid" },
      { paramKey: "tau", weight: 0.1, curve: "linear" },
    ],
  },
  {
    key: "stress_0_10",
    label: "Stress",
    units: "0–10",
    range: [0, 10],
    default: 2,
    step: 0.5,
    description: "Self-rated acute stress.",
    group: "physiology",
    // Stress shrinks capacity, accelerates decay, and narrows
    // attention bandwidth.
    affects: [
      { paramKey: "K", weight: -0.18, curve: "linear" },
      { paramKey: "tau", weight: -0.2, curve: "linear" },
      { paramKey: "alpha", weight: -0.1, curve: "linear" },
    ],
  },
  {
    key: "caffeine_mg",
    label: "Caffeine",
    units: "mg",
    range: [0, 600],
    default: 0,
    step: 25,
    description: "Caffeine consumed in the last 4 hours.",
    group: "physiology",
    // Modest attention-bandwidth boost, no effect on decay.
    affects: [{ paramKey: "alpha", weight: 0.12, curve: "sigmoid" }],
  },
  {
    key: "time_of_day_24h",
    label: "Time of day",
    units: "24h",
    range: [0, 24],
    default: 10,
    step: 0.5,
    description:
      "Hour of day, 24h clock. Drives a circadian arousal curve (peak ≈10–12 / 16–18).",
    group: "context",
    // Circadian effect on K — modeled as deviation from midday.
    affects: [{ paramKey: "K", weight: 0.08, curve: "sigmoid" }],
  },
];

/** Lookup helper — used by the slider panel to resolve a key to its
 *  display spec. Returns null when an unknown key sits on a subject
 *  (e.g. from a deprecated modulator that's been removed). */
export function getModulatorSpec(
  key: string,
  modulators: ModulatorSpec[] = STARTER_MODULATORS,
): ModulatorSpec | null {
  return modulators.find((m) => m.key === key) ?? null;
}

/** Default value for a modulator key. */
export function modulatorDefault(
  key: string,
  modulators: ModulatorSpec[] = STARTER_MODULATORS,
): number {
  return getModulatorSpec(key, modulators)?.default ?? 0;
}

/** Build a fresh conditions bag from the modulator defaults. Used
 *  when a Subject is first created with no conditions specified. */
export function defaultConditions(
  modulators: ModulatorSpec[] = STARTER_MODULATORS,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of modulators) out[m.key] = m.default;
  return out;
}

/** Sigmoid centered at 0, output range (-1, 1). */
function sigmoid(x: number): number {
  return 2 / (1 + Math.exp(-x)) - 1;
}

/** Apply a modulator bag to a base parameter set. Pure function —
 *  no DB access, deterministic, side-effect free. The lab calls this
 *  at render time so flipping a slider re-derives effective params
 *  without touching `entities.parameters`.
 *
 *  Math (intentionally simple for v1):
 *
 *    For each modulator with a value:
 *      normalized = (value - default) / (range_high - range_low)
 *      curveOut   = curve === "sigmoid"
 *                    ? sigmoid(4 * normalized)   // sharper response
 *                    : normalized                 // linear
 *      delta      = curveOut * weight * baseValue
 *      effective += delta
 *
 *    All effective params are clamped to a sensible floor (>= 0.01)
 *    so we never go non-positive.
 */
export function applyModulators(
  conditions: Record<string, number>,
  baseParams: Partial<InstrumentParameters>,
  modulators: ModulatorSpec[] = STARTER_MODULATORS,
): InstrumentParameters {
  // Start from base + sane fallbacks so a partial baseParams still
  // produces a complete InstrumentParameters output.
  const result: InstrumentParameters = {
    K: baseParams.K ?? 4,
    tau: baseParams.tau ?? 20,
    rho: baseParams.rho ?? 1.5,
    alpha: baseParams.alpha ?? 3,
  };

  for (const mod of modulators) {
    const value = conditions[mod.key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const span = mod.range[1] - mod.range[0];
    if (span <= 0) continue;
    // Normalize the deviation from default to roughly [-1, 1].
    const normalized = (value - mod.default) / span;

    // Curve is per-effect (not per-modulator) so a single modulator
    // can push different paramKeys with different response shapes
    // (e.g., sleep boosts K linearly but tau sigmoidally).
    for (const effect of mod.affects) {
      const curveOut =
        effect.curve === "sigmoid" ? sigmoid(4 * normalized) : normalized;
      const baseValue = result[effect.paramKey];
      const delta = curveOut * effect.weight * baseValue;
      result[effect.paramKey] = Math.max(0.01, baseValue + delta);
    }
  }

  return result;
}

/** Layer a per-subject entity override on top of the entity's
 *  global default, then apply modulators. The complete pipeline:
 *
 *    1. Start from entity's global parameters (entities.parameters)
 *    2. Layer subject.entity_param_overrides[entityId] (if present)
 *    3. Apply subject.conditions via applyModulators()
 *
 *  Single helper so the lab + scenario engine + experiment logger
 *  all use the same composition. */
export function effectiveEntityParams(opts: {
  entityDefaults: Partial<InstrumentParameters>;
  subjectOverride?: Partial<InstrumentParameters>;
  conditions?: Record<string, number>;
  modulators?: ModulatorSpec[];
}): InstrumentParameters {
  const base: Partial<InstrumentParameters> = {
    ...opts.entityDefaults,
    ...(opts.subjectOverride ?? {}),
  };
  return applyModulators(
    opts.conditions ?? {},
    base,
    opts.modulators ?? STARTER_MODULATORS,
  );
}
