-- ── Whiteboard comments ──
--
-- One row per comment on an objective whiteboard. A comment is BOTH a
-- visual object on the board (a `comment-card` tldraw shape) AND a
-- durable record here, so it survives a board crash, surfaces in the
-- Library, and can be queried cross-board (AI Chat in "All boards"
-- mode reads from this table).
--
-- Anchoring:
--   target_shape_ids = []   → floating comment, no target
--   target_shape_ids = [id] → attached to one shape (snaps + follows)
--   target_shape_ids = [id, id, …] → grouped comment (strands drawn to each)
-- The bezier strands rendered on the board come from this column; if a
-- target shape is later deleted, the strand vanishes but the comment
-- stays (becomes effectively floating).
--
-- Lifecycle:
--   status='open'      → fresh, unresolved
--   status='resolved'  → user marked it handled
--   status='analyzed'  → the "Analyze on board" extension ran and dropped
--                        a result cluster; analysis_card_ids holds the
--                        tldraw shape IDs of that cluster.
--
-- Owner-only RLS — comments are private to whoever owns the space.

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Snapshotted at creation time so the card can render the author
  -- chip without an extra fetch (matches the voice-note pattern).
  author_name text,
  author_avatar_url text,

  body text NOT NULL DEFAULT '',

  -- tldraw shape IDs (strings like "shape:abc123") of the comment's
  -- targets. Empty array = floating. Order is preserved for the strand
  -- renderer.
  target_shape_ids text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'analyzed')),

  -- tldraw shape IDs of the analysis-cluster cards spawned by the
  -- "Analyze on board" action. Replaced (not appended) on re-analyze.
  analysis_card_ids text[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_space_idx ON comments (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author_id);

-- updated_at auto-refresh
CREATE OR REPLACE FUNCTION set_comments_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comments_updated_at ON comments;
CREATE TRIGGER comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_comments_updated_at();

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select_owner" ON comments;
CREATE POLICY "comments_select_owner" ON comments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM spaces s WHERE s.id = comments.space_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "comments_insert_owner" ON comments;
CREATE POLICY "comments_insert_owner" ON comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM spaces s WHERE s.id = comments.space_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "comments_update_owner" ON comments;
CREATE POLICY "comments_update_owner" ON comments FOR UPDATE
  USING (author_id = auth.uid());

DROP POLICY IF EXISTS "comments_delete_owner" ON comments;
CREATE POLICY "comments_delete_owner" ON comments FOR DELETE
  USING (author_id = auth.uid());
