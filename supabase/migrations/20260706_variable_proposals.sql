-- variable_proposals — first-class persistence for variables proposed by the
-- LLM during strategy synthesis (and by users via the +Variable button).
--
-- Why: until now, variables proposed by synthesis lived ONLY as strings in
-- `synthesis_data.strategic_recommendation.perspectives[].key_metric` (and
-- micro_tactics[].metric, learning_loop.leading_indicators[], etc.). They
-- were never queryable as rows, never had an approval gate, and never got
-- cross-linked to the entities they describe. The +Variable button was the
-- only path that produced a queryable row, but it bypassed the proposal
-- lifecycle entirely.
--
-- This table closes that gap. Each variable the LLM identifies during
-- synthesis becomes a row here with status='proposed' + the role it plays
-- (independent/dependent/controlled/confounding for experimental design,
-- OR outcome/mediator/modifier/instrument/condition for causal modeling).
-- The user reviews them, approves selectively, and approved variables get
-- materialized into the entities table on approval.
--
-- Lifecycle: proposed → approved (creates entities row) | rejected (audit only).
-- Idempotent: safe to re-run the migration.

create table if not exists public.variable_proposals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Where this proposal came from.
  proposed_by text not null check (proposed_by in ('llm', 'manual'))
    default 'llm',
  -- When proposed_by='llm', which strategy generation it was extracted from.
  -- Lets us scope the review to the latest strategy and supersede stale
  -- proposals on regen without losing the audit trail.
  source_strategy_version int,
  source_field text, -- e.g. 'perspective.key_metric', 'micro_tactic.metric',
                    -- 'learning_loop.leading_indicator', 'learning_loop.lagging_indicator'
  source_perspective_id text, -- when source is a perspective; helps grouping

  -- The variable itself.
  proposed_name text not null,
  proposed_description text,

  -- Role the variable plays. Union of two taxonomies:
  -- Experimental design: independent | dependent | controlled | confounding
  -- Causal modeling:     outcome | mediator | modifier | instrument | condition
  -- Defaults to 'dependent' (most common — what we measure) when the LLM
  -- doesn't explicitly classify; the extractor uses heuristics to refine.
  variable_role text not null
    check (variable_role in (
      'independent','dependent','controlled','confounding',
      'outcome','mediator','modifier','instrument','condition',
      'unclassified'
    ))
    default 'unclassified',

  -- Metric definition — the actual measurable shape of this variable.
  -- Shape: {name, current?, target?, unit?, measurement_method?,
  --         cadence?, threshold_green?, threshold_yellow?, threshold_red?}
  metric_definition jsonb,

  -- Why the LLM proposed this (or user's note for manual proposals).
  justification text,

  -- 0..1 confidence the LLM had in proposing this variable.
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Cross-references to other entities the variable depends on (if known).
  -- Null until approved + the dependency walk runs.
  depends_on_entity_ids text[] not null default '{}',

  -- After approval, the entity row materialized for this variable.
  -- Null until approved.
  materialized_entity_id text,

  -- Lifecycle state.
  user_status text not null default 'proposed'
    check (user_status in ('proposed', 'approved', 'rejected', 'superseded')),

  -- Approval audit.
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Speed up the "show me pending proposals for this space" query that drives
-- the +Variable button counter + the review panel.
create index if not exists idx_variable_proposals_pending
  on public.variable_proposals(space_id, user_id, generated_at desc)
  where user_status = 'proposed';

-- Speed up role-grouped views in the review panel.
create index if not exists idx_variable_proposals_role
  on public.variable_proposals(space_id, variable_role, user_status);

-- Useful for "did this strategy gen propose anything new?" — the reviewer
-- panel shows a "regenerated · 5 new variables since last review" chip.
create index if not exists idx_variable_proposals_strategy_version
  on public.variable_proposals(space_id, source_strategy_version)
  where source_strategy_version is not null;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.variable_proposals enable row level security;

drop policy if exists "variable_proposals_owner" on public.variable_proposals;
create policy "variable_proposals_owner" on public.variable_proposals
  for all using (auth.uid() = user_id);

-- ── updated_at trigger ──────────────────────────────────────────────
create or replace function public.set_variable_proposals_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_variable_proposals_updated_at on public.variable_proposals;
create trigger trg_variable_proposals_updated_at
  before update on public.variable_proposals
  for each row execute function public.set_variable_proposals_updated_at();

comment on table public.variable_proposals is
  'Variables proposed by strategy synthesis (proposed_by=llm) or manual '
  'authoring via +Variable button (proposed_by=manual). Each row has a '
  'variable_role classifying it as either experimental (IV/DV/CV/confound) '
  'or causal (outcome/mediator/modifier/instrument/condition). Approved '
  'rows get materialized into the entities table.';

comment on column public.variable_proposals.variable_role is
  'IV/DV/Controlled/Confounding for experimental-design framing OR '
  'outcome/mediator/modifier/instrument/condition for causal-modeling '
  'framing OR "unclassified" when the LLM did not commit to a role.';
