-- ── Cold-start safety net (Phase 4d+4) ──
--
-- Two columns on synergy_profiles to enable opt-in email pings when
-- the first real match arrives + a minimum-fit-score override so
-- power-users can tune their own discover threshold.
--
-- Why a column on the profile vs. a separate notifications table?
-- Simplicity. The match-creation hook just reads notify_on_match
-- when it inserts into component_matches. A separate table would
-- need its own cron / fan-out logic. Phase 5 can split this out
-- when we add more notification surfaces (digest emails, weekly
-- summaries, etc.).
--
-- Idempotent — ADD COLUMN IF NOT EXISTS throughout.

alter table public.synergy_profiles
  add column if not exists notify_on_match boolean not null default false;

alter table public.synergy_profiles
  add column if not exists min_match_score integer not null default 60;

alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_min_match_score_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_min_match_score_check
  check (min_match_score between 0 and 100);

comment on column public.synergy_profiles.notify_on_match is
  'When true, the user opts in to email notifications the first time a '
  'match with final_score >= min_match_score lands. Set via the cold-'
  'start empty state on /discover or the profile editor. Email firing '
  'logic lives in @/lib/email/triggers (separate plumbing).';

comment on column public.synergy_profiles.min_match_score is
  'Per-user minimum final_score for matches surfaced in discover. '
  'Default 60. Lower it via the "lower the bar" CTA when the pool is '
  'sparse; raise it via the profile editor when you only want the '
  'highest-quality hits.';
