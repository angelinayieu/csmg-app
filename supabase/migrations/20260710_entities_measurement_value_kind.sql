-- ── Entities: measurement_value_kind ────────────────────────────────────
--
-- The "what kind of number is this?" classifier. Today an entity row
-- carries free-form `measurement_unit` text ("mg/dL", "hours", "count")
-- but no enum that tells the simulator how to bound, sample, or
-- aggregate the value. The aggregator falls back to continuous-unbounded
-- with a "review needed" warning when this column is null.
--
-- Eight values cover the practical surface of biological / behavioral /
-- cognitive measurement:
--
--   count         — discrete, ≥ 0, integer-valued (nights/week, episodes)
--   rate          — per-time-unit (cortisol mg/day, paces/min)
--   concentration — mass-per-volume (BDNF ng/mL); always ≥ 0
--   probability   — bounded [0, 1] (likelihood of impairment)
--   score         — domain-defined scalar (MoCA, PANSS, NIHSS); typically
--                   bounded but instrument-specific
--   duration      — time, ≥ 0 (sleep onset latency, episode length)
--   boolean       — discrete two-state (currently menstruating, on meds)
--   categorical   — discrete labels (intervention condition, blood type)
--
-- Read by:
--   - aggregate-environment-definition.ts → StateVariable.measurement_value_kind
--     and inferBounds() (probability → [0,1]; concentration → [0,∞];
--     boolean → [0,1]; etc.)
--   - simulator (planned): pick distribution family per kind (truncated
--     Normal for concentration, Beta for probability, Bernoulli for
--     boolean, etc.) instead of one-size-fits-all Normal sampling
--   - UI rendering: format the right way (1.4×10⁻⁹ for concentration,
--     "85%" for probability, "3.2 hours" for duration)

alter table public.entities
  add column if not exists measurement_value_kind text;

alter table public.entities
  drop constraint if exists entities_measurement_value_kind_check;

alter table public.entities
  add constraint entities_measurement_value_kind_check
  check (
    measurement_value_kind is null
    or measurement_value_kind in (
      'count',
      'rate',
      'concentration',
      'probability',
      'score',
      'duration',
      'boolean',
      'categorical'
    )
  );

create index if not exists entities_measurement_value_kind_idx
  on public.entities (space_id, measurement_value_kind)
  where measurement_value_kind is not null;

comment on column public.entities.measurement_value_kind is
  'The mathematical KIND of value this entity carries: count, rate, concentration, probability, score, duration, boolean, or categorical. Drives simulator sampling family + bounds enforcement + UI formatting. Distinct from measurement_unit (free text) and measurement_scale (continuous/ordinal/categorical/binary).';
