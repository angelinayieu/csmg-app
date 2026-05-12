-- ── Synergy strategy docs (Phase 3.5d) ──
--
-- The converged artifact at the end of a brainstorm — a living doc with
-- typed blocks: statement, plan steps, risks, hypotheses, evidence,
-- notes. Upstream/downstream sections reference brainstorm_components
-- rows directly (no separate doc-side copy) so visibility edits stay in
-- one place.
--
-- ── Idempotency ──
-- Fully idempotent DDL — every CREATE uses IF NOT EXISTS and
-- constraints/policies use DROP IF EXISTS + CREATE so re-runs are
-- no-ops. Same pattern as 20260801 / 20260802.
--
-- ── Generation lifecycle ──
-- A strategy has at most ONE current generation. Regenerating creates
-- a new generation_id and supersedes prior blocks — old blocks remain
-- in the DB for "version history" but are filtered out of normal reads
-- via `generation_id = current_generation_id`. This keeps the doc
-- editable without losing the original AI output.

create table if not exists public.synergy_strategies (
  id uuid primary key default gen_random_uuid(),
  -- One strategy per session — the doc IS the session's converged artifact
  session_id uuid not null unique references public.brainstorm_sessions(id) on delete cascade,
  -- The doc title. Defaults to "(refined objective)" when first generated.
  -- Kept here rather than as a block so the URL/breadcrumb has a clean source.
  statement text,
  -- Tight elevator-pitch reframe of statement; AI-generated, user-editable
  pitch text,
  status text not null default 'draft',
  -- Points at the latest generation's id; reads filter blocks to this id
  current_generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.synergy_strategies
  drop constraint if exists synergy_strategies_status_check;
alter table public.synergy_strategies
  add constraint synergy_strategies_status_check
  check (status in ('draft','published','archived'));

create index if not exists synergy_strategies_session_idx
  on public.synergy_strategies(session_id);

-- Block types map 1:1 to React renderers in synergy-strategy-block.tsx.
-- 'note' is a free-form bucket for user-added content that doesn't fit
-- the structured types — block-level AI ops in Phase 3.5e can promote
-- a note into a typed block if it crystalizes.
create table if not exists public.synergy_strategy_blocks (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.synergy_strategies(id) on delete cascade,
  -- Groups blocks from the same generation. Reads filter by parent
  -- strategy's current_generation_id; old generations stay for history.
  generation_id uuid not null,
  block_type text not null,
  -- Free-form body. For structured block types (plan_step, risk, etc.)
  -- additional fields live in meta jsonb (title, severity, detail, etc.)
  body text not null,
  -- Provenance: which canvas artifact this block was derived from.
  -- Click "Open on canvas" in the block UI pans the whiteboard there.
  source_node_id uuid references public.brainstorm_nodes(id) on delete set null,
  source_component_id uuid references public.brainstorm_components(id) on delete set null,
  sort_order integer not null default 0,
  -- Block-type-specific structured fields. Examples:
  --   plan_step: { title, detail, sub_steps?, evidence_urls? }
  --   risk:      { severity: 'high'|'medium'|'low', title, detail, mitigations? }
  --   hypothesis: { claim, rationale, evidence_status?, supporting_urls? }
  --   evidence:  { source_title, url, summary, supports_block_id? }
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.synergy_strategy_blocks
  drop constraint if exists synergy_strategy_blocks_type_check;
alter table public.synergy_strategy_blocks
  add constraint synergy_strategy_blocks_type_check
  check (block_type in (
    'plan_step','risk','hypothesis','evidence','note'
  ));

create index if not exists synergy_strategy_blocks_strategy_idx
  on public.synergy_strategy_blocks(strategy_id, sort_order);

create index if not exists synergy_strategy_blocks_generation_idx
  on public.synergy_strategy_blocks(strategy_id, generation_id, sort_order);

create index if not exists synergy_strategy_blocks_source_idx
  on public.synergy_strategy_blocks(source_node_id);

-- ── RLS ──
--
-- Owner-only via the session relationship. Strategy is private to the
-- owner until they hit "Share read-only link" (Phase 5+), which mints a
-- separate share_tokens row. The RLS policies are simple ownership checks.

alter table public.synergy_strategies enable row level security;
alter table public.synergy_strategy_blocks enable row level security;

drop policy if exists "synergy_strategies_owner_all" on public.synergy_strategies;
create policy "synergy_strategies_owner_all"
  on public.synergy_strategies for all
  using (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ))
  with check (session_id in (
    select id from public.brainstorm_sessions where owner_id = (select auth.uid())
  ));

drop policy if exists "synergy_strategy_blocks_owner_all" on public.synergy_strategy_blocks;
create policy "synergy_strategy_blocks_owner_all"
  on public.synergy_strategy_blocks for all
  using (strategy_id in (
    select s.id from public.synergy_strategies s
    join public.brainstorm_sessions bs on bs.id = s.session_id
    where bs.owner_id = (select auth.uid())
  ))
  with check (strategy_id in (
    select s.id from public.synergy_strategies s
    join public.brainstorm_sessions bs on bs.id = s.session_id
    where bs.owner_id = (select auth.uid())
  ));

-- ── updated_at triggers ──
-- Mirrors the search_path-pinned pattern from 20260801 to satisfy the
-- function_search_path_mutable advisor.

create or replace function public.synergy_strategies_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists synergy_strategies_updated_at_trg on public.synergy_strategies;
create trigger synergy_strategies_updated_at_trg
before update on public.synergy_strategies
for each row execute function public.synergy_strategies_set_updated_at();

create or replace function public.synergy_strategy_blocks_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists synergy_strategy_blocks_updated_at_trg on public.synergy_strategy_blocks;
create trigger synergy_strategy_blocks_updated_at_trg
before update on public.synergy_strategy_blocks
for each row execute function public.synergy_strategy_blocks_set_updated_at();

comment on table public.synergy_strategies is
  'Synergy Phase 3.5d: living strategy doc — the converged artifact at '
  'the end of a brainstorm. One per session.';

comment on table public.synergy_strategy_blocks is
  'Synergy Phase 3.5d: typed blocks rendering inside a strategy doc. '
  'Generation-snapshot pattern: regenerating creates a new generation_id '
  'and supersedes prior blocks (old ones stay in DB for history).';
