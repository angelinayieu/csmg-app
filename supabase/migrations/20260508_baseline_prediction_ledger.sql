-- Item 2 of the App+Strategy Rigor sprint — baseline snapshots + prediction ledger
--
-- Why this exists:
-- Strategies today generate recommendations but do not stamp predicted outcomes
-- anywhere durable. Without a T0 snapshot + a predicted trajectory, there is no
-- way to measure deviation between what the strategy expected and what actually
-- happened. Deviation is the highest-value training signal we have — every
-- surprise is a data point about the user's real-world operating environment
-- that the next strategy generation should incorporate.
--
-- Two tables land here:
--
-- 1. `strategy_baselines` — one row per strategy_snapshot, captured at
--    generation time. Holds the full system state at T0 (kg metrics, twin
--    state, metric baselines, and the strategy's own predicted outcomes in
--    denormalized form so audit doesn't require re-parsing the strategy).
--    Immutable after write.
--
-- 2. `prediction_ledger` — append-only row per (agent-or-pipeline)-emitted
--    forecast. Each prediction has a horizon_at; a cron resolver visits open
--    predictions past their horizon, pulls the actual metric value from
--    metric_observations, computes deviation, and writes a deviation_tag.
--    Resolved predictions become the deviation signal that feeds the Item 4
--    deviation_signal_feed widget and, later, the strategy updater.
--
-- Upstream producers:
--   - src/lib/twin/capture-baseline.ts — called from /api/pipeline/strategy-refresh
--     after strategy_snapshots.insert, seeds both tables from the strategy
--     structure (perspectives.key_metric, micro_tactics.metric, learning_loop.*)
--   - agents (Sprint 3+) — write directly into prediction_ledger via
--     POST /api/apps/:id/action with kind=log_prediction
--
-- Downstream consumers:
--   - /api/cron/predictions-resolve — hourly resolver
--   - deviation_ledger views (Item 4 widgets)
--   - strategy updater (future sprint): on enough "surprise" deviations,
--     trigger regen

-- ── 1. strategy_baselines ────────────────────────────────────────────────

create table if not exists public.strategy_baselines (
  id uuid primary key default gen_random_uuid(),

  -- One baseline per strategy_snapshot. The snapshot already carries
  -- (space_id, version) so we reference it directly instead of duplicating.
  strategy_snapshot_id uuid not null references public.strategy_snapshots(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- When the baseline was captured. Usually seconds after strategy_snapshots
  -- was written but we record explicitly — subsequent strategies can regenerate
  -- faster than the clock rolls, and we want ordering to be unambiguous.
  snapshot_at timestamptz not null default now(),

  -- Full system state at T0. JSONB so schema evolution doesn't require
  -- migrations; shape is owned by src/types/prediction.ts and validated
  -- at the capture boundary.
  --
  -- kg_snapshot: { entity_count, edge_count, cycle_count, bridge_count,
  --                orphan_ratio, avg_confidence, health_score }
  kg_snapshot jsonb not null,

  -- twin_state: full TwinState serialization (health_score, coverage,
  -- risk_exposure, dynamics, lab cards). Useful to replay the twin
  -- computation post-hoc even if compute logic changes.
  twin_state jsonb not null,

  -- metric_baselines: [{ tracker_id?, label, value?, value_text?, unit,
  --                      source_kind, captured_from: "tracker"|"strategy_text" }]
  -- Denormalized from metric_trackers at capture time so later tracker
  -- edits don't rewrite history.
  metric_baselines jsonb not null,

  -- predicted_outcomes: [{ metric_label, horizon, predicted_value?,
  --                        predicted_text?, confidence, rationale,
  --                        source: "perspective"|"tactic"|"leading_indicator" }]
  -- Denormalized derivation of the strategy's own forecasts. Each entry
  -- also lands as a prediction_ledger row at capture time; we keep it
  -- here too so a single baseline row is a full audit record.
  predicted_outcomes jsonb not null,

  -- Provenance — who created this baseline. Usually "pipeline:strategy-refresh"
  -- but agents or backfill jobs can write too.
  created_by text not null,

  -- Optional free-form notes from the capture step (e.g. "tracker X missing,
  -- used strategy text as baseline").
  capture_notes text,

  constraint uq_strategy_baselines_per_snapshot unique (strategy_snapshot_id)
);

create index if not exists idx_strategy_baselines_space_time
  on public.strategy_baselines(space_id, snapshot_at desc);
create index if not exists idx_strategy_baselines_user
  on public.strategy_baselines(user_id, snapshot_at desc);

comment on table public.strategy_baselines is
  'Immutable T0 snapshot captured when a strategy is generated. Pairs 1:1 with '
  'strategy_snapshots and holds kg_snapshot, twin_state, metric_baselines, and '
  'predicted_outcomes so deviation measurement later has something to compare against.';

-- ── 2. prediction_ledger ─────────────────────────────────────────────────

create table if not exists public.prediction_ledger (
  id uuid primary key default gen_random_uuid(),

  -- Scope
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Optional association with a specific strategy + app + agent.
  -- strategy_snapshot_id is NULL for agent-emitted predictions that
  -- aren't tied to a pipeline run (ad-hoc "I predict X"); app_id/agent_id
  -- are NULL for pipeline-emitted predictions derived from the strategy
  -- structure itself.
  strategy_snapshot_id uuid references public.strategy_snapshots(id) on delete set null,
  app_id uuid references public.apps(id) on delete set null,
  agent_id text,  -- matches AgentSpec.id in the proposal's agent_specs

  -- Metric association. Prefer tracker_id when an existing metric_tracker
  -- matches; otherwise fall back to metric_label (always set).
  tracker_id uuid references public.metric_trackers(id) on delete set null,
  metric_label text not null,
  metric_unit text,

  -- Forecast
  predicted_at timestamptz not null default now(),
  -- When this prediction should be evaluated. Resolver picks up rows where
  -- horizon_at <= now() and status = 'open'.
  horizon_at timestamptz not null,

  -- Two-lane value: numeric for quantitative metrics, text for qualitative.
  -- At least one must be non-null (enforced by check).
  predicted_value numeric,
  predicted_value_text text,
  -- Optional calibrated distribution (e.g. { p10, p50, p90 }) for predictors
  -- that emit uncertainty envelopes rather than point forecasts.
  predicted_distribution jsonb,

  -- Why the prediction was made — fuel for later post-mortem on why
  -- deviations occurred.
  rationale text,
  -- Self-reported 0-1 confidence. Over-confident predictors on fresh
  -- domains get flagged in the resolver's deviation_tag.
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Lifecycle
  -- open     — not yet past horizon or not yet resolved
  -- resolved — resolver found an actual + wrote deviation
  -- abandoned — strategy superseded or tracker archived before horizon
  status text not null default 'open'
    check (status in ('open', 'resolved', 'abandoned')),

  -- Resolution fields (null until status != 'open')
  resolved_actual numeric,
  resolved_actual_text text,
  resolved_at timestamptz,
  -- (actual - predicted) — raw numeric deviation for quantitative predictions.
  -- NULL for qualitative (text) resolutions.
  deviation numeric,
  -- Resolver-assigned tag. Thresholds are in resolve-predictions.ts:
  --   "expected"      — within +/-10% of predicted
  --   "regime_shift"  — 10%-50% off, directionally consistent
  --   "surprise"      — >50% off or wrong direction (high-value training signal)
  --   "qualitative"   — text resolution, no numeric comparison possible
  deviation_tag text
    check (deviation_tag is null or deviation_tag in ('expected', 'regime_shift', 'surprise', 'qualitative')),
  -- Free-form note the resolver writes when assigning the tag (e.g.
  -- "tracker had no observation within 48h of horizon — marked abandoned").
  resolution_notes text,

  -- At least one of the value lanes must be filled at prediction time.
  constraint prediction_has_value check (
    predicted_value is not null or predicted_value_text is not null
  )
);

-- Resolver hot path: find open predictions past their horizon
create index if not exists idx_prediction_ledger_open_horizon
  on public.prediction_ledger(horizon_at)
  where status = 'open';

-- Per-space queries (e.g. app widget showing open predictions)
create index if not exists idx_prediction_ledger_space_status
  on public.prediction_ledger(space_id, status, predicted_at desc);

-- Per-app queries (e.g. prediction_panel widget)
create index if not exists idx_prediction_ledger_app
  on public.prediction_ledger(app_id, status) where app_id is not null;

-- Per-tracker queries (resolver joins tracker → observations)
create index if not exists idx_prediction_ledger_tracker
  on public.prediction_ledger(tracker_id) where tracker_id is not null;

-- Surprise feed — deviation_signal_feed widget queries this
create index if not exists idx_prediction_ledger_surprises
  on public.prediction_ledger(space_id, resolved_at desc)
  where status = 'resolved' and deviation_tag = 'surprise';

comment on table public.prediction_ledger is
  'Append-only ledger of forecasts emitted by the strategy pipeline or by app '
  'agents. Resolver cron visits open predictions past horizon_at, fills in the '
  'actual from metric_observations, computes deviation, and tags surprise. '
  'Resolved predictions feed deviation_signal_feed and, eventually, strategy '
  'updater regen triggers.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────

alter table public.strategy_baselines enable row level security;
alter table public.prediction_ledger enable row level security;

drop policy if exists "owner_all_strategy_baselines" on public.strategy_baselines;
create policy "owner_all_strategy_baselines" on public.strategy_baselines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all_prediction_ledger" on public.prediction_ledger;
create policy "owner_all_prediction_ledger" on public.prediction_ledger
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Service role bypasses RLS (used by the resolver cron and capture pipeline).
-- No explicit grant needed — service_role has bypass by default.
