/**
 * UPF — construct posteriors (Phase 4c-final).
 *
 * The missing piece that turns UPF from a heuristic scorer into a self-tuning
 * active-learning loop.
 *
 * ## The idea
 *
 * Each construct (latent variable we care about: an answered question's
 * underlying fact, a tracker's true value, an edge's strength) has a
 * *posterior belief* — our best guess + how uncertain we are. Observations
 * (user answers, metric readings, edge validations) update the posterior.
 *
 * When the UPF selector decides "what to probe next", it prefers proxies of
 * HIGH-variance constructs: those are where new data yields the most Shannon
 * information. Once a construct's variance is low ("we know this well"), its
 * proxies sink in the rankings — the user isn't asked about it again.
 *
 * ## Storage
 *
 * For Phase 4c-final we embed posteriors inline in `synthesis_data.construct_posteriors`
 * (a Record<construct_id, ConstructPosterior>). Zero-migration, per-space,
 * reuses the existing JSONB update path. A dedicated `construct_posteriors`
 * table is a future optimization when cross-space sharing / time-series
 * history matters (biology-grade modeling will need it).
 *
 * ## Distribution model
 *
 * Normal(mean, variance). Simple, conjugate, admits cheap updates. For
 * categorical constructs (priority="critical|high|medium") we still use
 * Normal over the rank (0..1) — loss-of-expressiveness is acceptable for
 * the selection decision we care about; finer-grained Beta/Dirichlet can
 * slot in later without changing the caller contract.
 *
 * Every coefficient is a named constant. All functions are pure. No imports
 * from React or the DB layer.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface ConstructPosterior {
  /** Must match a ProxyDescriptor.construct_id. */
  construct_id: string;
  /** Posterior mean (0..1 for ranked / categorical, raw value otherwise). */
  mean: number;
  /** Posterior variance (>= 0). Higher = more uncertainty = more info to gain. */
  variance: number;
  /** Number of observations folded in so far. */
  observation_count: number;
  /** ISO timestamp of the latest observation. */
  last_observed_at: string;
  /**
   * Optional notes the scorer / UI can reference. Never consumed for maths.
   * Example: `{ source: "open_question_answer", answer_hash: "abc…" }`.
   */
  metadata?: Record<string, unknown>;
}

/** Lookup signature — scorers accept this so callers can inject any backing store. */
export type PosteriorLookup = (
  construct_id: string
) => ConstructPosterior | undefined;

// ── Priors ────────────────────────────────────────────────────────────

/**
 * Default prior for a construct we've never observed. Variance is high so
 * any proxy starts out "informative" — the selector will pick it readily.
 */
export const DEFAULT_PRIOR_VARIANCE = 1.0;
export const DEFAULT_PRIOR_MEAN = 0.5;

export function defaultPrior(construct_id: string): ConstructPosterior {
  return {
    construct_id,
    mean: DEFAULT_PRIOR_MEAN,
    variance: DEFAULT_PRIOR_VARIANCE,
    observation_count: 0,
    last_observed_at: new Date(0).toISOString(),
  };
}

// ── Bayesian update (Normal conjugate) ────────────────────────────────

/**
 * How much weight a single observation carries. For user-supplied answers
 * we're confident the user knows their own data, so observation variance
 * is small (< prior variance) — answers strongly move the posterior.
 */
export const ANSWER_OBSERVATION_VARIANCE = 0.15;

/**
 * Light-proxy observation (passive sensor reading, auto-tracker): medium
 * variance — useful but not ground truth.
 */
export const LIGHT_PROXY_OBSERVATION_VARIANCE = 0.35;

/**
 * Heavy-proxy / calibration-anchor: very confident, drives posterior fast.
 */
export const HEAVY_PROXY_OBSERVATION_VARIANCE = 0.08;

/** Observation the Bayesian update consumes. */
export interface Observation {
  /** Target construct_id. */
  construct_id: string;
  /** Normalised observation value (same scale as posterior.mean). */
  value: number;
  /** Per-observation variance — smaller = more confident. */
  observation_variance: number;
  /** When the observation was recorded (ISO). */
  recorded_at: string;
  /** Optional free-form provenance. */
  metadata?: Record<string, unknown>;
}

/**
 * Classic Normal-Normal conjugate update.
 *
 *   posterior_precision = prior_precision + obs_precision
 *   posterior_mean = (prior_mean * prior_precision + obs * obs_precision) / posterior_precision
 *   posterior_variance = 1 / posterior_precision
 */
export function bayesianUpdate(
  prior: ConstructPosterior,
  obs: Observation
): ConstructPosterior {
  if (obs.construct_id !== prior.construct_id) {
    throw new Error(
      `bayesianUpdate: construct_id mismatch (${prior.construct_id} vs ${obs.construct_id})`
    );
  }
  const priorVar = Math.max(prior.variance, 1e-6);
  const obsVar = Math.max(obs.observation_variance, 1e-6);
  const priorPrecision = 1 / priorVar;
  const obsPrecision = 1 / obsVar;
  const posteriorPrecision = priorPrecision + obsPrecision;
  const posteriorVariance = 1 / posteriorPrecision;
  const posteriorMean =
    (prior.mean * priorPrecision + obs.value * obsPrecision) / posteriorPrecision;
  return {
    construct_id: prior.construct_id,
    mean: posteriorMean,
    variance: posteriorVariance,
    observation_count: prior.observation_count + 1,
    last_observed_at: obs.recorded_at,
    metadata: { ...(prior.metadata ?? {}), ...(obs.metadata ?? {}) },
  };
}

// ── Time decay ────────────────────────────────────────────────────────

/**
 * Posterior half-life in days. After this many days with no new observations,
 * the effective variance re-expands halfway back to the prior. Tuned for
 * strategy signals (monthly planning cadence); biology/cognition will use a
 * shorter half-life via a per-construct override in a later phase.
 */
export const DEFAULT_POSTERIOR_HALF_LIFE_DAYS = 30;

/**
 * Apply exponential variance re-expansion: old observations "forget" some of
 * their certainty as time passes. Returns the effective variance *today*,
 * without mutating the stored posterior.
 *
 * Formula: effective_var = prior_var - (prior_var - stored_var) * 2^(-age/half_life)
 *   - age = 0 → effective_var = stored_var (fresh, no decay)
 *   - age = half_life → halfway between stored_var and prior_var
 *   - age → ∞ → effective_var → prior_var (fully forgotten)
 */
export function effectiveVariance(
  posterior: ConstructPosterior,
  now: Date = new Date(),
  halfLifeDays: number = DEFAULT_POSTERIOR_HALF_LIFE_DAYS
): number {
  if (posterior.observation_count === 0) return DEFAULT_PRIOR_VARIANCE;
  const observedAt = new Date(posterior.last_observed_at).getTime();
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    return posterior.variance;
  }
  const ageDays = (now.getTime() - observedAt) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return posterior.variance;
  const decayFactor = Math.pow(2, -ageDays / halfLifeDays);
  const gap = DEFAULT_PRIOR_VARIANCE - posterior.variance;
  return Math.min(
    DEFAULT_PRIOR_VARIANCE,
    posterior.variance + gap * (1 - decayFactor)
  );
}

// ── Info-bit attenuation ──────────────────────────────────────────────

/**
 * Given a descriptor's *nominal* info-bits and the construct's current
 * posterior, compute the EFFECTIVE info-bits the selector should use.
 *
 * We multiply by the square root of time-decayed posterior variance
 * (normalised against the default prior variance) — so:
 *   - fresh prior → multiplier = 1.0 (no attenuation; we know nothing yet)
 *   - variance = 0.25 * prior, fresh → multiplier = 0.5
 *   - variance → 0 → multiplier → 0 (fully known; stop probing)
 *   - stale observations → multiplier grows back toward 1.0
 *
 * Never amplifies beyond 1.0 — attenuation-only.
 */
export function applyPosteriorAttenuation(
  nominalBits: number,
  posterior: ConstructPosterior | undefined,
  now: Date = new Date()
): number {
  if (!posterior) return nominalBits;
  const varNow = effectiveVariance(posterior, now);
  const relativeVar = Math.min(varNow / DEFAULT_PRIOR_VARIANCE, 1.0);
  const multiplier = Math.sqrt(relativeVar);
  return nominalBits * multiplier;
}

// ── Knownness (for UI surfaces) ───────────────────────────────────────

/**
 * 0..1 indicator of "how well do we know this construct?" intended for
 * user-facing rings / pills. 0 = prior (nothing observed); 1 = variance
 * collapsed to zero. Uses time-decayed variance so stale observations
 * naturally fade toward unknown.
 */
export function knownness(
  posterior: ConstructPosterior | undefined,
  now: Date = new Date()
): number {
  if (!posterior || posterior.observation_count === 0) return 0;
  const varNow = effectiveVariance(posterior, now);
  return Math.max(0, Math.min(1, 1 - varNow / DEFAULT_PRIOR_VARIANCE));
}

// ── Observation builders ──────────────────────────────────────────────

/**
 * Build an Observation for a user's answer to an open question. We can't
 * extract a numeric value without another LLM pass, so we treat the answer
 * as a *high-confidence* signal that the construct is now "known" — the
 * mean is set to 1.0 (on our 0..1 knowledge scale) with tight variance.
 *
 * Called from the open-questions POST handler.
 */
export function observationFromAnswer(
  construct_id: string,
  answeredAt: string,
  answerHash?: string
): Observation {
  return {
    construct_id,
    value: 1.0,
    observation_variance: ANSWER_OBSERVATION_VARIANCE,
    recorded_at: answeredAt,
    metadata: {
      source: "open_question_answer",
      ...(answerHash ? { answer_hash: answerHash } : {}),
    },
  };
}

// ── Map helpers (for inline synthesis_data storage) ───────────────────

export type PosteriorMap = Record<string, ConstructPosterior>;

/** Build a lookup over an in-memory posterior map. */
export function makePosteriorLookup(map?: PosteriorMap | null): PosteriorLookup {
  return (construct_id: string) => map?.[construct_id];
}

/**
 * Immutably apply an observation to a posterior map, creating a default
 * prior on first sighting. Returns the new map.
 */
export function applyObservation(
  map: PosteriorMap,
  obs: Observation
): PosteriorMap {
  const prior = map[obs.construct_id] ?? defaultPrior(obs.construct_id);
  const next = bayesianUpdate(prior, obs);
  return { ...map, [obs.construct_id]: next };
}
