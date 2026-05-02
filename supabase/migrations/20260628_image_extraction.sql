-- ── Image extraction cache (two-phase ingest, 2026-05-01) ──────────
--
-- Phase 1 of image ingest is now sync-and-empty: /api/ingest inserts
-- the row immediately so the file-card lands on canvas without a
-- multi-second wait. Phase 2 is async: /api/ingest/vision-extract
-- runs a single Claude vision call that returns text + description +
-- entities + relationships, then UPDATEs this row.
--
-- Why first-class columns instead of nesting in `metadata` jsonb:
--   - Apps-architecture rule (project_apps_architecture.md, locked
--     2026-04-17): first-class concepts get first-class columns.
--   - The "needs vision" set must be indexable for backfill / retry.
--   - Downstream features (extract-shape-content, materialize-from-
--     image, useRecursiveDecompose cached path) all read these
--     fields directly; jsonb path queries would be unnecessary
--     friction.
--
-- Backfill: existing image rows have vision_completed_at IS NULL;
-- they keep showing "Analyzing image…" until the user clicks the
-- file-card's "Re-analyze" action. No bulk job — lazy is fine.

ALTER TABLE ingested_files
  -- 2-4 sentence natural-language description of what the image
  -- depicts. The single most useful field for downstream LLM
  -- consumers (lasso-summarize, decompose).
  ADD COLUMN IF NOT EXISTS image_description text,

  -- Discrete things visible in the image. Each entry conforms to
  -- ExtractedEntity in src/lib/ingest/extractors.ts:
  --   { name, type, description, rolePosition? }
  -- Names (not UUIDs) are the join key — UUIDs are assigned at
  -- materialize-from-image time. Lets the cache be portable across
  -- spaces if we ever need to re-materialize.
  ADD COLUMN IF NOT EXISTS extracted_entities jsonb NOT NULL
    DEFAULT '[]'::jsonb,

  -- Visible arrows / groupings / spatial-implication links between
  -- the entities above. Each entry conforms to ExtractedRelationship:
  --   { fromName, toName, label, polarity? }
  -- Resolved against extracted_entities by name during materialize.
  ADD COLUMN IF NOT EXISTS extracted_relationships jsonb NOT NULL
    DEFAULT '[]'::jsonb,

  -- Which model produced the extraction — so we know which rows to
  -- re-run when we upgrade the prompt or model. Free-form string
  -- (e.g. "claude-sonnet-4-5-20251001"). Null when extraction
  -- never ran.
  ADD COLUMN IF NOT EXISTS vision_model text,

  -- ISO when phase 2 finished (success OR failure). Null while
  -- pending. The status badge on file-card uses NULL → "analyzing",
  -- vision_error IS NOT NULL → "failed", otherwise → "ready".
  ADD COLUMN IF NOT EXISTS vision_completed_at timestamptz,

  -- Failure reason if phase 2 errored. Stored as a short string for
  -- the file-card to surface ("Anthropic credit exhausted",
  -- "Image too large", etc.). Null on success.
  ADD COLUMN IF NOT EXISTS vision_error text;

-- Backfill helper: the set of image rows that haven't been analyzed
-- yet. Keeps the future "re-analyze stale extractions" job cheap.
-- Partial index because we only ever query images, never PDFs/text.
CREATE INDEX IF NOT EXISTS idx_ingested_files_vision_pending
  ON ingested_files (created_at DESC)
  WHERE vision_completed_at IS NULL
    AND mime_type LIKE 'image/%';

COMMENT ON COLUMN ingested_files.image_description IS
  'Two-phase image ingest: 2-4 sentence natural-language description from the vision pass.';
COMMENT ON COLUMN ingested_files.extracted_entities IS
  'Two-phase image ingest: ExtractedEntity[] from the vision pass. Materialized into KG nodes.';
COMMENT ON COLUMN ingested_files.extracted_relationships IS
  'Two-phase image ingest: ExtractedRelationship[] from the vision pass. Materialized into KG edges.';
COMMENT ON COLUMN ingested_files.vision_completed_at IS
  'Two-phase image ingest: NULL = still analyzing. Set on success or failure (see vision_error).';
