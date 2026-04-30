-- ── Phase 5 · research_rounds + constraint re-sync ──
--
-- Three things in one migration:
--
--   1. NEW TABLE research_rounds — persists each outcome-anchored
--      research round (one row per "fully cover one outcome"
--      orchestrator invocation). The pass_results JSONB array tracks
--      which pass kinds ran, what each produced; metrics summarizes
--      across the round.
--
--   2. ALTER pipeline_runs.pipeline CHECK — adds 'research_round' to
--      the allowed pipeline values so the round orchestrator can
--      open its own pipeline_run row for SSE streaming + audit.
--
--   3. ALTER pipeline_run_events.event_type CHECK — re-syncs the
--      whitelist with the current TS StructuralEvent union. The
--      previous re-sync was 20260531 (axis_failed); since then the
--      TS layer added many event types (kg_plan_*, situation_analyzed,
--      asset_added, community_detected, layer_ontology_materialized,
--      measurement_coverage_gap, memory_context_loaded, +Phase 2
--      types triangulation_gap / contradiction_found) that were
--      silently dropping at the DB layer because the CHECK was
--      stale. This migration lands the full set in one pass —
--      idempotent (`drop constraint if exists`), and existing rows
--      are unaffected.

-- ────────────────────────────────────────────────────────────────────
-- 1. ALTER pipeline_runs CHECK to allow 'research_round'
-- ────────────────────────────────────────────────────────────────────

alter table public.pipeline_runs
  drop constraint if exists pipeline_runs_pipeline_check;

alter table public.pipeline_runs
  add constraint pipeline_runs_pipeline_check
  check (pipeline in (
    'decompose',
    'research',
    'research_deep',
    'synthesize',
    'strategy_refresh',
    'generate_apps',
    'critique',
    'expand',
    'intake_bootstrap',
    -- VP Project report (Phase 3)
    'writer_path',
    -- KG generation plan stage
    'plan_propose',
    -- Phase 5 (research-strategy migration) — outcome-anchored
    -- modular round orchestrator
    'research_round'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 2. ALTER pipeline_run_events.event_type CHECK to match TS union
-- ────────────────────────────────────────────────────────────────────

alter table public.pipeline_run_events
  drop constraint if exists pipeline_run_events_event_type_check;

alter table public.pipeline_run_events
  add constraint pipeline_run_events_event_type_check
  check (event_type in (
    -- Core structural stream (20260520)
    'stage_boundary',
    'entity_added',
    'edge_added',
    'cycle_detected',
    'bridge_formed',
    'proposal_ready',
    'source_cited',
    'prediction_recorded',
    -- Streaming reasoning trace
    'reasoning_chunk',
    -- Probability-space choreography
    'space_opened',
    'space_entity_added',
    'space_edge_added',
    'cross_space_link',
    'space_merge_begin',
    'space_merge_complete',
    'axis_scored',
    'axis_failed',
    -- Cross-domain structural analogy
    'structural_analog_found',
    -- Target outcome
    'target_outcome_identified',
    -- Node signatures
    'signature_deepened',
    -- VP Project report
    'taxonomy_inferred',
    'variant_proposed',
    -- Root-cause + why-chain
    'root_cause_identified',
    'why_chain_deepened',
    -- Strategy consensus
    'strategy_consensus_ready',
    -- Coverage gap signals
    'layer_coverage_gap',
    'measurement_coverage_gap',
    -- Sprint B narrative row bands
    'app_result_ready',
    'iv_decomposition_ready',
    'variant_deck_ready',
    'causal_stage_ready',
    -- Situation analyzer summary
    'situation_analyzed',
    -- Asset upload
    'asset_added',
    -- Memory context
    'memory_context_loaded',
    -- Community detection
    'community_detected',
    -- KG generation plan flow
    'kg_plan_proposed',
    'kg_plan_edited',
    'kg_plan_approved',
    'kg_plan_rejected',
    'layer_ontology_materialized',
    -- Phase 2 (research-strategy migration) — triangulation +
    -- adversarial passes surface gaps + contradictions for the
    -- canvas to render.
    'triangulation_gap',
    'contradiction_found'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 3. CREATE TABLE research_rounds
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.research_rounds (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,

  -- The outcome variable this round is anchored to. Mirrors the
  -- pipeline_runs.target_outcome JSONB shape so the orchestrator can
  -- pass it straight through to outcome_breadth without reshaping.
  -- Required (rounds are outcome-anchored by definition).
  outcome_variable jsonb not null,

  status text not null default 'planned'
    check (status in (
      'planned',     -- row created, orchestrator hasn't started
      'running',     -- a pass is currently executing
      'completed',   -- all planned passes finished (some may have soft-failed)
      'failed',      -- an unrecoverable error stopped the round
      'cancelled'    -- user / system cancellation before completion
    )),

  -- Array of per-pass result rows. Each entry:
  --   {
  --     kind: PassKind,
  --     started_at: ISO timestamp,
  --     completed_at: ISO timestamp,
  --     status: 'completed' | 'soft_failed' | 'skipped',
  --     metrics: { ... pass-kind-specific counts ... }
  --   }
  -- Append-only as passes complete; one row per pass attempted.
  pass_results jsonb not null default '[]'::jsonb,

  -- Aggregated metrics across the round. Populated incrementally as
  -- passes finish so the canvas can render running totals. Shape:
  --   {
  --     entitiesAdded: number,
  --     edgesAdded: number,
  --     claimsCreated: number,
  --     claimsTriangulated: number,
  --     contradictionsFound: number,
  --     cyclesPromoted: number,
  --     boundaryConditionsFound: number
  --   }
  metrics jsonb not null default '{}'::jsonb,

  -- The pipeline_run row owning this round. NULL when the orchestrator
  -- ran without an event-bus subscription (e.g., a CLI invocation).
  pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,

  -- Lifecycle stamps. created_at = row insert; started_at = first pass
  -- begins; completed_at = terminal status. The (completed_at - started_at)
  -- delta is the user-visible "round took N seconds".
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Newest rounds first per space — this is the access pattern for the
-- canvas + the round-history drawer. Composite index covers both.
create index if not exists research_rounds_space_idx
  on public.research_rounds(space_id, created_at desc);

-- For the orchestrator's "is there an in-flight round on this space?"
-- check (avoid kicking a duplicate round when one is already running).
create index if not exists research_rounds_space_status_idx
  on public.research_rounds(space_id, status);

-- ────────────────────────────────────────────────────────────────────
-- RLS: same as other space-scoped tables — owners only.
-- ────────────────────────────────────────────────────────────────────

alter table public.research_rounds enable row level security;

drop policy if exists "research_rounds owner can read" on public.research_rounds;
create policy "research_rounds owner can read"
  on public.research_rounds for select
  using (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

drop policy if exists "research_rounds owner can write" on public.research_rounds;
create policy "research_rounds owner can write"
  on public.research_rounds for all
  using (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  )
  with check (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

comment on table public.research_rounds is
  'Phase 5 (research-strategy migration). Each row is one outcome-anchored research round — a single declared outcome variable researched via the full sequence of pass kinds (outcome_breadth → triangulation → adversarial → cycle_close → boundary_condition).';

comment on column public.research_rounds.outcome_variable is
  'JSONB matching pipeline_runs.target_outcome shape: { name, direction, metric_kind, horizon, confidence?, rationale? }';

comment on column public.research_rounds.pass_results is
  'Append-only array of per-pass result rows. Each entry: { kind, started_at, completed_at, status, metrics }';
