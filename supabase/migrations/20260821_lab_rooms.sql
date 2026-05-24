-- lab_rooms — flexible room placements inside the Synthesis Lab.
--
-- See the table comment + column comments for the full data model.
-- This migration matches the version applied to live Supabase via MCP.

CREATE TABLE IF NOT EXISTS lab_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  column_slot text NOT NULL CHECK (column_slot IN ('left', 'middle', 'right')),
  position int NOT NULL DEFAULT 0,
  kind text NOT NULL,
  room_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  collapsed boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE lab_rooms IS
  'Flexible per-column room placements inside the Synthesis Lab. Each space has its own room stack per column. is_default rooms (raw_signal, insights, final_artifacts) are system-seeded; user-added rooms (brainstorm_session, reading_notes, etc.) extend the stack.';

CREATE INDEX IF NOT EXISTS lab_rooms_space_idx
  ON lab_rooms (space_id, column_slot, position);

CREATE OR REPLACE FUNCTION lab_rooms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lab_rooms_updated_at
  BEFORE UPDATE ON lab_rooms
  FOR EACH ROW
  EXECUTE FUNCTION lab_rooms_set_updated_at();

ALTER TABLE lab_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own lab rooms"
  ON lab_rooms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert their own lab rooms"
  ON lab_rooms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update their own lab rooms"
  ON lab_rooms FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete their own lab rooms"
  ON lab_rooms FOR DELETE USING (auth.uid() = user_id);
