-- ── Synergy profile — adjustable background scene (Phase 5 polish) ──
--
-- Per-user background preference, surfaced behind the Rooms page (and
-- optionally the Discover + Dashboard surfaces). Two columns rather
-- than one so the user can have a custom upload AND a preset preference
-- they can toggle back to.
--
-- background_preset: one of a small curated set (defined client-side
-- in src/lib/synergy/scene-presets.ts). Defaults to 'mist' — the
-- subtlest neutral scene. Apple aesthetic: backgrounds are barely
-- there, not photographic vistas.
--
-- background_custom_url: optional Supabase Storage URL for a user-
-- uploaded image. When set AND the preset is 'custom', this drives
-- the render. Otherwise the preset wins. Lets a user prepare a custom
-- image without committing to using it.

alter table public.synergy_profiles
  add column if not exists background_preset text not null default 'mist';

alter table public.synergy_profiles
  add column if not exists background_custom_url text;

-- Allow only known preset values + 'custom' (which delegates to the
-- url). Easier to add new presets later — just drop + re-add the check.
alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_background_preset_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_background_preset_check
  check (background_preset in (
    'mist','dawn','dusk','forest','ocean','monochrome','custom'
  ));

comment on column public.synergy_profiles.background_preset is
  'Curated scene preset key. Maps to a gradient in src/lib/synergy/scene-presets.ts.';
comment on column public.synergy_profiles.background_custom_url is
  'Supabase Storage URL for a user-uploaded background. Used only when '
  'background_preset = ''custom''.';
