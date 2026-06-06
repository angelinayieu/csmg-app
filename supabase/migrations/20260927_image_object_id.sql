-- ── ingested_files.image_object_id ────────────────────────────────
--
-- The seam that lets a board image card carry a stable library_object
-- handle without a per-render lookup. After vision-extract +
-- materialize-image-context, an `image_source` library_object row is
-- upserted (idempotent on source_ref = 'img:'||ingested_files.id); its
-- id is written here. The /api/objective/[id]/images route returns it
-- alongside image_url so deploy can stamp it onto the tldraw shape's
-- props.objectId — which is what the existing drag-connector reads to
-- create object_links to/from this image.
--
-- Nullable + ON DELETE SET NULL so an image without a materialized
-- source row degrades to "untracked" rather than failing reads.

ALTER TABLE ingested_files
  ADD COLUMN IF NOT EXISTS image_object_id uuid
    REFERENCES library_objects(id) ON DELETE SET NULL;

COMMENT ON COLUMN ingested_files.image_object_id IS
  'The library_objects row (object_type=image_source) that addresses this image in the object layer. Lets board image cards carry a stable objectId so the drag-connector + object_links work transparently.';

CREATE INDEX IF NOT EXISTS ingested_files_image_object_id_idx
  ON ingested_files (image_object_id)
  WHERE image_object_id IS NOT NULL;
