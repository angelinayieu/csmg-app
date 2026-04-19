-- Router proposals
--
-- Every time the intelligence router surfaces a proposed action (critique,
-- synthesis_refresh, strategy_regen, etc.), we persist it here. The UI renders
-- pending proposals as actionable buttons. Once user approves or dismisses,
-- the row moves to the appropriate terminal state.

create table if not exists public.router_proposals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,

  -- What action is being proposed
  kind text not null,  -- 'critique' | 'synthesis_refresh' | 'strategy_regen' | 'objective_accept' | 'sub_objective_accept' | 'probability_space' | 'pattern_aggregation'

  reason text not null,
  confidence real not null default 0.5,
  cost_estimate text not null default 'medium' check (cost_estimate in ('low', 'medium', 'high')),

  -- Payload — any structured data the action executor needs
  payload jsonb,

  -- Trace: which router call produced this proposal + what triggered it
  router_trace_id text,
  triggered_by_content text,  -- short excerpt of the source content

  -- State
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed', 'executed', 'failed')),
  approved_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,
  dismissed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists router_proposals_space_status_idx on public.router_proposals (space_id, status)
  where status = 'pending';
create index if not exists router_proposals_trace_idx on public.router_proposals (router_trace_id)
  where router_trace_id is not null;
create index if not exists router_proposals_kind_idx on public.router_proposals (kind);

alter table public.router_proposals enable row level security;

drop policy if exists "users_read_router_proposals" on public.router_proposals;
create policy "users_read_router_proposals" on public.router_proposals
  for select using (
    space_id is null
    or exists (
      select 1 from public.spaces s
      where s.id = router_proposals.space_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "users_write_router_proposals" on public.router_proposals;
create policy "users_write_router_proposals" on public.router_proposals
  for all using (
    space_id is null
    or exists (
      select 1 from public.spaces s
      where s.id = router_proposals.space_id and s.user_id = auth.uid()
    )
  );

-- Proposed objectives table — when the router suggests a new objective, we
-- persist here rather than creating the objective directly. User accepts to
-- promote to improvement_goals.
create table if not exists public.proposed_objectives (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,

  suggested_title text not null,
  objective_type text not null default 'maximize',
  rationale text not null,
  triggering_excerpt text,
  confidence real not null default 0.5,

  -- For sub-objective proposals
  parent_objective_id uuid references public.improvement_goals(id) on delete cascade,

  -- Trace back
  router_trace_id text,
  source text,  -- 'journal_entry' | 'playground_text' | ...

  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_goal_id uuid references public.improvement_goals(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists proposed_objectives_space_status_idx on public.proposed_objectives (space_id, status)
  where status = 'pending';

alter table public.proposed_objectives enable row level security;

drop policy if exists "users_read_proposed_objectives" on public.proposed_objectives;
create policy "users_read_proposed_objectives" on public.proposed_objectives
  for select using (
    space_id is null
    or exists (
      select 1 from public.spaces s
      where s.id = proposed_objectives.space_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "users_write_proposed_objectives" on public.proposed_objectives;
create policy "users_write_proposed_objectives" on public.proposed_objectives
  for all using (
    space_id is null
    or exists (
      select 1 from public.spaces s
      where s.id = proposed_objectives.space_id and s.user_id = auth.uid()
    )
  );
