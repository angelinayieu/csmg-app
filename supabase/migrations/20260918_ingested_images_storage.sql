-- ingested-images: stored image binaries so analyzed images can be
-- re-displayed as cards on the whiteboard. Mirrors the synergy_avatars
-- bucket — public-read (URL works without auth headers), owner-only write
-- via the user-id path prefix.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ingested-images',
  'ingested-images',
  true,
  10485760, -- 10 MB
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do nothing;

drop policy if exists "ingested_images_public_read" on storage.objects;
create policy "ingested_images_public_read"
  on storage.objects for select
  using (bucket_id = 'ingested-images');

drop policy if exists "ingested_images_owner_insert" on storage.objects;
create policy "ingested_images_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'ingested-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "ingested_images_owner_update" on storage.objects;
create policy "ingested_images_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'ingested-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "ingested_images_owner_delete" on storage.objects;
create policy "ingested_images_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'ingested-images'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Public URL of the stored image binary (null for non-images / upload failures).
alter table public.ingested_files add column if not exists image_url text;
