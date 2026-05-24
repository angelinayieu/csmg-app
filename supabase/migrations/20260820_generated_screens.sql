-- generated_screens: AI-generated prototype mockup images of pipeline
-- artifacts (apps, variations, twins, strategies).
--
-- Why a dedicated table (not jsonb on apps): screens are 1-to-many
-- per artifact (regenerate creates a new screen), need their own
-- status lifecycle (generating → ready / error), reference a polymorphic
-- target via target_kind + target_id, and need fast (space_id) +
-- (target_kind, target_id) indexed scans for the right panel.
--
-- Status lifecycle:
--   pending    — row inserted, image gen call not yet fired
--   generating — image gen in flight
--   ready      — image uploaded, URLs populated
--   error      — gen failed, error_message populated

CREATE TABLE IF NOT EXISTS generated_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Polymorphic target. target_kind ∈ {'app','variation','strategy','twin','intervention','generic'}
  -- target_id is a soft FK (no constraint) because the referenced row
  -- may live in different tables; we just store the uuid string.
  target_kind text NOT NULL,
  target_id uuid,
  target_label text,

  artifact_type text NOT NULL,
  aspect_ratio text NOT NULL,
  prompt_brief text,
  full_prompt text,

  image_url text,
  thumbnail_url text,
  model text DEFAULT 'gpt-image-1',

  status text NOT NULL DEFAULT 'pending',
  error_message text,

  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE generated_screens IS
  'AI-generated prototype mockup images of pipeline artifacts. One artifact (app/variation/strategy/twin) can have many screens (each regenerate creates a new row).';

CREATE INDEX IF NOT EXISTS generated_screens_space_idx
  ON generated_screens (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_screens_target_idx
  ON generated_screens (target_kind, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_screens_status_idx
  ON generated_screens (status)
  WHERE status IN ('pending', 'generating');

CREATE OR REPLACE FUNCTION generated_screens_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generated_screens_updated_at
  BEFORE UPDATE ON generated_screens
  FOR EACH ROW
  EXECUTE FUNCTION generated_screens_set_updated_at();

ALTER TABLE generated_screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own screens"
  ON generated_screens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert their own screens"
  ON generated_screens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update their own screens"
  ON generated_screens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete their own screens"
  ON generated_screens FOR DELETE USING (auth.uid() = user_id);

-- Public storage bucket "screens" + policies for upload + delete.
INSERT INTO storage.buckets (id, name, public)
VALUES ('screens', 'screens', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='Users upload screens to their own folder'
  ) THEN
    CREATE POLICY "Users upload screens to their own folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id='screens' AND (storage.foldername(name))[1]=auth.uid()::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='Users delete their own screen files'
  ) THEN
    CREATE POLICY "Users delete their own screen files"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id='screens' AND (storage.foldername(name))[1]=auth.uid()::text);
  END IF;
END $$;
