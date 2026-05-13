-- ── Synergy onboarding flag (Phase 4d+1) ──
--
-- New column on synergy_profiles to distinguish "haven't seen the
-- welcome flow yet" from "saw it and explicitly skipped/finished".
-- The /app home redirects to /app/welcome when the flag is null;
-- /app/welcome sets it to now() on either Save or Skip.
--
-- Why a column vs. inferring from bio presence? Because we want to
-- respect "I deliberately skipped" — a user with no bio who already
-- went through onboarding shouldn't see the welcome screen again.

alter table public.synergy_profiles
  add column if not exists onboarding_completed_at timestamptz;

-- Backfill: any existing profile (created via the matcher's auto-
-- bootstrap path before this migration) gets onboarding_completed_at
-- = created_at, since the user has already been using the app.
-- Idempotent — re-running won't overwrite already-set values.
update public.synergy_profiles
   set onboarding_completed_at = created_at
 where onboarding_completed_at is null;

comment on column public.synergy_profiles.onboarding_completed_at is
  'When the user completed (or skipped) the /app/welcome onboarding. '
  'Null only for fresh signups who haven''t hit /app yet. The /app '
  'home redirects to /welcome when this is null.';
