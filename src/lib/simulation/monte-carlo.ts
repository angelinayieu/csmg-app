// ── Monte Carlo simulation engine (Phase 1 Step 7) ──
//
// Why: the original rigor question. Today's prediction_ledger stores
// `predicted_distribution` as an LLM-estimated {p10, p50, p90}. Those
// are guesses. This module does actual stochastic simulation on a
// causal subgraph — sampling N runs, propagating effects through
// typed edge-dynamics, and returning distributions derived from real
// samples.
//
// Scope (v1):
//   - Pure function, no DB, no pipeline wiring (call sites plug it in)
//   - Deterministic with `seed` param so tests can assert exact outputs
//   - Three edge dynamics: `linear`, `threshold`, `compounding`
//     (matches the decompose route's `edges.dynamics` enum)
//   - Fixed timestep propagation (default 10 steps per iteration);
//     simulates both forward cascade and feedback-loop compounding
//   - Output: per-node {p10, p50, p90, mean, stddev, samples[]}
//
// Out of scope (deferred):
//   - Bayesian inference / posterior updates (Phase 2 Python sidecar)
//   - Continuous-time differential equations
//   - Cross-node correlation in priors
//   - Cyclic graph convergence guarantees (we just cap timesteps)
//
// Design note: we deliberately don't use external stats libraries.
// Box-Muller is 20 lines, quantile sort is trivial, and shipping
// without new deps keeps the Vercel bundle tight.

import { integrateRK4 } from "./ode-integrator";

/**
 * Thin wrapper so the hot-loop integrator call reads the same shape
 * whether we ever swap the implementation. Kept as a function so
 * tree-shaking can drop the ODE module when no caller opts in — the
 * discrete path never touches this reference.
 */
function odeIntegratorModule() {
  return { integrateRK4 };
}

export type EdgeDynamics =
  | "linear"
  | "threshold"
  | "compounding"
  | "decay"
  | "exponential";

export type EdgePolarity = "positive" | "negative" | "neutral" | "conditional";

/** Phase 4 — per-edge temporal data sourced from
 *  edges.{onset,peak,persistence}_days_p50 + decay_kinetics_modal
 *  (populated by Phase 3's temporal pooler).
 *
 *  When supplied AND the simulation runs in weeklyHorizon mode, the
 *  engine multiplies each edge's strength by a temporal ramp factor
 *  evaluated at the current wall-clock day. When NOT supplied (or
 *  the sim isn't running in weekly mode), edges fire instantly and
 *  the ramp is 1.0 for every step — preserving pre-Phase-4 behavior. */
export type EdgeTemporalDecayKinetics =
  | "linear"
  | "exponential"
  | "sustained"
  | "biphasic"
  | "unknown";

export interface EdgeTemporalSpec {
  /** Days from intervention start to first measurable effect. */
  onset_days?: number | null;
  /** Days from intervention start to peak effect. */
  peak_days?: number | null;
  /** Days the effect persists after intervention stops. */
  persistence_days?: number | null;
  /** Qualitative shape of decay after persistence ends. */
  decay_kinetics?: EdgeTemporalDecayKinetics | null;
}

export interface NodeSpec {
  id: string;
  /** Prior mean — the expected starting value. */
  priorMean: number;
  /** Prior stddev — uncertainty around the starting value. 0 = deterministic. */
  priorStdDev: number;
  /**
   * Optional lower/upper clamp. Values sampled outside [min,max] get
   * clamped before propagation. Use to encode domain constraints
   * (percentages ∈ [0,1], counts ≥ 0, etc.).
   */
  min?: number;
  max?: number;
}

export interface EdgeSpec {
  sourceId: string;
  targetId: string;
  /** Strength coefficient, typically 0..1. Polarity flips the sign. */
  strength: number;
  polarity?: EdgePolarity;
  dynamics: EdgeDynamics;
  /**
   * Optional per-dynamics parameters. Examples:
   *   threshold: { threshold: 0.5 }
   *   compounding: { rate: 0.1 }
   *   decay: { halfLife: 5 }
   */
  params?: Record<string, number>;
  /**
   * Phase 3 §4.2 — conditional gate.
   *
   * For edges with `polarity === "conditional"`, the engine rolls a
   * Bernoulli draw at the START of each iteration: with probability
   * `conditionGate` the edge fires NORMALLY for that iteration; with
   * probability (1 - conditionGate) the edge contributes 0 across all
   * timesteps for that iteration. This is how branching scenarios get
   * sampled honestly — instead of treating "X causes Y under condition
   * Z" as either always-on or always-off, the simulator samples Z's
   * truth-state per-iteration.
   *
   * Default 0.5 when omitted on a conditional edge (assumes the
   * condition fires half the time — neutral prior). Ignored on non-
   * conditional polarities. Range [0,1]; the engine clamps.
   *
   * The probability itself isn't computed by the engine — it has no way
   * to evaluate prose conditions. Callers (simulate-entity-chain,
   * synthesize, etc.) are responsible for translating `condition_text`
   * into a numeric gate. Until that infrastructure lands, leaving this
   * field unset gives a 0.5 prior — strictly better than the
   * pre-Phase-3 behavior, which treated conditional edges as always-on.
   */
  conditionGate?: number;
  /**
   * Phase 4 — per-edge temporal pooled estimates (onset / peak /
   * persistence / decay_kinetics) sourced from
   * edges.{onset,peak,persistence}_days_p50 + decay_kinetics_modal.
   *
   * Used ONLY when `SimulationSpec.weeklyHorizon` is set. In that
   * mode each timestep represents one wall-clock week, and an edge's
   * effective strength at week t is `strength × temporalRampFactor(t,
   * temporal)`. With no temporal data (or weeklyHorizon unset), the
   * ramp is identically 1 and pre-Phase-4 behavior is preserved.
   *
   * Soft-failing on missing fields: a partial spec (e.g. peak_days
   * only) still produces a sensible ramp — onset defaults to 0,
   * persistence to ∞, decay to "sustained". A full spec gives the
   * shape the literature reported.
   */
  temporal?: EdgeTemporalSpec | null;
  /**
   * Migration 20260509_edges_causal_status — Pearl-hierarchy tier.
   *
   * The simulator multiplies edge.strength by a `causalTrustWeight`
   * derived from this field BEFORE propagation. Established_causal
   * edges propagate at full strength (1.0); plausible_causal at 0.7;
   * correlational_only at 0.4 — the explicit downweight that stops
   * the engine treating a measured association as if it were a
   * proven cause.
   *
   * Null (unset) defaults to "established_causal" weight 1.0, which
   * matches pre-migration behavior. The aggregator surfaces non-
   * null values per row so users can audit which edges contribute
   * full vs reduced trust.
   */
  causalStatus?:
    | "established_causal"
    | "plausible_causal"
    | "correlational_only"
    | null;
  /**
   * Migration 20260509_condition_modulators — composed product of
   * matching modulators' p50 values for the active subject's
   * conditions. The simulator multiplies edge.strength by this
   * factor BEFORE propagation, applying per-patient calibration
   * (e.g., post_chemo×aerobic→BDNF carries 0.55 multiplier from
   * Janelsins 2017).
   *
   * Defaults to 1.0 (no modulation) when no modulators match the
   * subject's conditions, so pre-migration behavior is preserved.
   * Computed by computeEdgeMultipliers() in
   * @/lib/simulation/condition-modulators — caller resolves the
   * product once and passes the scalar through here.
   */
  conditionMultiplier?: number;
}

export interface SimulationSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  /** Number of Monte Carlo iterations. Default 1000. */
  iterations?: number;
  /** Propagation timesteps per iteration. Default 10.
   *  In discrete mode: number of synchronous update rounds.
   *  In ode_rk4 mode: total integration time in normalized units (the
   *  ODE integrator further subdivides this into fine substeps). */
  timesteps?: number;
  /** Deterministic seed. Default 42. */
  seed?: number;
  /**
   * R3 — integrator selection.
   *
   *   "discrete" (default) — synchronous per-step update using
   *     `applyDynamics`. Tier 4 math: each edge contributes a per-step
   *     scalar effect, nodes accumulate via `prior + contribution/N`.
   *     Fast, proven, matches the original v1 behavior.
   *
   *   "ode_rk4" — continuous-time propagation via classical 4th-order
   *     Runge-Kutta. Each edge's dynamics becomes a dx/dt rate (see
   *     `ode-dynamics.ts`); the integrator evolves all nodes in
   *     lockstep over `timesteps` time units with 40 substeps per
   *     time unit. Tier 5 math — real numerical integration of a
   *     continuous system. OPT-IN because (a) it's newer and stiff
   *     graphs can blow up on fixed-step, (b) the threshold dynamics
   *     are smoothed to be integrable which is a slight semantic
   *     change from the hard step in discrete mode.
   *
   * Distributions from the two integrators are NOT identical on the
   * same graph — they compute different (though related) quantities.
   * Callers should record which integrator produced a distribution
   * (see ProposalReadyEvent.distribution.provenance).
   */
  integrator?: "discrete" | "ode_rk4";
  /**
   * Phase 4 — wall-clock weekly trajectory mode.
   *
   * When set to N weeks, the engine runs N timesteps where each
   * step represents 1 week (so step t = day t × 7). At each step,
   * each edge's strength is multiplied by a temporal ramp factor
   * derived from EdgeSpec.temporal (onset / peak / persistence /
   * decay_kinetics). The result includes a `trajectory` array with
   * per-week distributions, in addition to the existing final-state
   * distribution.
   *
   * When unset, the engine uses the legacy `timesteps` semantics
   * (timesteps as iteration count, no temporal ramp). This is an
   * additive feature — pre-Phase-4 callers see no change in output.
   *
   * Compatible with both "discrete" and "ode_rk4" integrators; the
   * ramp multiplier is applied to the per-edge strength regardless of
   * integrator (the ODE path receives the ramped strength as input).
   */
  weeklyHorizon?: number | null;
}

export interface NodeDistribution {
  nodeId: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
  /** Raw samples — useful for downstream viz or cross-node joint distributions. */
  samples: number[];
}

export interface NodeWeeklyDistribution {
  nodeId: string;
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
}

export interface WeeklyTrajectoryEntry {
  /** 1-indexed week number (week 0 = baseline, omitted from trajectory
   *  to reduce payload — callers can derive baseline from priors). */
  week: number;
  /** Per-node distribution snapshot at the END of this week. Mirrors
   *  NodeDistribution but without the raw `samples` array (memory). */
  nodes: NodeWeeklyDistribution[];
}

export interface SimulationResult {
  iterations: number;
  timesteps: number;
  seed: number;
  nodes: NodeDistribution[];
  /** Milliseconds the full simulation took. Useful for cost budgeting. */
  durationMs: number;
  /** Which integrator produced these samples. Echoed so downstream
   *  callers can stamp the right provenance on their event payloads
   *  (e.g. ProposalReadyEvent.distribution.provenance). */
  integrator: "discrete" | "ode_rk4";
  /** Phase 4 — per-week trajectory snapshot. Populated only when
   *  `weeklyHorizon` was set on the spec. Each entry is the
   *  distribution AT THE END of that week. The last entry's
   *  distributions match `nodes[]` (modulo the missing `samples`
   *  field) — they're the same final-state values, surfaced both
   *  ways for caller convenience. */
  trajectory?: WeeklyTrajectoryEntry[];
  /** Echoed so callers can stamp provenance on prediction rows. */
  weeklyHorizon?: number | null;
}

const DEFAULT_ITERATIONS = 1000;
const DEFAULT_TIMESTEPS = 10;
const DEFAULT_SEED = 42;

/**
 * Main entry point. Runs N iterations of the causal subgraph and
 * returns per-node distributions. Pure function — no side effects,
 * no external state.
 */
export function runMonteCarlo(spec: SimulationSpec): SimulationResult {
  const iterations = spec.iterations ?? DEFAULT_ITERATIONS;
  // Phase 4 — when weeklyHorizon is set, each timestep represents one
  // week of wall-clock time (and we record per-week distributions for
  // the trajectory output). When unset, legacy semantics apply
  // (timesteps as iteration count).
  const weeklyHorizon = spec.weeklyHorizon ?? null;
  const timesteps =
    weeklyHorizon !== null && weeklyHorizon > 0
      ? Math.floor(weeklyHorizon)
      : (spec.timesteps ?? DEFAULT_TIMESTEPS);
  const isWeeklyMode = weeklyHorizon !== null && weeklyHorizon > 0;
  const seed = spec.seed ?? DEFAULT_SEED;
  const integrator = spec.integrator ?? "discrete";
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const rng = makeSeededRng(seed);
  const samplesByNode = new Map<string, number[]>();
  for (const n of spec.nodes) samplesByNode.set(n.id, []);

  // Phase 4 — per-week per-node sample arrays. Pre-allocate when
  // weeklyHorizon is set; otherwise leave empty. Indexed
  // [weekIndex (0-based, week 1 is index 0)][nodeIndex] → sample value.
  // Memory: iterations × weeks × nodes — typically <10MB at default
  // sizes. Skipped when not in weekly mode to keep zero-overhead path.
  const weeklySamples: Array<Map<string, number[]>> = isWeeklyMode
    ? Array.from({ length: timesteps }, () => {
        const m = new Map<string, number[]>();
        for (const n of spec.nodes) m.set(n.id, []);
        return m;
      })
    : [];

  // Index edges by target so propagation is O(edges × timesteps).
  const incoming = new Map<string, EdgeSpec[]>();
  for (const e of spec.edges) {
    const list = incoming.get(e.targetId) ?? [];
    list.push(e);
    incoming.set(e.targetId, list);
  }

  for (let i = 0; i < iterations; i++) {
    // Fresh starting values per iteration.
    const values = new Map<string, number>();
    for (const n of spec.nodes) {
      const raw = n.priorMean + sampleNormal(rng) * n.priorStdDev;
      values.set(n.id, clamp(raw, n.min, n.max));
    }

    // ── Phase 3 §4.2 — per-iteration conditional-edge sampling ──
    //
    // Roll the conditionGate Bernoulli ONCE per iteration per
    // conditional edge — the result holds across all timesteps for
    // that iteration. Otherwise re-rolling each timestep would dilute
    // the gate's signal: an edge with gate=0.5 would effectively fire
    // every iteration with high probability over 10 steps, which is
    // the opposite of what conditional polarity is supposed to mean.
    //
    // Non-conditional edges always fire (activeEdges entry = true).
    // Edges without a gate get a 0.5 default — see EdgeSpec doc.
    const activeEdges = new Map<EdgeSpec, boolean>();
    for (const edge of spec.edges) {
      if (edge.polarity !== "conditional") {
        activeEdges.set(edge, true);
        continue;
      }
      const gate = clamp01(edge.conditionGate ?? 0.5);
      activeEdges.set(edge, rng() < gate);
    }

    // ── Integrator dispatch ────────────────────────────────────────
    // Both paths: sample initial conditions above, evolve them
    // forward, record final value per node. The difference is HOW
    // they evolve — discrete scalar multiplication vs. continuous
    // ODE integration. Tier 4 vs. Tier 5.
    //
    // Phase 4 — when weekly mode is active, only the discrete path
    // can record per-week distributions (the ODE integrator returns
    // a single final state per call). We force discrete in weekly
    // mode regardless of the requested integrator; the result's
    // `integrator` field is stamped accordingly so callers can tell.
    let finalState: Map<string, number>;
    if (integrator === "ode_rk4" && !isWeeklyMode) {
      // Lazy import is fine — this is a hot loop but the import is
      // hoisted by the bundler. Keeps the discrete path's cold-start
      // cost identical to pre-R3 when ODE isn't used.
      const { integrateRK4 } = odeIntegratorModule();
      finalState = integrateRK4({
        nodes: spec.nodes.map((n) => ({
          id: n.id,
          min: n.min,
          max: n.max,
        })),
        edges: spec.edges.map((e) => {
          const polarSign = e.polarity === "negative" ? -1 : 1;
          return {
            sourceId: e.sourceId,
            targetId: e.targetId,
            strength: e.strength * polarSign,
            dynamics: e.dynamics,
            params: e.params,
            active: activeEdges.get(e) !== false,
          };
        }),
        initial: values,
        tMax: timesteps, // timesteps reinterpreted as total integration time
        steps: Math.max(40, timesteps * 4), // ≥40 substeps for 4th-order accuracy
      });
    } else {
      // Propagate effects through `timesteps` rounds. Each round reads
      // the prior round's state and writes new state so all effects
      // apply simultaneously (synchronous update — matches spreadsheet
      // intuition better than asynchronous for small graphs).
      //
      // Phase 4 — in weekly mode, t represents wall-clock weeks; each
      // edge's strength gets multiplied by a temporal ramp factor
      // evaluated at day = (t+1) × 7 (we use end-of-week for the
      // distribution snapshot). Edges without temporal data ramp
      // identically (factor = 1) so the math is unchanged for them.
      let state = new Map(values);
      for (let t = 0; t < timesteps; t++) {
        const next = new Map(state);
        const tDays = isWeeklyMode ? (t + 1) * 7 : null;
        for (const node of spec.nodes) {
          const prior = state.get(node.id) ?? 0;
          const edges = incoming.get(node.id) ?? [];
          if (edges.length === 0) {
            // No inbound edges — value persists (minus any self-decay
            // the node's own outbound carries can't influence itself here).
            continue;
          }
          let contribution = 0;
          for (const edge of edges) {
            // Skip conditional edges that didn't fire this iteration.
            if (activeEdges.get(edge) === false) continue;
            const src = state.get(edge.sourceId) ?? 0;
            const polarSign = edge.polarity === "negative" ? -1 : 1;
            // Phase 4 — temporal ramp multiplier (1.0 outside weekly
            // mode or when the edge has no temporal data, so legacy
            // behavior is unchanged).
            const ramp =
              tDays !== null && edge.temporal
                ? temporalRampFactor(tDays, edge.temporal)
                : 1;
            // Migration 20260509_edges_causal_status — Pearl-hierarchy
            // downweight. Correlational-only edges contribute at 40%
            // strength; plausible_causal at 70%; established_causal
            // at 100%. The codebase's previous implicit assumption
            // (every edge treated as established_causal) is now
            // explicit and tunable per row.
            const causalWeight = causalTrustWeight(edge.causalStatus);
            // Migration 20260509_condition_modulators — per-patient
            // calibration. 1.0 default = no modulation; values < 1
            // dampen, > 1 amplify. Composed by the wrapper from all
            // condition_modulator rows that match the active
            // subject's conditions.
            const condMult =
              typeof edge.conditionMultiplier === "number"
                ? edge.conditionMultiplier
                : 1;
            const effect = applyDynamics(
              edge.dynamics,
              src,
              edge.strength * polarSign * ramp * causalWeight * condMult,
              edge.params,
            );
            contribution += effect;
          }
          // Blend prior + contribution. For v1 we use a damped
          // additive update: target_new = prior + contribution / N-steps.
          // Divides by timesteps so total injected magnitude is
          // independent of simulation resolution.
          const raw = prior + contribution / timesteps;
          next.set(node.id, clamp(raw, node.min, node.max));
        }
        state = next;

        // Phase 4 — record per-week samples for trajectory output.
        if (isWeeklyMode) {
          const weekBucket = weeklySamples[t];
          for (const node of spec.nodes) {
            weekBucket.get(node.id)!.push(state.get(node.id) ?? 0);
          }
        }
      }
      finalState = state;
    }

    // Record final state for this iteration.
    for (const node of spec.nodes) {
      samplesByNode.get(node.id)!.push(finalState.get(node.id) ?? 0);
    }
  }

  const nodes: NodeDistribution[] = spec.nodes.map((n) => {
    const samples = samplesByNode.get(n.id)!;
    return {
      nodeId: n.id,
      ...summarize(samples),
      samples,
    };
  });

  // Phase 4 — build the per-week trajectory array. Skipped when not
  // in weekly mode so the result shape is identical to pre-Phase-4
  // for legacy callers.
  let trajectory: WeeklyTrajectoryEntry[] | undefined = undefined;
  if (isWeeklyMode) {
    trajectory = weeklySamples.map((bucket, idx) => ({
      week: idx + 1,
      nodes: spec.nodes.map((n) => {
        const samples = bucket.get(n.id) ?? [];
        const summary = summarize(samples);
        return {
          nodeId: n.id,
          p10: summary.p10,
          p50: summary.p50,
          p90: summary.p90,
          mean: summary.mean,
          stddev: summary.stddev,
        };
      }),
    }));
  }

  const endedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  return {
    iterations,
    timesteps,
    seed,
    nodes,
    durationMs: Math.round(endedAt - startedAt),
    // When weekly mode is active we override the integrator to discrete
    // (the ODE branch can't record per-step state). Stamp accordingly.
    integrator: isWeeklyMode ? "discrete" : integrator,
    trajectory,
    weeklyHorizon,
  };
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Phase 4 — temporal ramp factor.
 *
 * Returns a multiplier in [0, 1] for an edge's strength evaluated at
 * wall-clock day `tDays`. Models:
 *
 *   - 0 before onset: the effect hasn't started yet
 *   - linear ramp 0 → 1 from onset_days to peak_days
 *   - 1 (full strength) from peak through peak + persistence
 *   - decay shape after that:
 *       * "sustained"      — stays at 1 (no decay)
 *       * "linear"         — linear taper to 0 over another `persistence_days`
 *       * "exponential"    — half-life = persistence/2 by convention
 *       * "biphasic"       — fast drop to 0.3 then plateau
 *       * "unknown"/null   — treated as "sustained" (conservative; the
 *                            literature didn't characterize decay)
 *
 * Soft defaults when fields missing: onset = 0 (immediate), peak = 0
 * (instant ramp), persistence = ∞ (no decay phase), decay = "sustained".
 *
 * Returned value clamped to [0, 1] for safety.
 */
export function temporalRampFactor(
  tDays: number,
  temporal: EdgeTemporalSpec,
): number {
  const onset = numOr(temporal.onset_days, 0);
  const peakRaw = numOr(temporal.peak_days, 0);
  const peak = Math.max(peakRaw, onset);
  const persistence = numOr(temporal.persistence_days, Infinity);
  const decay = temporal.decay_kinetics ?? "sustained";

  if (tDays < onset) return 0;
  // Ramp-up phase.
  if (tDays <= peak) {
    if (peak <= onset) return 1; // instant ramp
    const v = (tDays - onset) / (peak - onset);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  // Sustained phase.
  const persistEnd = peak + persistence;
  if (tDays <= persistEnd) return 1;
  // Decay phase.
  const tAfter = tDays - persistEnd;
  switch (decay) {
    case "sustained":
    case "unknown":
      return 1;
    case "linear": {
      // Decay window same length as persistence — convention; the
      // literature usually doesn't separate the two so we tie them.
      // After that the contribution is 0.
      const decayWindow = persistence > 0 && Number.isFinite(persistence)
        ? persistence
        : 30;
      const v = 1 - tAfter / decayWindow;
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    case "exponential": {
      // Half-life = persistence / 2 by convention. After 5 half-lives
      // the contribution is below 3% — effectively zero.
      const halfLife =
        Number.isFinite(persistence) && persistence > 0
          ? persistence / 2
          : 30;
      return Math.pow(0.5, tAfter / halfLife);
    }
    case "biphasic": {
      // Fast initial drop in first 25% of persistence, then plateau
      // at 30% of full strength. Captures the "quick acute drop, slow
      // chronic tail" shape common in neuro / sleep studies.
      const fastWindow =
        Number.isFinite(persistence) && persistence > 0
          ? persistence * 0.25
          : 7;
      if (tAfter < fastWindow) {
        const v = 1 - 0.7 * (tAfter / fastWindow);
        return v < 0 ? 0 : v > 1 ? 1 : v;
      }
      return 0.3;
    }
    default:
      return 1;
  }
}

function numOr(n: number | null | undefined, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/**
 * Apply an edge-dynamics function: given a source value + strength +
 * optional params, return the contribution to the target.
 */
function applyDynamics(
  kind: EdgeDynamics,
  source: number,
  strength: number,
  params?: Record<string, number>,
): number {
  switch (kind) {
    case "linear":
      return strength * source;
    case "threshold": {
      const thr = params?.threshold ?? 0.5;
      return source >= thr ? strength : 0;
    }
    case "compounding": {
      // Geometric: small repeated-effect style. `rate` defaults to the
      // strength itself; treating strength as a per-step multiplier.
      const rate = params?.rate ?? strength;
      return source * rate;
    }
    case "decay": {
      // Half-life in timesteps — contribution erodes each step.
      const halfLife = params?.halfLife ?? 5;
      const factor = Math.pow(0.5, 1 / Math.max(halfLife, 0.001));
      return -(1 - factor) * source;
    }
    case "exponential": {
      // Saturation curve: small source values get amplified, large
      // ones approach the cap. Keeps values bounded for chain graphs.
      return strength * Math.log1p(Math.max(source, 0));
    }
    default:
      return strength * source;
  }
}

/**
 * Pearl-hierarchy trust weight per edge. Multiplied into the per-step
 * contribution so the simulator stops treating measured associations
 * as if they were proven causal effects.
 *
 * The values are deliberate, conservative defaults — they encode
 * "treat correlational evidence at less than half the propagation
 * weight of established causal evidence." Tunable in one place if
 * domain calibration suggests different defaults; today they're
 * baked because there's no per-domain config layer yet.
 *
 * established_causal / null → 1.0 — propagate at full strength
 * plausible_causal           → 0.7 — propagate but flag uncertainty
 * correlational_only         → 0.4 — stiff downweight; surface warning
 *
 * Source: Migration 20260509_edges_causal_status. Read in the hot loop
 * of runMonteCarlo.
 */
function causalTrustWeight(
  status:
    | "established_causal"
    | "plausible_causal"
    | "correlational_only"
    | null
    | undefined,
): number {
  switch (status) {
    case "correlational_only":
      return 0.4;
    case "plausible_causal":
      return 0.7;
    case "established_causal":
    case null:
    case undefined:
    default:
      return 1.0;
  }
}

/** Clamp to [0, 1]. Used for probability gates (conditionGate). */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Clamp to [min, max] when either bound is defined. */
function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === "number" && v < min) v = min;
  if (typeof max === "number" && v > max) v = max;
  return v;
}

/**
 * Box-Muller transform — turns 2 uniform samples into 1 normal sample.
 * We return a single-sample function; the discarded second value is
 * cheap relative to the iteration count.
 */
function sampleNormal(rng: () => number): number {
  let u1 = rng();
  let u2 = rng();
  if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
  if (u2 <= Number.EPSILON) u2 = Number.EPSILON;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Mulberry32 — 32-bit seedable PRNG. Deterministic, fast, adequate
 * for MC simulation where we don't need crypto-grade randomness.
 */
function makeSeededRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compute {p10, p50, p90, mean, stddev} from a sample array. */
function summarize(samples: number[]): {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stddev: number;
} {
  if (samples.length === 0) {
    return { p10: 0, p50: 0, p90: 0, mean: 0, stddev: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p50 = quantile(sorted, 0.5);
  const p90 = quantile(sorted, 0.9);
  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  const variance =
    samples.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / samples.length;
  const stddev = Math.sqrt(variance);
  return { p10, p50, p90, mean, stddev };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
