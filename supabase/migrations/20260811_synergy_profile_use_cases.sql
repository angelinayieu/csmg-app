-- ── Synergy profile: use_cases (Phase 4d+2) ──
--
-- Captures the user's answer to "What will you use the app for?" on
-- the /app/welcome onboarding screen. Multi-select with custom values
-- allowed — stored as a text[] so the list can grow without another
-- table. Empty array means the user skipped (or hasn't been asked).
--
-- Length caps (≤10 entries, each ≤40 chars) keep the column bounded
-- so the JSON payload to the matcher stays small and prevents abuse
-- of the custom "Add your own" path.

alter table public.synergy_profiles
  add column if not exists use_cases text[] not null default '{}'::text[];

alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_use_cases_shape_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_use_cases_shape_check
  check (
    array_length(use_cases, 1) is null
    or (
      array_length(use_cases, 1) <= 10
      and not exists (
        select 1
        from unnest(use_cases) as t(v)
        where v is null
           or char_length(v) < 1
           or char_length(v) > 40
      )
    )
  );

comment on column public.synergy_profiles.use_cases is
  'User-selected answers to "What will you use the app for?" from the '
  '/app/welcome onboarding. Mix of predefined options (e.g. "Work", '
  '"Learning") and free-form custom values. ≤10 entries, each ≤40 chars.';
