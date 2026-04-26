-- ── Variant outcome scores (Phase 3 — VP Project downstream reality) ──
--
-- The "downstream reality" panel on the VP Project report answers:
-- "once we varied the independent variables, what latent outcome
-- dimensions differentiated the variants?"
--
-- These are NOT taxonomy.outcome_axes (those are chosen up-front by
-- the inferrer — quality/lift/tokens/cost). Latent variables are
-- DISCOVERED after materialization by looking across the variant set
-- and asking "what hidden dimension explains the spread?". Examples:
-- "specificity", "emotional_tone", "structural_rigor", "time-to-first-
-- token", "novelty". The finder agent names them; the widget renders
-- them as columns of a variant × latent-variable heatmap.
--
-- Two tables because:
--   • `latent_variables` — one row per discovered dimension, per
--     space. Named by the finder agent. Gets a description +
--     accent color so the heatmap header can render consistently.
--   • `variant_outcome_scores` — one row per (variant × latent
--     variable). Score is 0..1 (where the variant lands on this
--     dimension); `evidence` carries the agent's 1-2 sentence
--     rationale shown on cell hover.
--
-- Wiring order:
--   writer-path completes → latent_variable_finder agent runs →
--     INSERT latent_variables (3-5 dimensions) + for each variant
--     in scope, INSERT variant_outcome_scores (one per dimension).
--
-- RLS: own-only via space_id → spaces.user_id (same pattern as
-- experiment_taxonomies from the 20260422 migration).

create table if not exists latent_variables (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,

  -- Stable snake-case slug. URL/telemetry-safe. Primary dedup key.
  key text not null,
  -- Title-case display label shown as the heatmap column header.
  label text not null,
  -- One-sentence definition — rendered as the column tooltip.
  description text not null default '',
  -- Hex accent for the column header band + chip.
  color text not null default '#6366f1',

  -- Audit trail — which agent proposed this dimension + its
  -- self-reported confidence. The widget surfaces confidence as
  -- a "needs review" badge when low.
  discovered_by text not null default 'latent_variable_finder_v1',
  confidence numeric(4, 3),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One (space, key) row. The finder upserts on re-runs so adding
  -- more variants can sharpen existing dimensions without duplicating.
  unique (space_id, key)
);

create index if not exists idx_latent_variables_space
  on latent_variables(space_id);

-- ── Variant × latent-variable scores ────────────────────────────────
--
-- One row per cell of the downstream-reality heatmap. Score is the
-- finder agent's assessment of where the variant lands on this
-- dimension, in 0..1 (normalized so columns can be compared even
-- when the underlying concept is non-numeric).

create table if not exists variant_outcome_scores (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references experiment_variants(id) on delete cascade,
  -- Denormalized for RLS efficiency (checked against spaces.user_id
  -- without a join through experiment_variants on every row read).
  space_id uuid not null references spaces(id) on delete cascade,
  latent_variable_id uuid not null references latent_variables(id) on delete cascade,

  -- Where this variant lands on this dimension. 0 = low end, 1 = high.
  -- "High" is defined by the latent variable's own semantics — the
  -- agent normalizes before writing.
  score numeric(5, 4) not null,

  -- 1-2 sentence rationale from the agent. Shown on cell hover.
  evidence text,

  scored_at timestamptz not null default now(),

  unique (variant_id, latent_variable_id)
);

create index if not exists idx_variant_outcome_scores_variant
  on variant_outcome_scores(variant_id);
create index if not exists idx_variant_outcome_scores_space
  on variant_outcome_scores(space_id);
create index if not exists idx_variant_outcome_scores_lv
  on variant_outcome_scores(latent_variable_id);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table latent_variables enable row level security;
alter table variant_outcome_scores enable row level security;

create policy latent_variables_select_own on latent_variables for select
  using (exists (
    select 1 from spaces s
    where s.id = latent_variables.space_id
      and s.user_id = auth.uid()
  ));
create policy latent_variables_insert_own on latent_variables for insert
  with check (exists (
    select 1 from spaces s
    where s.id = latent_variables.space_id
      and s.user_id = auth.uid()
  ));
create policy latent_variables_update_own on latent_variables for update
  using (exists (
    select 1 from spaces s
    where s.id = latent_variables.space_id
      and s.user_id = auth.uid()
  ));
create policy latent_variables_delete_own on latent_variables for delete
  using (exists (
    select 1 from spaces s
    where s.id = latent_variables.space_id
      and s.user_id = auth.uid()
  ));

create policy variant_outcome_scores_select_own on variant_outcome_scores for select
  using (exists (
    select 1 from spaces s
    where s.id = variant_outcome_scores.space_id
      and s.user_id = auth.uid()
  ));
create policy variant_outcome_scores_insert_own on variant_outcome_scores for insert
  with check (exists (
    select 1 from spaces s
    where s.id = variant_outcome_scores.space_id
      and s.user_id = auth.uid()
  ));
create policy variant_outcome_scores_update_own on variant_outcome_scores for update
  using (exists (
    select 1 from spaces s
    where s.id = variant_outcome_scores.space_id
      and s.user_id = auth.uid()
  ));
create policy variant_outcome_scores_delete_own on variant_outcome_scores for delete
  using (exists (
    select 1 from spaces s
    where s.id = variant_outcome_scores.space_id
      and s.user_id = auth.uid()
  ));

-- ── updated_at trigger for latent_variables ─────────────────────────
-- `touch_updated_at()` is defined by 20260422_experiment_taxonomies.sql.

drop trigger if exists trg_latent_variables_updated_at on latent_variables;
create trigger trg_latent_variables_updated_at
  before update on latent_variables
  for each row execute procedure touch_updated_at();
