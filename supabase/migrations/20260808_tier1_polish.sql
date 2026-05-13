-- ── Tier-1 polish migration ──
--
-- Adds three small column additions that round out features whose
-- UI/code layers were partially in place:
--
--   1. synergy_profiles.last_match_notified_at
--      Throttles the notify-on-match email so users get at most one
--      summary per 24h regardless of how often the matcher cron runs.
--
--   2. brainstorm_sessions.last_extracted_node_count + last_extracted_at
--      Used by the Strategy Doc + Focus Mode to detect when the board
--      has grown materially since the last component extraction and
--      offer a re-extraction CTA.
--
--   3. Supabase Storage bucket `synergy_avatars` (idempotent insert)
--      + RLS policies for owner-only write + public read.
--
-- Fully idempotent — same pattern as the prior synergy migrations.

-- ── 1. last_match_notified_at ──

alter table public.synergy_profiles
  add column if not exists last_match_notified_at timestamptz;

-- ── 2. extraction staleness markers on sessions ──

alter table public.brainstorm_sessions
  add column if not exists last_extracted_at timestamptz;

alter table public.brainstorm_sessions
  add column if not exists last_extracted_node_count integer;

-- ── 3. Avatar storage bucket ──
--
-- Supabase exposes storage via the `storage.buckets` table and
-- `storage.objects` with its own RLS. We make the bucket idempotently
-- and add minimal policies. Files are public-read (so the avatar URL
-- works in the room canvas + inbox without auth headers) but
-- owner-only write — enforced by the user-id prefix convention:
-- avatars are stored at `<user_id>/<filename>`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'synergy_avatars',
  'synergy_avatars',
  true,
  524288,                                -- 512 KB cap
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "synergy_avatars_public_read" on storage.objects;
create policy "synergy_avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'synergy_avatars');

-- The 'name' column in storage.objects stores the path. We enforce
-- that the path begins with the authenticated user's uuid so each
-- user can only write their own avatar.
drop policy if exists "synergy_avatars_owner_insert" on storage.objects;
create policy "synergy_avatars_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'synergy_avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "synergy_avatars_owner_update" on storage.objects;
create policy "synergy_avatars_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'synergy_avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'synergy_avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "synergy_avatars_owner_delete" on storage.objects;
create policy "synergy_avatars_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'synergy_avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on column public.synergy_profiles.last_match_notified_at is
  'Throttle anchor for notify-on-match emails. Set whenever we send a '
  'match-surfaced email so subsequent matcher runs do not re-spam.';

comment on column public.brainstorm_sessions.last_extracted_at is
  'When extract-components last ran for this session. Used to detect '
  'stale extraction after meaningful board growth.';
