-- ── Image narrative + slugified concepts (taste-prose pass) ─────────
--
-- Second pass after vision extraction (see 20260628_image_extraction):
--   image_description (technical 2-4 sentences) → already populated
--   image_narrative   (taste-aware prose tying image to objective + glossary)
--   image_concepts    (slugified concept_slug list — the cross-surface join key)
--
-- The slugs in image_concepts share the SAME namespace as objective
-- annotations + glossary + library_objects.content_snapshot.concept_slug.
-- That is the seam that lets a glossary term trace back to "this image"
-- and a downstream artifact trace back through `concept_slug` joins.
--
-- Written by src/lib/objective-canvas/materialize-image-context.ts after
-- vision-extract completes. Soft-fail; consumers tolerate null/[].

ALTER TABLE ingested_files
  ADD COLUMN IF NOT EXISTS image_narrative text,
  ADD COLUMN IF NOT EXISTS image_concepts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ingested_files.image_narrative IS
  'Taste-aware narrative tying image content to the user objective + glossary. Written by materialize-image-context after vision extraction.';
COMMENT ON COLUMN ingested_files.image_concepts IS
  'Slugified concept_slug list materialized from extracted_entities. Each slug joins the cross-surface namespace (annotations, glossary, library_objects.content_snapshot).';
