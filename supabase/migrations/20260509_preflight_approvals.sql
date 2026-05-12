-- ── Preflight approvals — D1 schema ──────────────────────────────────
--
-- Every time the user clicks "Run this plan" on the preflight page,
-- one row lands here capturing:
--   - the frozen PreflightView at approval time (preflight_snapshot)
--   - its content hash (preflight_hash) for downstream stamping
--   - the opt-in plan items the user toggled on
--   - the pipeline run id that fired from this approval (so artifacts
--     can be diffed against what was promised)
--
-- This is the contract record. Existing surfaces:
--   • The Environment audit page reads this to render
--     "what was approved" vs "what was generated" diffs.
--   • The simulator stamps prediction_ledger.environment_definition_hash
--     with the latest preflight_hash for drift detection.
--   • The user's history view shows their approval log + can re-issue
--     the same plan unchanged.
--
-- Append-only. The user can re-approve with new edits — that's a fresh
-- row, never an update, so the lineage is auditable.

create table if not exists public.preflight_approvals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Hash of the contract-affecting fields at approval time. Mirrors
  -- src/types/preflight.ts → PREFLIGHT_HASH_INPUTS. 24-char hex
  -- prefix of SHA-256.
  preflight_hash text not null,

  -- Frozen snapshot of the full PreflightView. JSONB so the schema
  -- can evolve without migrations. Shape: src/types/preflight.ts →
  -- PreflightView.
  preflight_snapshot jsonb not null,

  -- Opt-in plan item ids that were enabled at approval (e.g.
  -- ['deep_research_pass', 'mechanism_decomposition']). Required so
  -- the downstream pipeline orchestrator knows which optional stages
  -- to actually run.
  enabled_optins text[] not null default '{}',

  -- The pipeline_run_id this approval kicked off. Lets us join
  -- approval → run → emitted events for full audit. Null when the
  -- pipeline trigger fires async and the run id isn't yet known.
  pipeline_run_id uuid,

  -- Optional user-typed rationale (e.g. "approved with deep_research
  -- on because I want richer literature evidence").
  reasoning text,

  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_preflight_approvals_space
  on public.preflight_approvals (space_id, approved_at desc);

create index if not exists idx_preflight_approvals_user
  on public.preflight_approvals (user_id);

-- Find the latest approval per space — used by the audit page +
-- drift detection.
create index if not exists idx_preflight_approvals_latest
  on public.preflight_approvals (space_id, approved_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.preflight_approvals enable row level security;

drop policy if exists "preflight_approvals_owner" on public.preflight_approvals;
create policy "preflight_approvals_owner" on public.preflight_approvals
  for all using (auth.uid() = user_id);

comment on table public.preflight_approvals is
  'Append-only record of every preflight approval. Drives diff-vs-plan '
  'auditing on the Environment page + drift detection on prediction_ledger.';

comment on column public.preflight_approvals.preflight_hash is
  'SHA-256 prefix over contract-affecting fields. Stamped onto '
  'prediction_ledger.environment_definition_hash when the simulator '
  'runs against this approved environment.';

comment on column public.preflight_approvals.preflight_snapshot is
  'Frozen full PreflightView at approval time. Shape: '
  'src/types/preflight.ts → PreflightView.';
