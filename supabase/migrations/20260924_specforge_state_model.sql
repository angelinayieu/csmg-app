-- ── SpecForge · Knowledge Graph / State Model — Phase A (substrate) ──
--
-- Per specforge_knowledge_graph_state_model.md §34, this lands the minimum
-- substrate so a SpecForge run is no longer ephemeral: every engine call,
-- its JSON artifact, its quality-gate verdict, and the constraint rows it
-- produced are now durable + traceable to the user/space.
--
-- Cooperation rule (no parallel subsystem): SpecForge REUSES the existing
-- pipeline_runs / pipeline_run_events tables instead of forking. The
-- precedent is supabase/migrations/20260629_insight_lab.sql — same shape:
--
--   1. ALTER pipeline_runs.pipeline CHECK — add 'specforge'.
--   2. ALTER pipeline_run_events.event_type CHECK — add two SpecForge
--      structural events (engine_started, engine_completed) so the
--      forge progress chip can become SSE-driven in a later phase
--      without another migration.
--   3. NEW TABLES — specforge_engine_runs (one row per engine call inside
--      a pipeline_run), specforge_reasoning_artifacts (1:1 JSON payload
--      separated for size + queryability), specforge_constraints
--      (promoted from the deterministic accumulator, queryable across
--      runs for the future stale-detection / iteration-diff features
--      called out in spec §31-§32).
--
-- Quality-gate results live AS COLUMNS on specforge_engine_runs (critic_*)
-- rather than a separate table — they're strictly 1:1 with engine_runs
-- and we never query them independently. Card → artifact provenance is
-- carried by a new `engineRunId` prop on the specforge-card tldraw shape
-- (see migration in src/components/objective/shapes/specforge-card-shape.tsx).
--
-- Idempotent: drops + re-adds the CHECK constraints, uses IF NOT EXISTS
-- on tables and indexes.

-- ────────────────────────────────────────────────────────────────────
-- 1. ALTER pipeline_runs CHECK to allow 'specforge'
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
    'writer_path',
    'plan_propose',
    'research_round',
    'insight_lab',
    -- SpecForge — one pipeline_run per "Forge full spec" click,
    -- with N specforge_engine_runs rows (one per chain engine).
    'specforge'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 2. ALTER pipeline_run_events.event_type CHECK to add SpecForge events
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
    'target_outcome_identified',
    'signature_deepened',
    'taxonomy_inferred',
    'variant_proposed',
    'root_cause_identified',
    'why_chain_deepened',
    'strategy_consensus_ready',
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
    -- Phase 2 (research-strategy) — gaps + contradictions
    'triangulation_gap',
    'contradiction_found',
    -- Phase 6 (Insight Lab)
    'lab_step_started',
    'lab_insight_emitted',
    'lab_score_recorded',
    -- SpecForge — engine lifecycle (this migration)
    'specforge_engine_started',
    'specforge_engine_completed'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 3. specforge_engine_runs
--    One row per engine call inside a specforge pipeline_run.
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.specforge_engine_runs (
  id uuid primary key default gen_random_uuid(),

  -- Parent forge run. NULL never — every engine call belongs to a run.
  pipeline_run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  -- Engine id from SpecForgeEngineId (see src/lib/objective-canvas/specforge/types.ts).
  -- Not enum'd in SQL because the TS chain is the source of truth and we
  -- don't want a migration every time a new engine ships. The route gate
  -- (VALID_ENGINES) is the actual validator.
  engine text not null,

  -- Position in the chain when this engine fired (0-indexed). Lets us
  -- replay the run in causal order even after re-ordering.
  sequence integer not null,

  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'skipped')),

  -- The critic verdict carried on the row. critic_pass FALSE + repaired
  -- TRUE means a one-shot repair pass salvaged the engine output.
  critic_pass boolean,
  critic_score integer,
  repaired boolean not null default false,

  -- The engine's prompt version this run used (incremented when prompts
  -- materially change — see spec §22 "prompt evolution"). For now this is
  -- a free-text field; later we'll pin it to a registry.
  prompt_version text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,

  unique (pipeline_run_id, sequence)
);

create index if not exists idx_specforge_engine_runs_run_seq
  on public.specforge_engine_runs(pipeline_run_id, sequence asc);

create index if not exists idx_specforge_engine_runs_space_started
  on public.specforge_engine_runs(space_id, started_at desc);

alter table public.specforge_engine_runs enable row level security;

create policy "specforge_engine_runs user can read own"
  on public.specforge_engine_runs for select
  using (created_by = auth.uid());

create policy "specforge_engine_runs user can insert own"
  on public.specforge_engine_runs for insert
  with check (created_by = auth.uid());

create policy "specforge_engine_runs user can update own"
  on public.specforge_engine_runs for update
  using (created_by = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- 4. specforge_reasoning_artifacts
--    The raw JSON output of one engine. Separated from engine_runs so
--    the engine_runs table stays light (filtered + indexed often).
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.specforge_reasoning_artifacts (
  id uuid primary key default gen_random_uuid(),

  engine_run_id uuid not null references public.specforge_engine_runs(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  -- Echoes specforge_engine_runs.engine for query convenience (avoids a
  -- join when listing "all problem_tree outputs for this space"). Kept
  -- denormalized + free-text for the same reasons as engine_runs.engine.
  engine text not null,

  -- The full result JSON from the engine (matches EngineResultMap shape
  -- in src/lib/objective-canvas/specforge/types.ts).
  payload jsonb not null,

  -- The compact summary the runner threads forward to downstream engines
  -- (from cards.ts:summarizeForContext). Stored so we don't have to
  -- recompute when replaying or auditing context flow.
  summary_for_context text,

  created_at timestamptz not null default now(),

  unique (engine_run_id)
);

create index if not exists idx_specforge_reasoning_artifacts_space_engine
  on public.specforge_reasoning_artifacts(space_id, engine, created_at desc);

alter table public.specforge_reasoning_artifacts enable row level security;

create policy "specforge_reasoning_artifacts user can read own"
  on public.specforge_reasoning_artifacts for select
  using (created_by = auth.uid());

create policy "specforge_reasoning_artifacts user can insert own"
  on public.specforge_reasoning_artifacts for insert
  with check (created_by = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- 5. specforge_constraints
--    Promoted from the deterministic accumulator (constraints.ts) so the
--    constraint set per run is queryable + diffable across iterations.
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.specforge_constraints (
  id uuid primary key default gen_random_uuid(),

  pipeline_run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  -- Which engine produced this constraint (provenance per spec §26).
  -- Soft FK — engine_run might be deleted but the constraint should
  -- still be readable.
  origin_engine_run_id uuid references public.specforge_engine_runs(id) on delete set null,
  origin_engine text not null,

  -- Matches ConstraintType enum in src/lib/objective-canvas/specforge/constraints.ts:
  -- 'macro' | 'target_user' | 'problem_cause' | 'desired_result' |
  -- 'differentiation' | 'buildability' | 'mechanism' | 'evaluation' | 'evidence'
  constraint_type text not null,

  -- 'critical' | 'high' | 'medium' | 'low'
  priority text not null
    check (priority in ('critical', 'high', 'medium', 'low')),

  -- The constraint itself, as a single declarative sentence.
  text text not null,

  -- Why this constraint exists.
  why text,

  -- Normalized dedupe key (text lowercased + whitespace-collapsed +
  -- constraint_type prefix). Used by the accumulator to prevent dupes
  -- across the run AND to support the spec §25 cross-run dedupe later.
  normalized_key text not null,

  created_at timestamptz not null default now(),

  -- One constraint per (run, normalized_key) — the accumulator already
  -- dedupes in-memory; this is the durable enforcement.
  unique (pipeline_run_id, normalized_key)
);

create index if not exists idx_specforge_constraints_run_priority
  on public.specforge_constraints(pipeline_run_id, priority);

create index if not exists idx_specforge_constraints_space_type
  on public.specforge_constraints(space_id, constraint_type, created_at desc);

alter table public.specforge_constraints enable row level security;

create policy "specforge_constraints user can read own"
  on public.specforge_constraints for select
  using (created_by = auth.uid());

create policy "specforge_constraints user can insert own"
  on public.specforge_constraints for insert
  with check (created_by = auth.uid());
