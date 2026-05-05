-- ── Atomic last-run timestamps for the per-space cron gate ──
--
-- Phase A landed `runtime_settings JSONB` with `last_runs.{cron_kind}`
-- nested inside it. Two crons (agent-runtime + predictions-resolve)
-- both stamp this field; under concurrent execution they race:
--
--   T0  agent-runtime reads      {last_runs: {ar: T-2h, pr: T-1h}}
--   T0  predictions-resolve reads same
--   T2  agent-runtime writes     {last_runs: {ar: T2,   pr: T-1h}}
--   T3  predictions-resolve writes {last_runs: {ar: T-2h, pr: T3}}  ← AR stamp lost
--
-- Splitting the two stamps into top-level columns gives Postgres-level
-- atomic single-column writes — no read-modify-write window, no merge
-- needed. Settings (enabled, cadence, paused_until) stay in JSONB
-- because they're user-edited together; only the auto-stamped run
-- timestamps move out.
--
-- Migration is additive + idempotent — the helper module continues to
-- read `runtime_settings.last_runs` for one cycle as a back-compat
-- reader (returns `null`, defaults flow through), then is updated to
-- consume these columns in the same PR.

alter table public.spaces
  add column if not exists last_agent_runtime_at timestamptz,
  add column if not exists last_predictions_resolve_at timestamptz;

comment on column public.spaces.last_agent_runtime_at is
  'When the agent-runtime cron last successfully ran for this space. Stamped by src/lib/agents/scheduler.ts after the per-app loop completes; read by the same scheduler on the next tick to enforce runtime_settings.agent_runtime.cadence_hours. Single-column write so the JSONB merge race that affected the previous nested-stamp design is gone.';

comment on column public.spaces.last_predictions_resolve_at is
  'When the predictions-resolve cron last touched this space. Stamped by src/lib/twin/resolve-predictions.ts after the batch resolves at least one prediction in this space; read by the same resolver to enforce cadence_hours and to extend staleCutoff for predictions whose space was paused (so unpausing doesn''t silently abandon predictions whose resolution window elapsed during the pause).';
