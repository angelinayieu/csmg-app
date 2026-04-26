-- ── R5 Phase A (P5) — twin_diagnostics ──────────────────────────────
--
-- The repo already has two first-class diagnostic producers:
--
--   1. `validateTwinQuality` (src/lib/twin/validate-twin-quality.ts) —
--      returns a `TwinQualityReport` with per-layer scores + issue
--      list (input / coherence / strategy_alignment / trajectory).
--
--   2. `runRealityCalibration` (src/lib/pipeline/reality-calibration.ts +
--      numerical-calibration.ts, upgraded to Tier 3/4 in R2) —
--      returns a `RealityCalibration` with per-baseline reproduction
--      attempts + verdicts.
--
-- Both fire today. Neither is persisted anywhere readable. Reports
-- disappear into the log; calibration lands on `reality_calibrations`
-- keyed by strategy_baseline_id, not by snapshot.
--
-- This migration gives snapshots their own diagnostics row so:
--   - Every snapshot has a readable quality score + issue list that
--     can drive UI affordances ("this snapshot's Trajectory layer is
--     weak — fix before testing scenarios").
--   - Reality calibration results can ride along with the snapshot
--     that triggered them, enabling before/after calibration
--     comparison across scenario applications.
--   - Agents (R5 Phase B) can query "what's wrong with snapshot X"
--     in one SELECT instead of reconstructing the report live.
--
-- One row per (snapshot_id, computed_at). Re-running diagnostics
-- appends a new row rather than overwriting so drift is visible in
-- history — useful when a snapshot is re-diagnosed after a
-- numerical-calibration tolerance change.

create table if not exists public.twin_diagnostics (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null references public.twin_snapshots(id) on delete cascade,

  -- Full TwinQualityReport payload (src/types/twin-diagnostics.ts).
  -- JSONB so the shape can evolve without schema changes — at minimum
  -- carries score / grade / passed / issues[] / layer_scores.
  quality_report jsonb,

  -- Optional RealityCalibration payload. Only populated when the
  -- caller ran calibration alongside (usually skipped on cheap
  -- auto-runs; explicit "deep diagnose" includes it).
  calibration jsonb,

  -- Denormalized summary fields for list views — so a snapshot row
  -- in the drawer can show "72 · 3 issues" without reading the full
  -- quality_report JSONB. Stay in sync with quality_report.score +
  -- quality_report.issues on writes.
  score smallint,
  grade text check (grade in (
    'excellent',
    'good',
    'fair',
    'needs_attention',
    'critical'
  )),
  passed boolean,
  error_count int not null default 0,
  warning_count int not null default 0,
  info_count int not null default 0,

  -- Reality calibration summary, when present. Null when the caller
  -- did not run calibration.
  calibration_status text check (calibration_status in (
    'calibrated',
    'partial',
    'uncalibrated',
    'unknown',
    'bypassed'
  )),
  calibration_score numeric,

  computed_at timestamptz not null default now()
);

-- List the latest report per snapshot cheaply.
create index if not exists idx_twin_diagnostics_snapshot_time
  on public.twin_diagnostics(snapshot_id, computed_at desc);
create index if not exists idx_twin_diagnostics_space
  on public.twin_diagnostics(space_id, computed_at desc);
create index if not exists idx_twin_diagnostics_user
  on public.twin_diagnostics(user_id, computed_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.twin_diagnostics enable row level security;

drop policy if exists "twin_diagnostics_owner" on public.twin_diagnostics;
create policy "twin_diagnostics_owner" on public.twin_diagnostics
  for all using (auth.uid() = user_id);
