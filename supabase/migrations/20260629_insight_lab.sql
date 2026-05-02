-- ── Phase 6 · Insight Lab schema + event bus extensions ──
--
-- Three things in one migration:
--
--   1. ALTER pipeline_runs.pipeline CHECK — add 'insight_lab' so manual
--      lab runs can open their own pipeline_run row for SSE streaming.
--      Mirrors the pattern used by 20260627_research_rounds.sql.
--
--   2. ALTER pipeline_run_events.event_type CHECK — add three lab event
--      types (lab_step_started, lab_insight_emitted, lab_score_recorded)
--      so the lab UI can stream progress through the existing event bus
--      rather than a parallel channel.
--
--   3. NEW TABLES lab_experiments + lab_insights — persist each lab run
--      and its emitted insights with full provenance. The stack_config
--      JSONB matches StackConfig in src/lib/insight-lab/types.ts; the
--      provenance JSONB matches the Provenance interface there too.
--
-- Idempotent: re-running this migration drops + re-adds the constraints
-- without nuking existing rows; tables use `if not exists`.

-- ────────────────────────────────────────────────────────────────────
-- 1. ALTER pipeline_runs CHECK to allow 'insight_lab'
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
    -- Phase 6 — manual algorithm experimentation
    'insight_lab'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 2. ALTER pipeline_run_events.event_type CHECK to add lab events
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
    -- Phase 6 (Insight Lab — this migration)
    'lab_step_started',
    'lab_insight_emitted',
    'lab_score_recorded'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 3. CREATE TABLE lab_experiments
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.lab_experiments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,

  -- The pipeline_run row that streamed this experiment's events. NULL
  -- for offline runs (CLI invocations, background eval harness, etc.)
  -- where SSE subscription wasn't requested.
  pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,

  -- Stack configuration that produced this experiment. Shape matches
  -- StackConfig in src/lib/insight-lab/types.ts:
  --   { id: string, name: string, description?: string,
  --     steps: Array<{ algoId: AlgoId, params?: object }> }
  stack_config jsonb not null,

  -- Per-axis scores aggregated across all insights. Shape:
  --   { goalMatch?: { stackAvg: number,
  --                   perInsight: Record<insightKey, number> } }
  -- Phase 6+ adds novelty + actionability axes alongside.
  scores jsonb not null default '{}'::jsonb,

  -- Per-step duration / error / insightCount. Mirrors
  -- StackResult.stepResults from types.ts. Append-only as steps complete.
  step_results jsonb not null default '[]'::jsonb,

  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled')),

  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Newest experiments first per space — primary access pattern for the
-- lab UI's "recent runs" panel.
create index if not exists lab_experiments_space_idx
  on public.lab_experiments(space_id, created_at desc);

-- For SSE clients to look up an experiment by its run id without a
-- secondary scan.
create index if not exists lab_experiments_run_idx
  on public.lab_experiments(pipeline_run_id);

alter table public.lab_experiments enable row level security;

drop policy if exists "lab_experiments owner can read" on public.lab_experiments;
create policy "lab_experiments owner can read"
  on public.lab_experiments for select
  using (
    space_id in (
      select id from public.spaces where user_id = auth.uid()
    )
  );

drop policy if exists "lab_experiments owner can write" on public.lab_experiments;
create policy "lab_experiments owner can write"
  on public.lab_experiments for all
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

-- ────────────────────────────────────────────────────────────────────
-- 4. CREATE TABLE lab_insights
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.lab_insights (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.lab_experiments(id) on delete cascade,

  -- Stable insight id within an experiment (matches Insight.id from
  -- types.ts). The (experiment_id, insight_key) unique constraint
  -- supports upsert-on-replay so a re-run of the same stack against
  -- the same graph doesn't duplicate rows.
  insight_key text not null,

  kind text not null
    check (kind in (
      'hub',
      'bridge',
      'cluster',
      'cycle',
      'community',
      'cascade',
      'pathway',
      'tier'
    )),

  summary text not null,

  -- Entities this insight references. Soft FK — deleting an entity
  -- doesn't cascade-delete the historical insight; the canvas can
  -- still render the summary even if the underlying nodes are gone.
  entity_ids uuid[] not null default '{}',

  -- Kind-specific structured detail (degree, jaccard, length, etc.).
  -- Open-ended JSONB so each algorithm can carry whatever it wants
  -- without a schema migration.
  detail jsonb not null default '{}'::jsonb,

  -- Provenance — which algo + step in the stack produced this insight.
  -- Shape: { algoId, stepIdx, raw? } matching the Provenance interface.
  provenance jsonb not null,

  -- Per-insight scores. Same axes as lab_experiments.scores but
  -- one number per axis per insight (not aggregate).
  scores jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  unique(experiment_id, insight_key)
);

create index if not exists lab_insights_experiment_idx
  on public.lab_insights(experiment_id);
create index if not exists lab_insights_kind_idx
  on public.lab_insights(experiment_id, kind);

alter table public.lab_insights enable row level security;

-- Insights inherit experiment ownership — same user that owns the
-- parent space can read/write. No direct lab_insights RLS path needed.
drop policy if exists "lab_insights inherit experiment" on public.lab_insights;
create policy "lab_insights inherit experiment"
  on public.lab_insights for all
  using (
    experiment_id in (
      select id from public.lab_experiments
      where space_id in (
        select id from public.spaces where user_id = auth.uid()
      )
    )
  )
  with check (
    experiment_id in (
      select id from public.lab_experiments
      where space_id in (
        select id from public.spaces where user_id = auth.uid()
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 5. Comments
-- ────────────────────────────────────────────────────────────────────

comment on table public.lab_experiments is
  'Insight Lab — one row per algorithm-stack experiment run. stack_config records what was tried; scores records how it was rated. Phase 6 (manual lab); Phase 7+ adds auto-experimenter agent that writes the same shape.';

comment on table public.lab_insights is
  'Insight Lab — individual insights emitted by a stack run with per-insight provenance + scores. Soft FK on entity_ids so insights survive entity deletion.';

comment on column public.lab_experiments.stack_config is
  'Matches StackConfig in src/lib/insight-lab/types.ts. Shape: { id, name, description?, steps: [{ algoId, params? }] }';

comment on column public.lab_insights.provenance is
  'Matches Provenance in src/lib/insight-lab/types.ts. Shape: { algoId, stepIdx, raw? }';
