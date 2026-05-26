-- Decision log for Sub-Objective Variant Lab + preference learning.
--
-- Append-only audit of every disposition change + every variant
-- generation request. Powers two flywheels:
--   1. Per-user revealed preferences — which intents the user elects
--      most often. Drives the "Suggested intent" in the variant lab
--      bar without paying an LLM call.
--   2. Cross-user pattern mining — which intents win in which domains,
--      to bias the initial generation for new users.
--
-- One row per atomic action. proposal_id is null for batch-level
-- events (generate_batch). batch_intent is null for confirm events.

create table public.sub_objective_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  -- Null for batch-level events (generate_batch, confirm).
  proposal_id text,
  -- 'elect' / 'reject' / 'defer' = disposition changes
  -- 'clear' = user removed a prior disposition
  -- 'generate_batch' = user fired a variant lab regen
  -- 'confirm' = user forked picks onto canvas (one row per elected proposal)
  action text not null check (action in (
    'elect',
    'reject',
    'defer',
    'clear',
    'generate_batch',
    'confirm'
  )),
  -- Which intent the user steered the batch with (or which batch the
  -- proposal came from, when action is a disposition change).
  -- Null only when the proposal predates batches[] (legacy block).
  batch_intent text check (batch_intent in (
    'initial',
    'creative',
    'concrete',
    'contrarian',
    'gap_fill',
    'ambitious',
    'wildcard'
  )),
  -- Free-form context: prior disposition before this change, lens
  -- coverage at the time, batch_id, etc. Keeps the table schema lean
  -- while letting analytics queries drill in.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Per-user recency lookups (most-recent first) for preference computation.
create index sub_objective_decisions_user_recency_idx
  on public.sub_objective_decisions(user_id, created_at desc);

-- Per-user, per-intent aggregation for "election rate by intent".
create index sub_objective_decisions_user_intent_idx
  on public.sub_objective_decisions(user_id, batch_intent, action);

-- Per-space lookups (audit / retrospectives).
create index sub_objective_decisions_space_idx
  on public.sub_objective_decisions(space_id);

-- Global per-intent aggregation for cross-user pattern mining.
create index sub_objective_decisions_intent_action_idx
  on public.sub_objective_decisions(batch_intent, action, created_at desc);

alter table public.sub_objective_decisions enable row level security;

create policy "users read their own decisions"
  on public.sub_objective_decisions
  for select
  using (user_id = auth.uid());

create policy "users insert their own decisions"
  on public.sub_objective_decisions
  for insert
  with check (user_id = auth.uid());

comment on table public.sub_objective_decisions is
  'Append-only audit of sub-objective Variant Lab interactions. One row per user action (elect / reject / defer / clear / generate_batch / confirm). Powers per-user preference learning and cross-user pattern mining.';
