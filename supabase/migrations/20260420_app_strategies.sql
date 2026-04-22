-- Tier 3 of the App+Strategy Rigor sprint — per-app sub-strategies
--
-- Why this exists:
-- The global strategy emits an `infrastructure_proposal` per app — basically a
-- 1-paragraph "what this app is for." That's enough to render widgets but it's
-- not enough for the app to know:
--   - Which specific metrics to predict + at what horizons
--   - Which hypotheses to validate (experiment bank)
--   - Which simulation perturbations are meaningful for THIS app's domain
--   - How to refine the parent proposal's agent_specs based on real data
--   - What the per-app learning loop looks like
--
-- A sub-strategy is the global strategy's proposal for this app, expanded into
-- actionable detail. It is REFINEMENT, not REPLACEMENT — the parent strategy
-- still owns the macro logic; the sub-strategy fills in the per-app specifics.
--
-- Versioning: append-only. Each generation produces a new version row. Only
-- one is "active" at a time (status = 'active'); old ones become 'superseded'.
-- This mirrors strategy_snapshots so we get the same audit trail discipline.
--
-- Generation triggers (v1):
--   - Manual: POST /api/apps/:id/strategy (user clicks "regenerate")
--   - Deviation: escalate_to_research action also triggers regen (surprise
--     deviations are exactly the signal that says "the model's wrong about
--     this app's reality" — the sub-strategy needs to update)
--
-- Generation triggers (future):
--   - Inline at app creation (currently skipped to bound LLM cost)
--   - Scheduled cadence (e.g. weekly review of every active app)
--
-- Storage:
--   - One row per (app_id, version) in app_strategies
--   - app_strategy_versions is the same shape as app_versions — change-log
--     entries the agent loop can read to understand why a sub-strategy
--     evolved between revisions.

-- ── 1. app_strategies ────────────────────────────────────────────────────

create table if not exists public.app_strategies (
  id uuid primary key default gen_random_uuid(),

  -- Scope
  app_id uuid not null references public.apps(id) on delete cascade,
  -- Denormalized for query convenience — every per-space query that wants
  -- to enumerate sub-strategies for a space can do so without joining apps.
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Provenance — which global-strategy snapshot + which proposal this
  -- sub-strategy expands. NULL when the sub-strategy was synthesized
  -- without a parent (e.g. the user authored one manually before any
  -- global strategy existed).
  parent_strategy_snapshot_id uuid references public.strategy_snapshots(id) on delete set null,
  parent_proposal_id text,

  -- Versioning + lifecycle
  version int not null default 1,
  status text not null default 'active'
    check (status in ('draft', 'active', 'superseded', 'archived')),

  generated_at timestamptz not null default now(),
  -- Free-form attribution. Examples:
  --   "user:<uid>:manual"          — user clicked Generate
  --   "agent:reasoner"             — agent-driven
  --   "pipeline:deviation_trigger" — escalate_to_research kicked it
  --   "pipeline:auto_initial"      — first sub-strategy at app creation
  generated_by text not null,
  -- When the most recent deviation-driven regen happened. Lets the UI show
  -- "updated 3d ago in response to a deviation surprise." NULL when this
  -- version was generated for non-deviation reasons.
  last_deviation_trigger_at timestamptz,
  -- Free-form rationale for THIS specific generation event — surfaced in
  -- the change log so the user understands why the sub-strategy evolved.
  generation_rationale text,

  -- The sub-strategy content itself. JSONB shape owned by
  -- src/types/app-strategy.ts — validated at the API boundary.
  --
  -- Top-level keys (see AppStrategySpec for the full type):
  --   focused_objective      — { metric, baseline, target, horizon, rationale }
  --   prediction_spec        — { metrics_to_track[], default_horizon_days, default_confidence, deviation_thresholds, rationale }
  --   validation_spec        — { hypothesis_bank[], experiment_horizon_days, success_criteria, rationale }
  --   simulation_spec        — { perturbation_profiles[], scenario_seeds[], rationale }
  --   agent_role_refinements — { agent_id → { responsibility?, measurement_spec?, ... } } overrides
  --   learning_loop          — { leading_indicators[], pivot_criteria[], cadence }
  --   deviation_history      — { incorporated_signals[] } — when regen was triggered by deviations,
  --                            this records WHICH signals informed the new strategy
  spec jsonb not null,

  -- Optional snapshot of the parent proposal at generation time. Lets
  -- post-hoc analysis ask "what did the parent look like when we generated
  -- this sub-strategy?" without needing to dig through strategy_snapshots.
  parent_proposal_snapshot jsonb,

  -- Quality + validation summary computed at generation time.
  --   confidence: 0..1 — LLM self-reported confidence
  --   issues: array of validator warnings (similar to StrategyValidationIssue)
  quality jsonb not null default '{}'::jsonb,

  -- One active sub-strategy per app at a time. Enforced via partial unique
  -- index because (app_id) alone would also block historical 'superseded'
  -- rows. Status transitions to 'active' only when the prior 'active' has
  -- been moved to 'superseded' first (handled in the API).
  constraint app_strategies_unique_version unique (app_id, version)
);

-- Hot path: "give me the active sub-strategy for this app"
create unique index if not exists idx_app_strategies_active
  on public.app_strategies(app_id)
  where status = 'active';

-- Per-space enumeration (future "all sub-strategies for this space" page)
create index if not exists idx_app_strategies_space_status
  on public.app_strategies(space_id, status, generated_at desc);

-- Per-user (RLS owner check + cross-space audit views)
create index if not exists idx_app_strategies_user
  on public.app_strategies(user_id, generated_at desc);

-- Per-snapshot lineage — find every sub-strategy that descends from a
-- particular global strategy version
create index if not exists idx_app_strategies_parent_snapshot
  on public.app_strategies(parent_strategy_snapshot_id)
  where parent_strategy_snapshot_id is not null;

comment on table public.app_strategies is
  'Per-app sub-strategy: focused refinement of the global strategy''s '
  'infrastructure_proposal for one specific app. Holds the prediction / '
  'validation / simulation / agent-refinement specs the app needs to do '
  'real work, not just render. Append-only via versioning; one active '
  'row per app at a time.';

-- ── 2. app_strategy_versions (audit log) ────────────────────────────────

create table if not exists public.app_strategy_versions (
  id uuid primary key default gen_random_uuid(),
  app_strategy_id uuid not null references public.app_strategies(id) on delete cascade,
  app_id uuid not null references public.apps(id) on delete cascade,

  -- Mirrors app_versions.change_type for visual consistency with the
  -- app-side audit trail. Not all entries are user-edits; the loop adds
  -- entries when it regenerates, agents add entries when they refine.
  change_type text not null
    check (change_type in (
      'generated',
      'superseded',
      'agent_refined',
      'user_edit',
      'deviation_triggered',
      'archived'
    )),
  change_summary text,
  -- Optional structured diff — what changed vs. the prior version. NULL
  -- when this is the first generation (no prior to diff against).
  diff jsonb,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_app_strategy_versions_app_time
  on public.app_strategy_versions(app_id, changed_at desc);
create index if not exists idx_app_strategy_versions_strategy
  on public.app_strategy_versions(app_strategy_id, changed_at desc);

comment on table public.app_strategy_versions is
  'Append-only change log for app_strategies. Each row is an atomic edit '
  'event — a generation, a supersession, an agent refinement. Mirrors the '
  'app_versions discipline so the per-app audit trail is consistent across '
  'app + sub-strategy.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────

alter table public.app_strategies enable row level security;
alter table public.app_strategy_versions enable row level security;

drop policy if exists "owner_all_app_strategies" on public.app_strategies;
create policy "owner_all_app_strategies" on public.app_strategies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Versions inherit ownership through the parent app_strategies row.
-- Cheaper than carrying user_id on every version row + keeps the audit
-- trail tightly bound to the strategy row.
drop policy if exists "owner_all_app_strategy_versions" on public.app_strategy_versions;
create policy "owner_all_app_strategy_versions" on public.app_strategy_versions
  for all using (
    exists (
      select 1 from public.app_strategies s
      where s.id = app_strategy_versions.app_strategy_id
        and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.app_strategies s
      where s.id = app_strategy_versions.app_strategy_id
        and s.user_id = auth.uid()
    )
  );

-- Service role bypasses RLS — used by the deviation-trigger path and
-- by the sub-strategy generator when invoked from cron contexts.
