-- ── Arc 5A — Shape threads (comment sub-branching on canvas) ──────────
--
-- The freestyle canvas (InteraxisCanvas) previously had a `comment` tool
-- that was a stub — `case "comment": setTool("select"); break;` did
-- nothing. Arc 5 turns it into a first-class primitive: rooted comment
-- threads that can sub-branch from any shape, with an AI sidecar per-card
-- (Arc 5B) and surgical strategy edits coming from the chat (Arc 5C/D).
--
-- Why a dedicated table (not tldraw snapshot JSON):
--   - Survives tldraw model schema changes cleanly
--   - Queryable for cross-session thread lookup, multi-user collab later
--   - Enables soft-delete (undo) + authorship tracking without stuffing
--     those into shape props
--   - Server-side rendering for notifications / email digest (future)
--
-- Relationship model:
--   - `shape_id` is the tldraw shape id (e.g. "shape:abc123"). NOT a UUID
--     — tldraw owns these. We treat them as opaque strings.
--   - `parent_shape_id` is the immediate parent. NULL means root thread
--     (anchored to a non-thread shape: strategy card, sticky, KG node).
--   - `root_shape_id` is the top-level non-thread shape this whole tree
--     hangs off of. Denormalized for fast "load all threads for this
--     card" queries — a depth-N walk up the tree on every render would
--     be expensive.
--   - `thread_depth` is 0 for root threads (parent_shape_id IS NULL),
--     1 for first-level children, up to max 3 (enforced client-side for
--     visual clarity; no DB constraint since depth could grow if we
--     lift the UI cap later).
--
-- Soft delete pattern: `deleted_at` gates visibility. Keep the row so
-- undo works even across page reloads, and so the tldraw shape can be
-- restored from DB on hydrate after a client crash. Hard delete is a
-- separate cron we don't need yet.

CREATE TABLE public.shape_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- tldraw identifiers (opaque strings)
  shape_id        text NOT NULL,
  parent_shape_id text,
  root_shape_id   text NOT NULL,
  thread_depth    int NOT NULL DEFAULT 0 CHECK (thread_depth >= 0 AND thread_depth <= 8),

  -- Content
  content         text NOT NULL DEFAULT '',
  author_display  text, -- Snapshot of display_name at creation time; survives profile renames

  -- Lifecycle
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz, -- Soft delete

  CONSTRAINT shape_threads_shape_id_unique UNIQUE (shape_id)
);

-- Fast "load all threads rooted on this card" (canvas mount + selection).
CREATE INDEX idx_shape_threads_root_space
  ON public.shape_threads (space_id, root_shape_id)
  WHERE deleted_at IS NULL;

-- Fast "load my thread tree" on a page refresh.
CREATE INDEX idx_shape_threads_space_user
  ON public.shape_threads (space_id, user_id)
  WHERE deleted_at IS NULL;

-- Parent chain walks + sub-branch expansion.
CREATE INDEX idx_shape_threads_parent
  ON public.shape_threads (parent_shape_id)
  WHERE deleted_at IS NULL AND parent_shape_id IS NOT NULL;

-- Keep updated_at fresh on PATCH
CREATE OR REPLACE FUNCTION public.shape_threads_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER shape_threads_updated_at
  BEFORE UPDATE ON public.shape_threads
  FOR EACH ROW EXECUTE FUNCTION public.shape_threads_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.shape_threads ENABLE ROW LEVEL SECURITY;

-- Users can only see threads in spaces they own.
-- Using spaces table FK — matches the existing pattern in other Arc migrations.
CREATE POLICY "shape_threads_select_own_space" ON public.shape_threads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.spaces s
      WHERE s.id = shape_threads.space_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "shape_threads_insert_own_space" ON public.shape_threads
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.spaces s
      WHERE s.id = shape_threads.space_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "shape_threads_update_own" ON public.shape_threads
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "shape_threads_delete_own" ON public.shape_threads
  FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE public.shape_threads IS
  'Sub-branching comment threads rooted on canvas shapes. Arc 5A.';
COMMENT ON COLUMN public.shape_threads.shape_id IS
  'tldraw shape id (e.g. "shape:abc123"). NOT a UUID.';
COMMENT ON COLUMN public.shape_threads.root_shape_id IS
  'Top-level non-thread shape this tree is anchored on. Denormalized for fast queries.';
COMMENT ON COLUMN public.shape_threads.deleted_at IS
  'Soft delete gate. Survives page reload so undo works across sessions.';
