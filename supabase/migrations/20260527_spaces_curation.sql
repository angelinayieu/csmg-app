-- ── 20260527_spaces_curation.sql ──
--
-- Adds three columns to `spaces` so the immersive home's whiteboard
-- grid can curate + auto-categorize without depending on the parallel
-- `canvases` table.
--
--   pinned                     — user pin for sticky-top sort
--   archived                   — soft-delete; default-excluded from grid
--   dominant_entity_category   — auto-set at pipeline finalize using
--                                the most common entity_category among
--                                that space's entities. Drives the
--                                category filter chip in WhiteboardsGrid.

BEGIN;

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dominant_entity_category TEXT NULL;

-- Partial indexes — the grid query is "non-archived, sort by pinned
-- desc then updated_at desc". A partial index on archived=false keeps
-- list reads cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_spaces_user_active_updated
  ON public.spaces (user_id, pinned DESC, updated_at DESC)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS idx_spaces_user_archived
  ON public.spaces (user_id, updated_at DESC)
  WHERE archived = true;

-- RLS already gates by user_id ("Users see own spaces" policy in
-- schema.sql) — these columns inherit that gate, no policy change.

COMMIT;
