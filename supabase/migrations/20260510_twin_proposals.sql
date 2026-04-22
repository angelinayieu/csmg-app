-- PR 3a: twin_proposals — persisted record of a generated Twin proposal
--
-- A Twin (= Strategy = Workflow) is generated for the user's objective with a
-- structured justification ("why is this workflow optimal?"). This table holds
-- one row per generation with the structured justification, the linked
-- mechanism rows, and the user's approval lifecycle.
--
-- This is created in PR 3a as the storage layer; PR 3b wires the strategy
-- generator to actually emit these rows (today the GET endpoint falls back
-- to extracting a TwinProposalJustification from synthesis_data on the fly,
-- so the UI works even before generator changes land).
--
-- Lifecycle:
--   proposed  → freshly generated, awaiting user review
--   refined   → user requested a regen with a constraint (refinement_constraint set)
--   approved  → user accepted; downstream apps can begin executing
--   rejected  → user declined entirely (rare; used for telemetry)
--
-- Identity: many proposals per space (one per strategy generation). Latest is
-- determined by generated_at desc.

create table if not exists public.twin_proposals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Structured justification (mirrors src/types/strategy.ts → TwinProposalJustification).
  -- Shape:
  --   {
  --     chosen_approach: string,
  --     key_tradeoffs: [{tradeoff, chosen_side, why}],
  --     alternatives_rejected: [{name, description, why_rejected}],
  --     confidence: number (0-100),
  --     mechanism_ids: string[],
  --     generated_at: ISO timestamp
  --   }
  justification jsonb not null,

  -- Denormalized refs into the mechanisms table that this proposal commits to.
  -- Cleaner than a join table for our access pattern (always loaded with the
  -- proposal).
  mechanism_ids uuid[] not null default '{}',

  -- Provenance — which strategy generation this proposal was extracted from
  -- or attached to. Optional for back-compat with extracted-on-the-fly proposals
  -- that don't have a stable strategy_version snapshot.
  source_strategy_version int,

  -- Lifecycle
  user_status text not null default 'proposed'
    check (user_status in ('proposed', 'refined', 'approved', 'rejected')),

  -- Approval audit
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,

  -- If user requested refinement, the natural-language constraint they typed.
  -- Triggers a regenerate-with-constraint flow downstream.
  refinement_constraint text,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_twin_proposals_space
  on public.twin_proposals(space_id);
create index if not exists idx_twin_proposals_user
  on public.twin_proposals(user_id);
create index if not exists idx_twin_proposals_latest
  on public.twin_proposals(space_id, generated_at desc);
create index if not exists idx_twin_proposals_pending
  on public.twin_proposals(space_id) where user_status = 'proposed';

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.twin_proposals enable row level security;

drop policy if exists "twin_proposals_owner" on public.twin_proposals;
create policy "twin_proposals_owner" on public.twin_proposals
  for all using (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────
create or replace function public.set_twin_proposals_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_twin_proposals_updated_at on public.twin_proposals;
create trigger trg_twin_proposals_updated_at
  before update on public.twin_proposals
  for each row execute function public.set_twin_proposals_updated_at();

comment on table public.twin_proposals is
  'A generated Twin proposal (Twin === Strategy === Workflow) with structured '
  'justification ("why is this optimal?"), linked mechanisms, and the user''s '
  'approval lifecycle. One row per generation; latest is by generated_at desc.';
