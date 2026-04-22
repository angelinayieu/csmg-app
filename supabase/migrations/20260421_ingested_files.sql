-- ── Ingested files (Phase 2D) ──
--
-- Persists the output of /api/ingest so uploaded files / URLs /
-- pasted text survive beyond the single parse request. The earlier
-- ingest pipeline was ephemeral — normalized the upload to markdown,
-- returned it to the client, and relied on the client to submit the
-- text through /api/analyze to create a space. That left a real UX
-- gap: if the user walked away mid-flow, the file was gone.
--
-- This table captures every ingest event so users can browse what
-- they've uploaded across the app (Library → Files folder), drag any
-- item back onto a canvas, and trace an entity's provenance back to
-- its source file.
--
-- Scope note: we persist the NORMALIZED TEXT and metadata, not the
-- original binary. Original-file storage (Supabase Storage buckets)
-- is a future follow-up when we need to re-display PDFs or run OCR.

CREATE TABLE IF NOT EXISTS ingested_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Space the ingest was scoped to. NULLABLE — a user may upload
  -- before selecting a space (brand-new flow) or use the universal
  -- lab which isn't space-scoped. When set, the file is visible
  -- inside that space's Files folder.
  space_id uuid REFERENCES spaces(id) ON DELETE CASCADE,

  -- ── Source metadata ────────────────────────────────────────────
  source_type text NOT NULL CHECK (source_type IN ('file', 'url', 'text')),
  -- User-visible filename OR URL OR an inferred title for pasted text.
  source_name text NOT NULL,
  -- Original mime type when available (application/pdf, text/html, etc).
  mime_type text,
  -- Original URL for source_type = 'url'. NULL for files.
  source_url text,

  -- ── Extracted content ─────────────────────────────────────────
  -- Normalized markdown output of the extraction pipeline.
  normalized_text text NOT NULL DEFAULT '',
  raw_chars int NOT NULL DEFAULT 0,
  normalized_chars int NOT NULL DEFAULT 0,
  extraction_method text,

  -- ── Provenance + misc ─────────────────────────────────────────
  -- Arbitrary additional metadata the extractor returned (normalize
  -- chunks, page counts, image OCR confidence, etc.). Keeps the table
  -- schema stable while extraction evolves.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- True once the user has submitted this file through /api/analyze
  -- or otherwise materialized it into entities. Lets the Files folder
  -- show "not yet analyzed" badges for files that were uploaded but
  -- abandoned mid-flow.
  analyzed boolean NOT NULL DEFAULT false,
  -- Space the file was analyzed into (may differ from space_id if
  -- the user moved it). NULL until analyzed.
  analyzed_space_id uuid REFERENCES spaces(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──
-- Per-user listing (most recent first) is the dominant query path.
CREATE INDEX IF NOT EXISTS idx_ingested_files_user_recent
  ON ingested_files (user_id, created_at DESC);
-- Per-space listing for the Files folder in the library drawer.
CREATE INDEX IF NOT EXISTS idx_ingested_files_space
  ON ingested_files (space_id, created_at DESC)
  WHERE space_id IS NOT NULL;
-- Lookup by source_url for dedup — "did I already ingest this link?"
CREATE INDEX IF NOT EXISTS idx_ingested_files_url
  ON ingested_files (user_id, source_url)
  WHERE source_url IS NOT NULL;

-- ── RLS ──
-- Same pattern as every other user-owned table. Only the owning
-- user can see/modify their ingest rows. Space-level sharing rides
-- on the spaces.user_id check downstream.
ALTER TABLE ingested_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingested_files_owner_select"
  ON ingested_files
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ingested_files_owner_insert"
  ON ingested_files
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ingested_files_owner_update"
  ON ingested_files
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ingested_files_owner_delete"
  ON ingested_files
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE ingested_files IS
  'Persisted record of every /api/ingest call. Stores normalized text + metadata so uploads survive the parse/submit gap and surface in the Library''s Files folder.';
COMMENT ON COLUMN ingested_files.analyzed IS
  'True when the user has submitted this file through /api/analyze and the resulting entities live in analyzed_space_id.';
