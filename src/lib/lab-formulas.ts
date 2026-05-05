// ── Lab formulas (Phase 18) ──
//
// Single source of truth for instrument parameters, default values per
// entity category, the throughput formula, and the Monte Carlo sampler.
// Imported by both the API route (server-side validation) and the lab UI
// (control panel, distribution chart, HUD readout).

export type ParameterKey = "K" | "tau" | "rho" | "alpha";

export interface ParameterSpec {
  key: ParameterKey;
  label: string;
  /** Display unit string ("s", "/s", or "" for unitless) */
  unit: string;
  /** Symbol for the lab control panel dial (Greek glyph for vibe) */
  symbol: string;
  /** Slider domain */
  min: number;
  max: number;
  /** Slider step granularity */
  step: number;
  /** Tick labels — left, mid, right */
  ticks: [string, string, string];
}

export interface InstrumentParameters {
  K: number;
  tau: number;
  rho: number;
  alpha: number;
}

// Phase A — labels relabeled to plain English. Symbols (K/τ/ρ/α) and
// internal keys are unchanged so the throughput formula, Monte Carlo,
// modulator system, and persisted JSONB rows all keep working.
//
// label → user-facing copy in dial header
// symbol → kept for the small Greek glyph next to the label (researcher
//          mode aesthetic; harmless if hidden later)
// unit → display-only suffix
export const PARAMETER_SPECS: ParameterSpec[] = [
  {
    key: "K",
    label: "Capacity",
    unit: "",
    symbol: "K",
    min: 1,
    max: 10,
    step: 1,
    ticks: ["1", "5", "10"],
  },
  {
    key: "tau",
    label: "Memory",
    unit: "s",
    symbol: "τ",
    min: 1,
    max: 60,
    step: 1,
    ticks: ["1s", "30s", "60s"],
  },
  {
    key: "rho",
    label: "Update",
    unit: "/s",
    symbol: "ρ",
    min: 0,
    max: 3,
    step: 0.1,
    ticks: ["0", "1.5", "3"],
  },
  {
    key: "alpha",
    label: "Focus",
    unit: "",
    symbol: "α",
    min: 1,
    max: 5,
    step: 1,
    ticks: ["1", "3", "5"],
  },
];

// Category-specific defaults so a freshly-opened lab has sensible starting
// values without requiring per-entity user setup. Keys match
// entity.entity_category. Anything unmatched falls back to "default".
export const DEFAULTS_BY_CATEGORY: Record<string, InstrumentParameters> = {
  default: { K: 4, tau: 20, rho: 1.5, alpha: 3 },
  process: { K: 3, tau: 12, rho: 2.0, alpha: 4 },
  concrete: { K: 5, tau: 30, rho: 1.0, alpha: 3 },
  abstract: { K: 4, tau: 25, rho: 1.2, alpha: 2 },
  relational: { K: 4, tau: 18, rho: 1.8, alpha: 3 },
  epistemic: { K: 3, tau: 15, rho: 1.5, alpha: 4 },
  fault: { K: 2, tau: 8, rho: 0.8, alpha: 2 },
};

/** Defaults lookup for a given entity category. Falls back to "default". */
export function defaultsForCategory(
  category: string | null | undefined,
): InstrumentParameters {
  const key = (category ?? "default") as string;
  return { ...(DEFAULTS_BY_CATEGORY[key] ?? DEFAULTS_BY_CATEGORY.default) };
}

/**
 * Resolve the parameters for an entity. If the entity has user-customized
 * `parameters` stored, use them (with bounds-clamping). Otherwise return
 * the category default.
 */
/** Optional subject context that layers per-subject overrides + a
 *  conditions modulator bag on top of the entity's stored params.
 *
 *  When a Subject is in scope (e.g. lab loaded with `?subjectId=`),
 *  every consumer of `getEntityParameters(entity, ctx)` automatically
 *  sees the modulated effective params. The entity row's
 *  `parameters` JSONB stays UNCHANGED — the override + modulation
 *  layer is read-only and recomputed on each call. Two subjects can
 *  test the same entity with different conditions without clobbering
 *  each other.
 *
 *  Composition order:
 *    1. category default (DEFAULTS_BY_CATEGORY[entity_category])
 *    2. entity row's own `parameters` JSONB
 *    3. subject's `entity_param_overrides[entityId]` (when present)
 *    4. apply subject's `conditions` via `applyModulators` (when present)
 *
 *  Result is always clamped to PARAMETER_SPECS bounds. */
export interface SubjectLabContext {
  entityOverride?: Partial<InstrumentParameters> | null;
  conditions?: Record<string, number> | null;
  /** When provided, used instead of STARTER_MODULATORS — lets future
   *  per-space modulator vocabularies override the global default
   *  without forcing every call site to import the constant. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modulators?: any;
}

export function getEntityParameters(
  entity: {
    parameters?: Record<string, unknown> | null;
    entity_category?: string | null;
  },
  ctx?: SubjectLabContext | null,
): InstrumentParameters {
  const cat = (entity.entity_category as string | null) ?? "default";
  const def = DEFAULTS_BY_CATEGORY[cat] ?? DEFAULTS_BY_CATEGORY.default;
  const raw = entity.parameters && typeof entity.parameters === "object"
    ? (entity.parameters as Record<string, unknown>)
    : null;
  // Layer 1+2: entity row over category default.
  const baseParams: InstrumentParameters = clampParameters({
    K: typeof raw?.K === "number" ? raw.K : def.K,
    tau: typeof raw?.tau === "number" ? raw.tau : def.tau,
    rho: typeof raw?.rho === "number" ? raw.rho : def.rho,
    alpha: typeof raw?.alpha === "number" ? raw.alpha : def.alpha,
  });

  // Fast path — no subject context, no further composition.
  if (!ctx) return baseParams;

  // Layer 3: per-subject entity override.
  const withOverride: InstrumentParameters = ctx.entityOverride
    ? clampParameters({
        K:
          typeof ctx.entityOverride.K === "number"
            ? ctx.entityOverride.K
            : baseParams.K,
        tau:
          typeof ctx.entityOverride.tau === "number"
            ? ctx.entityOverride.tau
            : baseParams.tau,
        rho:
          typeof ctx.entityOverride.rho === "number"
            ? ctx.entityOverride.rho
            : baseParams.rho,
        alpha:
          typeof ctx.entityOverride.alpha === "number"
            ? ctx.entityOverride.alpha
            : baseParams.alpha,
      })
    : baseParams;

  // Layer 4: condition modulators (sleep / stress / caffeine / ...).
  // Lazy-import to avoid a circular at module load (modulators.ts
  // doesn't depend on lab-formulas, but keeping this import dynamic
  // makes it trivially shake-able if a non-lab caller ever pulls in
  // lab-formulas and we don't want the modulator vocabulary along).
  if (ctx.conditions && Object.keys(ctx.conditions).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { applyModulators, STARTER_MODULATORS } = require("@/lib/subjects/modulators");
    return clampParameters(
      applyModulators(
        ctx.conditions,
        withOverride,
        ctx.modulators ?? STARTER_MODULATORS,
      ),
    );
  }

  return withOverride;
}

/** Bounds-clamp + round to spec granularity. Used at read AND write. */
export function clampParameters(p: InstrumentParameters): InstrumentParameters {
  const out: InstrumentParameters = { ...p };
  for (const spec of PARAMETER_SPECS) {
    let v = out[spec.key];
    if (typeof v !== "number" || !Number.isFinite(v)) v = (spec.min + spec.max) / 2;
    v = Math.max(spec.min, Math.min(spec.max, v));
    // Snap to step
    v = Math.round(v / spec.step) * spec.step;
    out[spec.key] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/**
 * Throughput formula. Returns a 0..100 percent value representing the
 * entity's effective output capacity under the given parameter regime.
 *
 * Derivation:
 *   eff   = min(K, α+1)          // attention caps usable slots
 *   refB  = 1 + ρ × 0.25         // refresh boost
 *   decP  = clamp(τ/15, 0.3, 1.5) // decay penalty (too short → low; too long → saturating)
 *   raw   = eff × decP × refB × 12
 *   out   = clamp(raw, 0, 100)
 */
export function throughput(p: InstrumentParameters): number {
  const eff = Math.min(p.K, p.alpha + 1);
  const refB = 1 + p.rho * 0.25;
  const decP = Math.max(0.3, Math.min(1.5, p.tau / 15));
  return Math.min(100, eff * decP * refB * 12);
}

/**
 * Monte Carlo distribution sampler. Perturbs each parameter by ±10% of
 * its range, computes throughput per sample, returns a fixed-bin histogram.
 * Deterministic per (parameter set, sampleCount) when seeded.
 */
export interface DistributionResult {
  samples: number[];        // raw throughput values (0..100)
  bins: number[];           // counts per bin
  binCount: number;         // bins.length
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

export function monteCarlo(
  p: InstrumentParameters,
  opts: { samples?: number; bins?: number; jitter?: number } = {},
): DistributionResult {
  const samples = opts.samples ?? 200;
  const binCount = opts.bins ?? 20;
  const jitter = opts.jitter ?? 0.1; // ±10% of range

  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const perturbed = clampParameters({
      K: p.K + (Math.random() - 0.5) * (10 - 1) * jitter,
      tau: p.tau + (Math.random() - 0.5) * (60 - 1) * jitter,
      rho: p.rho + (Math.random() - 0.5) * (3 - 0) * jitter,
      alpha: p.alpha + (Math.random() - 0.5) * (5 - 1) * jitter,
    });
    out.push(throughput(perturbed));
  }

  const bins = new Array(binCount).fill(0);
  for (const v of out) {
    const idx = Math.min(binCount - 1, Math.floor((v / 100) * binCount));
    bins[idx]++;
  }

  const sorted = [...out].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  return {
    samples: out,
    bins,
    binCount,
    mean,
    median: pct(0.5),
    p10: pct(0.1),
    p90: pct(0.9),
  };
}
