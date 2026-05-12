-- ── condition_modulators (Schema dep #8 from environment-definition.ts) ──
--
-- Per-(condition_key, target_edge_id) effect-size multipliers from
-- literature, applied at simulation time when the active subject's
-- conditions match. This is the LOAD-BEARING migration for personalized
-- predictions — the single biggest fidelity gap in the codebase today.
--
-- The problem this solves:
--
--   subjects.conditions JSONB exists. The simulator does not read it.
--   "Resident Post-Call at 3am" with {sleep_h: 0, stress: 7, caffeine: 200}
--   gets exactly the same prediction for "30 min/wk aerobic exercise"
--   as "Healthy Young Adult" with {sleep_h: 8, stress: 2, caffeine: 0}.
--   This is a silent personalization failure — predictions look
--   confident but every persona collapses to the population mean.
--
-- How this fixes it:
--
--   For each documented (condition, edge) pair where literature
--   establishes a population-level effect-size modifier, we store a
--   row with the multiplier as a p10/p50/p90 triple.
--
--   At simulation time, the engine joins the active subject's
--   conditions against this table and multiplies matching edges'
--   strength by the modulator's p50 (sampled from p10/p90 per
--   Monte Carlo iteration when uncertainty propagation is enabled).
--
--   E.g. "post_chemo_24mo" × edge "aerobic_exercise → BDNF" might
--   carry multiplier_p50=0.55 sourced from Janelsins 2017 — meaning
--   post-chemo patients have ~55% of the BDNF response that healthy
--   controls do. The simulator no longer overpromises recovery.
--
-- Lifecycle:
--
--   This migration creates the empty table. Initial seeding requires
--   either:
--     (a) A research extraction pipeline that mines published papers
--         for population × intervention × outcome modifiers, or
--     (b) A starter library of ~50 well-established modulators for
--         common conditions in the cognitive-performance domain
--         (sleep deprivation, post-chemo, age, chronic stress, etc.)
--   Both are follow-on tickets. Until then, the aggregator's
--   `applied_modulators[]` returns empty for every space and the
--   environment page surfaces "0/N conditions calibrated" as an
--   honest signal that personalization is not yet running.
--
-- Read by:
--   - src/lib/environment/aggregate-environment-definition.ts
--     (InitialStateDistribution.applied_modulators[])
--   - Future simulator hook at src/lib/simulation/monte-carlo.ts
--     (apply matching modulators to edge strengths before propagation)

create table if not exists public.condition_modulators (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,

  -- The condition key this modulator applies to. Matches the keys
  -- found in subjects.conditions JSONB (e.g., "sleep_h", "post_chemo",
  -- "age_decade", "chronic_stress"). Free-form text — the application
  -- layer normalizes naming, not the schema.
  condition_key text not null,

  -- Optional: when the modulator only applies for certain values of
  -- the condition. E.g., condition_key="sleep_h", value_match="<4"
  -- means the modulator activates only when sleep_h < 4. NULL means
  -- "any value of this condition triggers the modulator."
  --
  -- Match semantics (resolved at simulation time):
  --   numeric op:    "<4", "<=4", ">=8", ">8"
  --   range:         "[4,7]" (inclusive)
  --   exact:         "=true", "=post_chemo_24mo"
  --   set:           "{post_chemo_6mo, post_chemo_24mo}"
  -- NULL = always-on for any value of the condition.
  value_match text,

  -- The edge whose strength is modulated.
  target_edge_id uuid not null references public.edges(id) on delete cascade,

  -- The multiplier triple. p50 is the central estimate, p10/p90 are
  -- the 80% credible interval boundaries from the meta-analysis.
  -- Constraint: p10 ≤ p50 ≤ p90.
  --
  -- Magnitude bound at 5x: no published modulator should multiply
  -- effect by more than 5x; if literature suggests so, it's likely
  -- a category error (e.g., the "modulator" is really a different
  -- mechanism that needs its own edge).
  --
  -- Convention: a multiplier of 1.0 means "no modulation" (default
  -- if no row exists). 0.5 means "this condition halves the effect".
  -- Negative multipliers (effect-flipping) are NOT supported here —
  -- represent those as a separate conditional edge with opposite
  -- polarity instead, since the math behavior is meaningfully
  -- different.
  multiplier_p10 numeric not null
    check (multiplier_p10 >= 0 and multiplier_p10 <= 5),
  multiplier_p50 numeric not null
    check (multiplier_p50 >= 0 and multiplier_p50 <= 5),
  multiplier_p90 numeric not null
    check (multiplier_p90 >= 0 and multiplier_p90 <= 5),
  check (multiplier_p10 <= multiplier_p50),
  check (multiplier_p50 <= multiplier_p90),

  -- Provenance: which evidence_registries rows support this modulator.
  -- The aggregator surfaces these in the drawer's "Applied modulators"
  -- section so the user can audit the source.
  source_evidence_ids uuid[] not null default '{}',

  -- Optional: free-text rationale + population label.
  rationale text,
  population_label text,

  -- Audit.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One modulator per (space, condition_key, value_match, target_edge).
  -- Different value_match clauses on the same condition are separate
  -- rows (e.g., one for sleep_h<4, another for sleep_h<6).
  unique (space_id, condition_key, value_match, target_edge_id)
);

-- ── Indexes ──

-- Hot path: simulator joining (active conditions × edges in the run).
create index if not exists condition_modulators_space_condition_idx
  on public.condition_modulators (space_id, condition_key);

-- Reverse path: drawer "what modulators apply to THIS edge?"
create index if not exists condition_modulators_target_edge_idx
  on public.condition_modulators (target_edge_id);

-- GIN for evidence-driven queries: "which modulators were sourced
-- from this paper?" — used by the research-revisit pipeline.
create index if not exists condition_modulators_evidence_idx
  on public.condition_modulators using gin (source_evidence_ids);

-- ── RLS ──

alter table public.condition_modulators enable row level security;

drop policy if exists "condition_modulators_select" on public.condition_modulators;
create policy "condition_modulators_select" on public.condition_modulators
  for select using (
    space_id in (select id from public.spaces where user_id = auth.uid())
  );

drop policy if exists "condition_modulators_insert" on public.condition_modulators;
create policy "condition_modulators_insert" on public.condition_modulators
  for insert with check (
    space_id in (select id from public.spaces where user_id = auth.uid())
  );

drop policy if exists "condition_modulators_update" on public.condition_modulators;
create policy "condition_modulators_update" on public.condition_modulators
  for update using (
    space_id in (select id from public.spaces where user_id = auth.uid())
  );

drop policy if exists "condition_modulators_delete" on public.condition_modulators;
create policy "condition_modulators_delete" on public.condition_modulators
  for delete using (
    space_id in (select id from public.spaces where user_id = auth.uid())
  );

-- ── updated_at trigger ──

create or replace function public.set_condition_modulators_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_condition_modulators_updated_at
  on public.condition_modulators;
create trigger trg_condition_modulators_updated_at
  before update on public.condition_modulators
  for each row execute function public.set_condition_modulators_updated_at();

-- ── Comments ──

comment on table public.condition_modulators is
  'Per-(condition_key, target_edge_id) effect-size multipliers applied at '
  'simulation time when the active subject''s conditions match. Closes the '
  'silent personalization gap where subjects.conditions was unread by the '
  'simulator. Spec: src/types/environment-definition.ts schema dep #8.';

comment on column public.condition_modulators.condition_key is
  'Matches keys in subjects.conditions JSONB (e.g., "sleep_h", "post_chemo"). '
  'Free-form text; application layer normalizes.';

comment on column public.condition_modulators.value_match is
  'Optional value-condition for activation (e.g., "<4", ">=8", "[4,7]", '
  '"=post_chemo_24mo"). NULL = always-on for any value of the condition.';

comment on column public.condition_modulators.multiplier_p50 is
  'Central effect-size multiplier. 1.0 = no modulation. 0.5 = effect halved. '
  '2.0 = effect doubled. Bounded [0, 5] — outside this range likely indicates '
  'a different mechanism that needs its own edge.';

comment on column public.condition_modulators.source_evidence_ids is
  'Evidence registry rows supporting this modulator. Surfaces in the '
  'environment page drawer as the audit trail.';
