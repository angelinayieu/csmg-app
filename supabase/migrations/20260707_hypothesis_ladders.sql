-- Hypothesis ladders — first-class persistence for the rigor structure
-- (claim → mechanism → falsifier → verdict) the system identifies during
-- strategy synthesis.
--
-- Why: variable_proposals captured METRICS the strategy proposes, but did
-- not capture the FALSIFIABLE CLAIMS the strategy rests on. A strategy
-- always carries implicit assumptions ("if we do X, Y will happen because
-- Z is the real bottleneck") and the strategic-recommendation prompt
-- already produces these as `pre_mortem` entries with structure:
--   { narrative, assumption_exposed, early_warnings, related_entity_ids }
-- — which maps almost 1:1 to the hypothesis-ladder shape:
--   • CLAIM       ← assumption_exposed (the implicit hypothesis)
--   • MECHANISM   ← related_entity_ids walked
--   • FALSIFIER   ← early_warnings (observable signs of failure)
--   • VERDICT     ← derived from current state (any warnings observed?)
--
-- This table makes those ladders queryable, approvable, and
-- updatable as evidence accumulates — the canvas can render them as
-- structured cards, and verdict transitions become the audit trail
-- of "was this hypothesis right?"
--
-- Idempotent. Safe to re-run.

create table if not exists public.hypothesis_ladders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Where this ladder came from. `llm` = extracted from a strategy's
  -- pre_mortem; `manual` = user-authored via canvas UI.
  source text not null check (source in ('llm', 'manual'))
    default 'llm',
  -- When source='llm', the strategy generation it came from.
  source_strategy_version int,
  -- pre_mortem.category from the prompt schema:
  -- internal | structural | competitive | timing | interaction
  source_category text,

  -- The four ladder rungs.
  claim text not null,
  mechanism_chain jsonb not null default '[]'::jsonb,
  -- mechanism_chain shape: array of {entity_id, entity_name, role}.
  -- Walked left-to-right reads as "X → Y → Z".
  falsifier text,
  verdict text not null default 'pending'
    check (verdict in ('pending', 'supported', 'refuted', 'contested')),
  verdict_rationale text,
  verdict_at timestamptz,

  -- Severity + probability lifted from pre_mortem so the canvas can
  -- visually weight high-severity claims.
  severity text check (severity is null or severity in
    ('catastrophic', 'major', 'moderate')),
  probability text check (probability is null or probability in
    ('high', 'moderate', 'low')),

  -- Cross-reference to entities the claim depends on, so the canvas
  -- can highlight the mechanism chain in the kg.
  related_entity_ids text[] not null default '{}',

  -- Lifecycle parallel to variable_proposals: rows can be archived
  -- (user dismisses) without losing audit trail.
  user_status text not null default 'active'
    check (user_status in ('active', 'archived', 'superseded')),

  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hypothesis_ladders_space
  on public.hypothesis_ladders(space_id, user_id, generated_at desc);
create index if not exists idx_hypothesis_ladders_active
  on public.hypothesis_ladders(space_id, user_id, generated_at desc)
  where user_status = 'active';
create index if not exists idx_hypothesis_ladders_verdict
  on public.hypothesis_ladders(space_id, verdict, user_status);

-- ── RLS ──────────────────────────────────────────────────────────
alter table public.hypothesis_ladders enable row level security;

drop policy if exists "hypothesis_ladders_owner" on public.hypothesis_ladders;
create policy "hypothesis_ladders_owner" on public.hypothesis_ladders
  for all using (auth.uid() = user_id);

-- ── updated_at trigger ──────────────────────────────────────────
create or replace function public.set_hypothesis_ladders_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_hypothesis_ladders_updated_at on public.hypothesis_ladders;
create trigger trg_hypothesis_ladders_updated_at
  before update on public.hypothesis_ladders
  for each row execute function public.set_hypothesis_ladders_updated_at();

comment on table public.hypothesis_ladders is
  'Falsifiable claims derived from strategy synthesis (pre_mortem entries) '
  'or user-authored. Each row: claim → mechanism_chain → falsifier → verdict. '
  'Verdict transitions are the audit trail of whether the strategy''s implicit '
  'assumptions held up.';
