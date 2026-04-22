-- Capability registry — the stable primitive library for data-acquisition
-- planning. See project_twin_hierarchy + action-driven-strategy design doc.
--
-- Why this exists:
-- Strategies today propose mechanisms + apps that move metrics. They do NOT
-- reason about the multi-step processes required to COLLECT the data that
-- would de-risk the underlying model. The design goal is:
--
--   data_need → plan (DAG of steps) → step.capability invocation → predicted
--   return → actual return → deviation → capability prior update.
--
-- This migration adds the first layer (capability registry) + the structural
-- tables that future slices (planner, resolver extension, UI) hang off. It
-- deliberately does NOT touch prediction_ledger — the subject_kind discriminant
-- and plan_step_id FK are a separate slice so this migration stays reviewable.
--
-- Three design principles baked into the schema:
--
--  1. Capabilities are a GENERALIZED catalog of data-acquisition primitives.
--     People-outreach is one row; literature-synthesis, observation protocols,
--     and event-wait-and-capture are other rows. The planner must not privilege
--     any category — the attribute space (requires_human, perturbs_system,
--     one_shot, latency_kind, etc.) is what it reasons over.
--
--  2. Plans are DAGs, not linear sequences. A step can have parallel children,
--     fallback siblings (run on failure), and join parents (triangulation).
--     Encoded as an explicit plan_step_edges table rather than a parent_id
--     column so multi-parent joins are representable.
--
--  3. Priors live on the capability row (global-ish success_rate_by_context)
--     AND on capability_observations (per-space deviation history). The
--     project KG's world-model sharpens over time by reading both.

-- ── 1. capabilities ─────────────────────────────────────────────────────
--
-- Global-ish catalog. Seed rows have proposed_by_user_id = NULL and are
-- readable by everyone (via RLS). User-proposed capabilities (future) are
-- visible only to their owner until promoted.

create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),

  -- Stable key for code references. Seeds use snake_case; user-proposed
  -- rows can leave this null.
  slug text unique,

  -- Human-facing
  name text not null,
  description text not null,
  category text not null
    check (category in (
      'person_contact',        -- outreach, interview, referral chain
      'community_inquiry',     -- forum/subreddit/slack, aggregated replies
      'literature_research',   -- papers, patents, filings, archival
      'dataset_acquisition',   -- scrape, public dataset, API pull
      'direct_observation',    -- watching, counting, logging
      'instrumentation',       -- sensors, loggers, analytics install
      'experiment',            -- pilot, A/B, counterfactual probe
      'synthesis',             -- triangulation, decomposition, aggregation
      'temporal_capture'       -- event-wait, scheduled release capture
    )),

  -- What this capability typically yields. JSONB template the planner
  -- instantiates per invocation:
  --   { attributes: [{ name, kind: 'bool'|'int'|'float'|'enum'|'text',
  --                    expected_range?, enum_values?, confidence }],
  --     new_entities?: ['student_referral', ...],
  --     response_shape: 'sync'|'async'|'deferred' }
  yields jsonb not null,

  -- What must be true before this capability can be invoked. Planner uses
  -- this to recurse — unmet preconditions become sub-data-needs.
  --   [{ kind: 'entity_exists'|'contact_info_available'|'budget'|'consent'|
  --             'instrument_installed'|'data_access', description, soft? }]
  preconditions jsonb not null default '[]'::jsonb,

  -- Cost model. Not multiplied blindly — planner uses these for compound
  -- cost scoring and for Pareto-pruning plans that dominate others.
  cost_user_minutes_p50 int not null default 0,
  cost_user_minutes_p90 int not null default 0,
  cost_money_usd_p50 numeric not null default 0,
  cost_calendar_latency_days_p50 numeric not null default 0,
  cost_calendar_latency_days_p90 numeric not null default 0,

  -- Attribute flags that govern planner behavior. See design doc for why
  -- each one matters — these are NOT redundant with category.
  requires_human boolean not null default false,
  requires_agent boolean not null default false,
  requires_instrument boolean not null default false,
  requires_external_service boolean not null default false,

  -- Can this step be retried cleanly? (Cold-emailing the same PI 3x: no.)
  repeatable boolean not null default true,

  -- One-shot side effects — "first meeting," "announce the product." Planner
  -- treats these as expendable resources and warns before use.
  one_shot boolean not null default false,

  -- Does invoking this change the system being measured? (Asking a
  -- stakeholder their preference can shift it.) Planner avoids perturbing
  -- capabilities until the final stage and flags them in the UI.
  perturbs_system boolean not null default false,

  -- Yields structured data the resolver can tag numerically, or free-form
  -- qualitative? Drives which deviation_tag path the resolver takes.
  yields_structured_data boolean not null default false,

  -- Relational/social cost of invocation. "high" = consumes limited
  -- goodwill (cold-email senior person); "low" = mostly free (forum post).
  relational_cost text not null default 'none'
    check (relational_cost in ('none', 'low', 'medium', 'high')),

  -- How the response arrives. "sync" = immediate (scrape); "async" = bounded
  -- wait (email reply); "scheduled_event" = tied to a known future date.
  latency_kind text not null default 'sync'
    check (latency_kind in ('sync', 'async', 'scheduled_event')),

  -- Compound-success-rate priors by context. Keyed by context-descriptor
  -- strings the planner emits (e.g. "actor_type=pi;familiarity=cold"). The
  -- resolver updates these via the capability_observations rollup job.
  --   { "default": { success_rate: 0.55, sample_n: 128, updated_at: ... },
  --     "actor_type=pi;familiarity=cold": { success_rate: 0.18, ... } }
  success_priors jsonb not null default '{}'::jsonb,

  -- Yield-quality distribution — when the capability "succeeds," how
  -- complete is the data typically?
  --   { yield_completeness_p50: 0.7, yield_completeness_p90: 0.95 }
  yield_priors jsonb not null default '{}'::jsonb,

  -- Governance. NULL for seeded system capabilities; FK for user-proposed
  -- capabilities pending promotion. The seed migration asserts NULL.
  proposed_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'proposed', 'deprecated')),

  -- Free-form tags for planner prompts + UI filtering.
  tags text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_capabilities_status_category
  on public.capabilities(status, category);
create index if not exists idx_capabilities_slug
  on public.capabilities(slug) where slug is not null;

comment on table public.capabilities is
  'Generalized registry of data-acquisition primitives. A capability is '
  'one invocable step-type (cold-email a person, synthesize literature, '
  'wait for a scheduled event, etc.) with cost, yield, and prior metadata '
  'the planner reasons over. People-contact is one category among nine; '
  'the planner must not privilege any category.';

-- ── 2. data_needs ───────────────────────────────────────────────────────
--
-- A data_need is a first-class "open question" in the project KG. Seeded
-- from strategy prediction_spec / validation_spec at strategy-generation
-- time, and updated as confidence rises. The planner consumes the open
-- queue and generates acquisition_plans to close them.

create table if not exists public.data_needs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What we want to know. Either an entity-level need ("confirm whether
  -- this mechanism is load-bearing") or a metric-level need ("baseline
  -- value for tracker X"). At least one FK must be set.
  target_entity_id uuid references public.entities(id) on delete cascade,
  target_metric_tracker_id uuid references public.metric_trackers(id) on delete cascade,

  -- Human description of what's missing and why it matters. Shown in the
  -- "Open Data Needs" panel.
  question text not null,
  rationale text,

  -- Expected shape of the answer — structured so plans can match their
  -- yields against it:
  --   { kind: 'bool'|'int'|'float'|'enum'|'text'|'distribution',
  --     expected_range?, enum_values? }
  expected_answer_shape jsonb not null default '{}'::jsonb,

  -- Current confidence in whatever value we're carrying for this (0..1).
  -- A data_need with current_confidence = 0.9 is low priority; 0.2 is
  -- screaming for a plan.
  current_confidence numeric not null default 0
    check (current_confidence >= 0 and current_confidence <= 1),

  -- Priority from strategy context (0..1). Multiplied with
  -- (1 - current_confidence) in the planner's info-gain score.
  priority numeric not null default 0.5
    check (priority >= 0 and priority <= 1),

  -- Provenance — where this need came from.
  source_kind text not null
    check (source_kind in (
      'prediction_spec',      -- derived from strategy prediction_spec
      'validation_spec',      -- derived from strategy validation_spec
      'user_authored',        -- user added manually
      'planner_recursion',    -- generated as a precondition sub-need
      'agent_detected'        -- flagged by an agent run
    )),
  source_ref jsonb,           -- e.g. { strategy_snapshot_id, spec_path }

  -- Lifecycle
  status text not null default 'open'
    check (status in ('open', 'planning', 'in_flight', 'resolved', 'abandoned')),

  -- Aging — a need open for 60 days should decay in priority OR escalate.
  -- Policy is in the planner, not enforced here.
  first_opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_confidence numeric check (resolved_confidence is null or (resolved_confidence >= 0 and resolved_confidence <= 1)),

  -- At least one target must be set. (Not XOR — a need can target both
  -- an entity and its associated metric.)
  constraint data_needs_has_target check (
    target_entity_id is not null or target_metric_tracker_id is not null
  )
);

create index if not exists idx_data_needs_space_status
  on public.data_needs(space_id, status, priority desc);
create index if not exists idx_data_needs_entity
  on public.data_needs(target_entity_id) where target_entity_id is not null;
create index if not exists idx_data_needs_tracker
  on public.data_needs(target_metric_tracker_id) where target_metric_tracker_id is not null;
create index if not exists idx_data_needs_stale
  on public.data_needs(space_id, first_opened_at) where status = 'open';

comment on table public.data_needs is
  'First-class "open question" on the project KG. The planner generates '
  'acquisition_plans to close these; the resolver closes them when actual '
  'data arrives and confidence rises.';

-- ── 3. acquisition_plans ────────────────────────────────────────────────
--
-- A plan is a DAG of plan_steps rooted at one or more data_needs. Plans
-- are versioned — when a step surprises, the planner can re-plan the
-- downstream subgraph and write a new version rather than mutate the
-- original (audit trail for post-mortems).

create table if not exists public.acquisition_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Plans can close one or (with synergy) multiple data_needs.
  data_need_ids uuid[] not null default '{}',

  -- Human-facing one-liner the UI surfaces in the Pulse bar and the
  -- "Candidate Plans" panel. The planner writes this.
  title text not null,
  summary text,

  -- Versioning. Parent = previous version of this plan; null for the
  -- initial plan. Used for re-planning audit.
  parent_plan_id uuid references public.acquisition_plans(id) on delete set null,
  version int not null default 1,

  -- Scored axes the planner computes at generation time. Kept here (not
  -- re-derived) so the UI can rank plans without re-running the scorer.
  expected_info_gain numeric not null default 0
    check (expected_info_gain >= 0),
  expected_compound_success numeric not null default 0
    check (expected_compound_success >= 0 and expected_compound_success <= 1),
  expected_cost_user_minutes int not null default 0,
  expected_cost_money_usd numeric not null default 0,
  expected_calendar_latency_days numeric not null default 0,

  -- Novelty bonus (0..1) — plans composing capabilities this project
  -- hasn't used together get a small boost; prevents template collapse.
  novelty_score numeric not null default 0
    check (novelty_score >= 0 and novelty_score <= 1),

  -- Flags the UI surfaces. "contains_perturbing_step" warns the user;
  -- "contains_one_shot_step" warns that execution is irreversible.
  contains_perturbing_step boolean not null default false,
  contains_one_shot_step boolean not null default false,

  -- Lifecycle
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'approved', 'in_flight', 'resolved', 'abandoned', 'superseded')),

  -- Provenance
  generated_by text not null default 'planner:v1',
  rationale text,          -- why this plan over alternatives

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_acquisition_plans_space_status
  on public.acquisition_plans(space_id, status, created_at desc);
create index if not exists idx_acquisition_plans_parent
  on public.acquisition_plans(parent_plan_id) where parent_plan_id is not null;

comment on table public.acquisition_plans is
  'A DAG-of-steps plan for closing one or more data_needs. Versioned — '
  're-planning on step surprise writes a new row with parent_plan_id set.';

-- ── 4. plan_steps ───────────────────────────────────────────────────────
--
-- A plan_step is one capability invocation within a plan. The DAG
-- structure lives in plan_step_edges; this table holds the node data.

create table if not exists public.plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.acquisition_plans(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  capability_id uuid not null references public.capabilities(id),

  -- Instantiation. Which actor/target/params this invocation uses. Shape
  -- is capability-specific; the capability's `yields` template constrains
  -- what goes here.
  --   Example for person_cold_outreach:
  --     { target_actor_entity_id: "<uuid>", channel: "email",
  --       message_draft_ref: "<note_id>", sent_at: null }
  params jsonb not null default '{}'::jsonb,

  -- Predicted return (instantiated from capability.yields with planner's
  -- context-conditioned priors applied):
  --   { success_probability, response_window_days: [p10, p90],
  --     expected_attributes: [{ name, kind, expected_range/expected, confidence }],
  --     expected_new_entities: [...] }
  predicted_return jsonb not null default '{}'::jsonb,

  -- Actual return after execution. Same shape as predicted_return but
  -- populated from user-logged outcome. NULL until step resolves.
  actual_return jsonb,

  -- Per-step deviation, same tag vocabulary as prediction_ledger. Rolled
  -- up into capability_observations + the parent plan's deviation summary.
  deviation_tag text
    check (deviation_tag is null or deviation_tag in
      ('expected', 'regime_shift', 'surprise', 'qualitative', 'failed')),
  deviation_notes text,

  -- Which data_needs this step's output would close (subset of the plan's
  -- data_need_ids). Used for per-step info-gain attribution.
  closes_data_need_ids uuid[] not null default '{}',

  -- Lifecycle. A step is "blocked" when its parents haven't resolved yet;
  -- "ready" when all inbound edges are satisfied; "in_flight" once the
  -- user has started (or the agent dispatched) the work.
  status text not null default 'blocked'
    check (status in ('blocked', 'ready', 'in_flight', 'resolved', 'skipped', 'failed')),

  -- Execution stamps
  dispatched_at timestamptz,    -- when step went from ready → in_flight
  resolved_at timestamptz,      -- when actual_return landed

  -- Agent vs. human. When requires_human=true on the capability, this
  -- should also be 'human'. Tracked explicitly for analytics.
  executed_by text
    check (executed_by is null or executed_by in ('human', 'agent', 'instrument', 'external_service')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_plan_steps_plan
  on public.plan_steps(plan_id);
create index if not exists idx_plan_steps_status
  on public.plan_steps(space_id, status) where status in ('ready', 'in_flight');
create index if not exists idx_plan_steps_capability
  on public.plan_steps(capability_id);

comment on table public.plan_steps is
  'One capability invocation within an acquisition_plan. Predicted vs. '
  'actual return drives deviation tagging and updates capability priors.';

-- ── 5. plan_step_edges ──────────────────────────────────────────────────
--
-- DAG edges between steps. Explicit table (rather than parent_id column)
-- so join nodes (triangulation: one step has 2+ parents) are expressible.

create table if not exists public.plan_step_edges (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.acquisition_plans(id) on delete cascade,

  from_step_id uuid not null references public.plan_steps(id) on delete cascade,
  to_step_id uuid not null references public.plan_steps(id) on delete cascade,

  -- Edge semantics:
  --   sequential — to_step runs after from_step succeeds
  --   parallel   — both run concurrently (from_step is a "fan-out" marker)
  --   fallback   — to_step runs ONLY if from_step fails
  --   branch     — conditional on from_step.actual_return matching a predicate
  --   join       — to_step is a triangulation/aggregation with 2+ parents
  edge_kind text not null
    check (edge_kind in ('sequential', 'parallel', 'fallback', 'branch', 'join')),

  -- Branch predicate (only for edge_kind = 'branch'): which actual_return
  -- values trigger this edge. JSONB for flexibility.
  --   { attribute: 'response', equals: 'yes' }
  --   { attribute: 'lab_size', gt: 10 }
  branch_predicate jsonb,

  created_at timestamptz not null default now(),

  constraint plan_step_edges_no_self_loop check (from_step_id <> to_step_id),
  unique (plan_id, from_step_id, to_step_id, edge_kind)
);

create index if not exists idx_plan_step_edges_plan
  on public.plan_step_edges(plan_id);
create index if not exists idx_plan_step_edges_to
  on public.plan_step_edges(to_step_id);
create index if not exists idx_plan_step_edges_from
  on public.plan_step_edges(from_step_id);

comment on table public.plan_step_edges is
  'Directed edges within an acquisition_plan DAG. Supports sequential, '
  'parallel fan-out, fallback on failure, branch on output predicate, and '
  'join for triangulation.';

-- ── 6. capability_observations ──────────────────────────────────────────
--
-- Per-space rollup of actual deviations by capability × context. Written
-- by the resolver when a plan_step resolves. Read by the planner to
-- condition its priors on THIS project's history, not just global defaults.
--
-- Kept append-only (one row per resolution) rather than mutating a
-- running average, so post-hoc re-analysis can use different windows.

create table if not exists public.capability_observations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  capability_id uuid not null references public.capabilities(id) on delete cascade,
  plan_step_id uuid not null references public.plan_steps(id) on delete cascade,

  -- Context descriptor the planner used when it scored this invocation.
  -- Free-form string, e.g. "actor_type=pi;familiarity=cold;topic=hci".
  -- Enables per-context prior sharpening.
  context_key text not null default 'default',

  -- Outcome
  succeeded boolean not null,
  -- How complete the yield was vs. predicted (0..1). 1.0 = every predicted
  -- attribute came back; 0.0 = totally vacuous reply.
  yield_completeness numeric check (yield_completeness is null or (yield_completeness >= 0 and yield_completeness <= 1)),
  deviation_tag text
    check (deviation_tag is null or deviation_tag in
      ('expected', 'regime_shift', 'surprise', 'qualitative', 'failed')),

  observed_at timestamptz not null default now()
);

create index if not exists idx_capability_observations_capability_context
  on public.capability_observations(capability_id, context_key, observed_at desc);
create index if not exists idx_capability_observations_space
  on public.capability_observations(space_id, observed_at desc);

comment on table public.capability_observations is
  'Append-only log of (capability × context) outcomes per space. Read by '
  'the planner to condition success/yield priors on THIS project''s '
  'history; rolled up into capabilities.success_priors by a nightly job.';

-- ── 7. RLS ──────────────────────────────────────────────────────────────

alter table public.capabilities enable row level security;
alter table public.data_needs enable row level security;
alter table public.acquisition_plans enable row level security;
alter table public.plan_steps enable row level security;
alter table public.plan_step_edges enable row level security;
alter table public.capability_observations enable row level security;

-- capabilities: system rows (proposed_by_user_id IS NULL) are world-readable;
-- user-proposed rows are owner-only until promoted by service role.
drop policy if exists "capabilities_read_system_or_own" on public.capabilities;
create policy "capabilities_read_system_or_own" on public.capabilities
  for select using (
    proposed_by_user_id is null or auth.uid() = proposed_by_user_id
  );

drop policy if exists "capabilities_insert_own_proposed" on public.capabilities;
create policy "capabilities_insert_own_proposed" on public.capabilities
  for insert with check (
    auth.uid() = proposed_by_user_id and status = 'proposed'
  );

-- data_needs / plans / steps / edges / observations: owner-scoped like
-- the rest of the project KG tables.
drop policy if exists "owner_all_data_needs" on public.data_needs;
create policy "owner_all_data_needs" on public.data_needs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all_acquisition_plans" on public.acquisition_plans;
create policy "owner_all_acquisition_plans" on public.acquisition_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all_plan_steps" on public.plan_steps;
create policy "owner_all_plan_steps" on public.plan_steps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- plan_step_edges: inherit ownership via the parent plan. No user_id column
-- so we scope by plan membership.
drop policy if exists "owner_all_plan_step_edges" on public.plan_step_edges;
create policy "owner_all_plan_step_edges" on public.plan_step_edges
  for all using (
    exists (
      select 1 from public.acquisition_plans p
      where p.id = plan_step_edges.plan_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.acquisition_plans p
      where p.id = plan_step_edges.plan_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "owner_all_capability_observations" on public.capability_observations;
create policy "owner_all_capability_observations" on public.capability_observations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 8. updated_at triggers ──────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_capabilities_updated on public.capabilities;
create trigger trg_capabilities_updated
  before update on public.capabilities
  for each row execute function public.set_updated_at();

drop trigger if exists trg_acquisition_plans_updated on public.acquisition_plans;
create trigger trg_acquisition_plans_updated
  before update on public.acquisition_plans
  for each row execute function public.set_updated_at();

drop trigger if exists trg_plan_steps_updated on public.plan_steps;
create trigger trg_plan_steps_updated
  before update on public.plan_steps
  for each row execute function public.set_updated_at();
