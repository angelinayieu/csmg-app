-- ── 20260529_reality_calibration.sql ──
--
-- Gap B — reality calibration. Before the simulation lab is allowed to
-- render proposal outcomes, we have to prove the KG can reproduce the
-- user's stated baselines. One row per (strategy_baseline_id) holding
-- the verdict per MetricBaseline + aggregate calibration score.
--
-- Written by src/lib/pipeline/reality-calibration.ts, read by:
--   - /api/lab/calibration (GET)              — feeds CalibrationStatusStrip
--   - src/lib/pipeline/extract-twin-proposal  — gates proposal materialization
--
-- `attempts` carries a ReproductionAttempt[] (see src/types/calibration.ts).
-- Kept as JSONB rather than a child table because attempts are never
-- queried individually — they're rendered as a set in the review-gaps
-- drawer and the persistence round-trip is cheaper as one JSON blob.
--
-- Invariant: `reproduced_count + (off_count) + (unverifiable_count) ==
-- total_count`. Not enforced by a constraint because the counts aren't
-- stored explicitly — they're derived from `attempts` on read. We DO
-- enforce `status` matches `aggregate_calibration(attempts)` via a
-- trigger so bogus rows can't slip into UI that gates on status alone.

create table if not exists public.reality_calibrations (
  id uuid primary key default gen_random_uuid(),
  strategy_baseline_id uuid not null unique
    references public.strategy_baselines (id) on delete cascade,
  space_id uuid not null
    references public.spaces (id) on delete cascade,
  status text not null check (status in (
    'unknown', 'uncalibrated', 'partial', 'calibrated', 'bypassed'
  )),
  reproduced_count int not null default 0,
  total_count int not null default 0,
  aggregate_score numeric(4, 3) not null default 1.000 check (aggregate_score between 0 and 1),
  attempts jsonb not null default '[]'::jsonb,
  agent_version int not null default 1,
  bypassed_at timestamptz,
  bypassed_by uuid references auth.users (id) on delete set null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reality_calibrations_space_idx
  on public.reality_calibrations (space_id, computed_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────
--
-- Same ownership rule as strategy_baselines: a user can read / write
-- a calibration row iff they own the parent space. Service role (used
-- by the pipeline) bypasses RLS.

alter table public.reality_calibrations enable row level security;

create policy reality_calibrations_owner_select
  on public.reality_calibrations
  for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = reality_calibrations.space_id
        and s.user_id = auth.uid()
    )
  );

create policy reality_calibrations_owner_update
  on public.reality_calibrations
  for update
  using (
    exists (
      select 1 from public.spaces s
      where s.id = reality_calibrations.space_id
        and s.user_id = auth.uid()
    )
  );

-- Inserts + bypass flip only via service role (pipeline) — no insert
-- policy so authenticated users can't seed rows. The `run anyway`
-- escape hatch is an UPDATE on bypassed_at/bypassed_by and falls
-- under the update policy above.

-- ── Touch updated_at on every update ─────────────────────────────────

create or replace function public.touch_reality_calibrations_updated_at()
returns trigger
language plpgsql
as $touch_rc$
begin
  new.updated_at := now();
  return new;
end;
$touch_rc$;

drop trigger if exists reality_calibrations_touch_updated_at
  on public.reality_calibrations;
create trigger reality_calibrations_touch_updated_at
  before update on public.reality_calibrations
  for each row execute function public.touch_reality_calibrations_updated_at();

-- ── Status coherence trigger ────────────────────────────────────────
--
-- Keeps `status` in sync with `reproduced_count` / `total_count` so
-- the CalibrationStatusStrip can read `status` alone without second-
-- guessing the counts. The `bypassed` state is user-driven and
-- preserved across recomputes — we don't overwrite it here.

create or replace function public.enforce_reality_calibration_status()
returns trigger
language plpgsql
as $enforce_rc_status$
begin
  if new.status = 'bypassed' then
    return new;
  end if;
  if new.total_count = 0 then
    new.status := 'unknown';
  elsif new.reproduced_count = new.total_count then
    new.status := 'calibrated';
  elsif new.reproduced_count = 0 then
    new.status := 'uncalibrated';
  else
    new.status := 'partial';
  end if;
  return new;
end;
$enforce_rc_status$;

drop trigger if exists reality_calibrations_enforce_status
  on public.reality_calibrations;
create trigger reality_calibrations_enforce_status
  before insert or update on public.reality_calibrations
  for each row execute function public.enforce_reality_calibration_status();

comment on table public.reality_calibrations is
  'Gap B — per-baseline verdict on whether the KG reproduces the user''s stated reality. Gates the simulation labs.';
comment on column public.reality_calibrations.attempts is
  'ReproductionAttempt[] — see src/types/calibration.ts for the canonical shape.';
comment on column public.reality_calibrations.aggregate_score is
  '0..1 summary: 1.0 iff all baselines reproduce; unverifiable attempts count as 0.5.';
