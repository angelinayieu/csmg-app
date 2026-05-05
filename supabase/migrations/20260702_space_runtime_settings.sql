-- ── Per-space runtime control for background crons ──
--
-- The cron jobs that drive the deviation feedback loop —
-- /api/cron/agent-runtime (every 2h) and /api/cron/predictions-resolve
-- (hourly) — are scheduled globally in vercel.json. Today the user has
-- no way to throttle, pause, or disable these for a specific space.
-- Power users with many spaces (or a stale archive space) hit two
-- problems:
--
--   1. Cost — predictor agents keep firing on inactive apps; LLM tokens
--      burn for no value
--   2. Surprise — predictions keep resolving against stale baselines,
--      polluting the calibration feedback loop with deviations the user
--      isn't tracking anymore
--
-- This column lets the user gate WHICH spaces a global cron tick should
-- act on. The cron still fires on its global schedule, but iterates
-- only spaces whose settings allow the tick to do work.
--
-- Default: all crons enabled at their natural cadence (matches today's
-- behavior — additive change).
--
-- Schema (JSONB, nullable; null = "use defaults"):
-- {
--   "agent_runtime": {
--     "enabled":       boolean,    -- master toggle (default: true)
--     "cadence_hours": number,     -- min interval between runs (default: 2)
--     "paused_until":  ISO|null    -- temp pause; ignored if past
--   },
--   "predictions_resolve": {
--     "enabled":       boolean,    -- (default: true)
--     "cadence_hours": number      -- (default: 1)
--   },
--   "last_runs": {
--     "agent_runtime":       ISO|null,  -- stamped by scheduler at run time
--     "predictions_resolve": ISO|null   -- stamped by resolver at run time
--   }
-- }
--
-- Idempotent: re-running this migration is a no-op.

alter table public.spaces
  add column if not exists runtime_settings jsonb;

comment on column public.spaces.runtime_settings is
  'Per-space cron gating. NULL = global defaults. JSONB shape: { agent_runtime: { enabled, cadence_hours, paused_until }, predictions_resolve: { enabled, cadence_hours }, last_runs: { agent_runtime, predictions_resolve } }. Read by /api/cron/agent-runtime and /api/cron/predictions-resolve to decide whether to act on this space; written by the scheduler to record last-run timestamps + by /api/spaces/[id]/runtime-settings PATCH for user-driven changes.';
