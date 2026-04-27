-- ── D1 · Entity measurability layer ──────────────────────────────────
--
-- Promotes entities from "named nouns" to "measurable variables" by
-- attaching a measurement spec to every fundamental/critical entity.
-- This is the foundational change called out in
-- docs/KG_DEPTH_CRITIQUE.md §9 (D1) — without a measurement schema on
-- entities, every other property in the optimization scorecard
-- (controllability gradients, hyperedges, time-to-effect, calibration)
-- is ungrounded because there is nothing concrete to control or
-- measure.
--
-- New columns on `entities`:
--
--   measurement_unit          text         e.g. "users/week", "%", "ms",
--                                          "session", "USD/MAU". null
--                                          for entities that aren't
--                                          quantifiable (epistemic /
--                                          relational categories).
--
--   measurement_scale         text(check)  continuous | ordinal |
--                                          categorical | binary | null
--                                          (null when not quantifiable).
--
--   measurement_protocol      jsonb        How to OBSERVE the variable.
--                                          Shape:
--                                            {
--                                              "instrument":   string  // "Mixpanel", "user survey", "server log"
--                                              "frequency":    string  // "daily", "per-session", "monthly"
--                                              "sample_unit":  string  // "user", "request", "transaction"
--                                              "error_bound":  string? // "±5%", "±2 events"
--                                              "latency":      string? // "real-time", "T+24h", "T+1 week"
--                                              "owner":        string? // "growth team", "self-report"
--                                              "notes":        string?
--                                            }
--                                          null when not yet specified.
--
--   measurement_cost_estimate  numeric      Approximate cost-to-measure
--                                          per observation, in arbitrary
--                                          but consistent units (the
--                                          decomposition prompt asks the
--                                          LLM to use USD-equivalent
--                                          minutes-of-engineering-work).
--                                          Allows cost-aware ranking of
--                                          which entities to instrument
--                                          first. null = unknown.
--
--   measurement_observability  text(check)  Categorical fallback when no
--                                          numeric scale exists.
--                                          directly_observable |
--                                          proxy_required |
--                                          inferred_only |
--                                          unobservable | null
--
-- Why a new column set instead of stuffing into manifold/parameters:
--
--   `manifold` is a 3-axis qualitative profile (strategic / operational
--   / epistemic) for ranking, not a measurement spec.
--
--   `parameters` is for lab-control parameters (K, tau, rho, alpha)
--   bound to the throughput simulation in lab-formulas.ts.
--
--   Measurement is its own concern — it answers "what variable does
--   this entity REPRESENT, in what unit, observed how, at what cost"
--   — and downstream consumers (controllability profiles in D3,
--   numerical calibration in numerical-calibration.ts, the
--   prediction_ledger calibration loop in D6) need it as a
--   first-class queryable surface, not buried inside a JSONB blob.
--
-- Required vs. optional:
--
--   The validator (see src/lib/validation/llm-validators.ts) treats
--   measurement_unit + measurement_scale as REQUIRED for entities with
--   importance ∈ {fundamental, critical} where entity_category is
--   quantifiable (concrete | abstract | process). For relational and
--   epistemic categories these stay optional — a "tradeoff" or
--   "assumption" doesn't have a unit.
--
--   measurement_protocol, measurement_cost_estimate, and
--   measurement_observability are always optional — present them when
--   we have the signal, leave null otherwise. Honesty over false
--   precision.
--
-- Backward compatibility:
--
--   All columns nullable. Existing rows continue to work. Validation
--   gating only fires on NEW decompositions where the new prompt is in
--   effect. Pre-migration entities will surface as "measurement
--   missing" in the UI (D1 follow-up: a backfill agent that proposes
--   measurement specs for existing fundamental/critical entities).

alter table public.entities
  add column if not exists measurement_unit text;

alter table public.entities
  add column if not exists measurement_scale text;

alter table public.entities
  add column if not exists measurement_protocol jsonb;

alter table public.entities
  add column if not exists measurement_cost_estimate numeric;

alter table public.entities
  add column if not exists measurement_observability text;

-- ── Constraints ──

alter table public.entities
  drop constraint if exists entities_measurement_scale_check;

alter table public.entities
  add constraint entities_measurement_scale_check
  check (
    measurement_scale is null
    or measurement_scale in (
      'continuous',
      'ordinal',
      'categorical',
      'binary'
    )
  );

alter table public.entities
  drop constraint if exists entities_measurement_observability_check;

alter table public.entities
  add constraint entities_measurement_observability_check
  check (
    measurement_observability is null
    or measurement_observability in (
      'directly_observable',
      'proxy_required',
      'inferred_only',
      'unobservable'
    )
  );

alter table public.entities
  drop constraint if exists entities_measurement_cost_estimate_check;

alter table public.entities
  add constraint entities_measurement_cost_estimate_check
  check (
    measurement_cost_estimate is null
    or measurement_cost_estimate >= 0
  );

-- ── Indexes ──

-- Cheap "find entities the system can actually observe" filter.
create index if not exists entities_measurement_observability_idx
  on public.entities (space_id, measurement_observability)
  where measurement_observability is not null;

-- Lets the strategizer rank "which fundamental/critical entities are
-- still missing measurement metadata" without a full table scan.
create index if not exists entities_missing_measurement_idx
  on public.entities (space_id)
  where measurement_unit is null
    and importance in ('fundamental', 'critical');

-- GIN on the protocol JSON so we can later query e.g. "find every
-- entity instrumented via Mixpanel."
create index if not exists entities_measurement_protocol_gin_idx
  on public.entities using gin (measurement_protocol)
  where measurement_protocol is not null;

-- ── Comments ──

comment on column public.entities.measurement_unit is
  'Unit the entity is measured in. Required for fundamental/critical entities of category concrete/abstract/process. null for relational/epistemic categories or pre-D1 rows.';

comment on column public.entities.measurement_scale is
  'Measurement scale type: continuous | ordinal | categorical | binary. Required when measurement_unit is set. Drives downstream simulation (continuous → ODE/MC numeric path; categorical → Bernoulli gate).';

comment on column public.entities.measurement_protocol is
  'JSONB describing HOW to observe the variable. Shape: { instrument, frequency, sample_unit, error_bound?, latency?, owner?, notes? }. Optional — populated when known, null otherwise.';

comment on column public.entities.measurement_cost_estimate is
  'Approximate cost per observation, in USD-equivalent. Used by D3 controllability ranking + by the strategizer to prefer instrumenting cheap-to-measure leverage points first. Optional.';

comment on column public.entities.measurement_observability is
  'Categorical fallback when no numeric scale applies: directly_observable | proxy_required | inferred_only | unobservable. Helps the simulator know whether to MC-sample or treat as latent. Optional.';
