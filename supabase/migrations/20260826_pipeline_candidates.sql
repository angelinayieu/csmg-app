-- Phase 7c-1: pipeline_candidates.
--
-- Staging table for AI-generated artifacts BEFORE they commit to the
-- knowledge graph. Used when a space's pipeline_mode = 'review_each':
-- the chain stage (decompose / synthesize / critique / expand)
-- persists its proposed entities / edges / claims / variations here
-- instead of writing them straight to the live KG tables. The user
-- then opens the CandidateReviewDrawer, picks which to accept, and
-- only the accepted ones graduate to entities / edges / claims.
--
-- Schema notes:
--
--  • `batch_id` groups all candidates produced by one stage emission
--    so the drawer can present them as a single review session
--    ("Decompose generated 12 sub-entities — pick which to commit"),
--    rather than each candidate showing up individually.
--
--  • `display_name` + `display_description` are denormalized off the
--    payload so the drawer can render the checklist without deep-
--    diving every JSONB blob. The full payload is preserved for the
--    commit step which knows how to materialize each kind.
--
--  • `suggested` defaults TRUE — pre-check the box for the user so
--    "accept all" is one click. Pipelines can stage candidates as
--    suggested=false for low-confidence proposals that should require
--    explicit opt-in.
--
--  • `status` is the lifecycle gate:
--      pending  → waiting on user decision
--      accepted → user picked it; commit endpoint has materialized
--      rejected → user explicitly skipped; kept for audit / undo
--    Rejected rows stay in the table (not deleted) so an "undo my
--    reject" affordance can re-promote them. Cleanup happens later
--    via a TTL job if the table grows.

create table if not exists public.pipeline_candidates (
  id uuid primary key default gen_random_uuid(),

  -- Ownership / scoping. Inherits delete-cascade from space + run so
  -- abandoned runs don't leak stale candidates.
  space_id uuid not null references public.spaces(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  -- Which chain stage produced this candidate. Mirrors the pipeline_runs
  -- pipeline column values but only the stages that emit reviewable
  -- artifacts — strategy_refresh / generate_apps / intake_bootstrap
  -- don't stage candidates (they're either pure-read or composite
  -- runs that decompose into smaller stages internally).
  stage text not null
    check (stage in ('decompose', 'synthesize', 'critique', 'expand', 'extract')),

  -- What KIND of artifact this candidate represents. The commit
  -- endpoint dispatches on this to materialize correctly.
  kind text not null
    check (kind in ('entity', 'edge', 'claim', 'variation', 'cycle')),

  -- Free-form payload — shape varies by `kind`. The commit step casts
  -- to the right TypeScript type based on (stage, kind).
  payload jsonb not null,

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),

  -- One review-session per batch. The drawer fetches by batch_id so
  -- candidates appear together. A single chain stage typically emits
  -- one batch; nested stages get nested batches with their own ids.
  batch_id uuid not null,

  -- Denormalized display fields the drawer renders without payload
  -- parsing. Pipeline must set these even if payload duplicates them.
  display_name text not null,
  display_description text,

  -- Pre-check the box? True = "we suggest committing this one."
  suggested boolean not null default true,

  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- "Fetch pending candidates for this space at this stage" — the
-- drawer's primary query. Composite covers both the WHERE and the
-- typical ORDER BY.
create index if not exists idx_pipeline_candidates_space_stage_status
  on public.pipeline_candidates (space_id, stage, status, created_at desc);

-- "Fetch all candidates in this batch" — used when the drawer opens
-- on a single batch and needs all members atomically.
create index if not exists idx_pipeline_candidates_batch
  on public.pipeline_candidates (batch_id);

-- "What did this run produce?" — used by audit + undo paths.
create index if not exists idx_pipeline_candidates_run_created
  on public.pipeline_candidates (run_id, created_at desc)
  where run_id is not null;

alter table public.pipeline_candidates enable row level security;

create policy "pipeline_candidates user can read own"
  on public.pipeline_candidates for select
  using (created_by = auth.uid());

create policy "pipeline_candidates user can insert own"
  on public.pipeline_candidates for insert
  with check (created_by = auth.uid());

create policy "pipeline_candidates user can update own"
  on public.pipeline_candidates for update
  using (created_by = auth.uid());

comment on table public.pipeline_candidates is
  'Staging table for AI-generated entities/edges/claims/variations awaiting user review. Populated when space.pipeline_mode=review_each. The CandidateReviewDrawer reads pending rows; the commit endpoint materializes accepted ones into the live KG tables.';
