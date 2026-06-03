-- ── Library object cards: AI face + node-scoped metadata ──
--
-- Backs the Feature/Variable whiteboard cards (library_objects rows,
-- object_type 'feature' | 'variable'). Additive only — reuses the locked
-- library_objects / object_links foundation.
--
--   • library_objects.card_face — the AI-refined face shown on the board
--     card: { name, body, from_updated_at }. Regenerated from the card's
--     metadata (sources/notes/connections). Twin of spaces.card_brief.
--   • library_object_sources — node↔ingested_files bridge (M:N) so an
--     uploaded image/paper/file (and its existing vision/extraction
--     analysis) can be attached to a specific card.
--   • library_object_notes — per-card user ideas / intentions / taste text.
--
-- Variable↔Feature upstream/downstream connections reuse object_links
-- ('feeds' / 'depends_on') — no new table.

ALTER TABLE library_objects
  ADD COLUMN IF NOT EXISTS card_face jsonb;

COMMENT ON COLUMN library_objects.card_face IS
  'AI-refined board-card face { name, body, from_updated_at }, regenerated from the object metadata (sources/notes/connections). Twin of spaces.card_brief.';

-- ── Node ↔ source bridge ──
CREATE TABLE IF NOT EXISTS library_object_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES library_objects(id) ON DELETE CASCADE,
  ingested_file_id uuid NOT NULL REFERENCES ingested_files(id) ON DELETE CASCADE,
  -- How this source informs the card (free-text: 'paper' | 'image' | 'reference' | ...).
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_id, ingested_file_id)
);

CREATE INDEX IF NOT EXISTS idx_library_object_sources_object
  ON library_object_sources (object_id);

ALTER TABLE library_object_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library_object_sources_owner_all" ON library_object_sources;
CREATE POLICY "library_object_sources_owner_all"
  ON library_object_sources FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Per-card user notes (ideas / intentions / taste) ──
CREATE TABLE IF NOT EXISTS library_object_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES library_objects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('idea', 'intention', 'taste', 'note')),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_object_notes_object
  ON library_object_notes (object_id, created_at DESC);

ALTER TABLE library_object_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library_object_notes_owner_all" ON library_object_notes;
CREATE POLICY "library_object_notes_owner_all"
  ON library_object_notes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE library_object_sources IS
  'Node-to-source bridge: attaches an ingested_files row (paper/image/file + its analysis) to a specific library_objects card. M:N. Owner-only RLS.';
COMMENT ON TABLE library_object_notes IS
  'Per-card user metadata: ideas / intentions / taste / notes that refine the card definition. Owner-only RLS.';
