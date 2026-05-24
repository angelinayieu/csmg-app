-- Two-phase parse pattern: /api/ingest inserts ingested_files rows
-- with normalized_text=NULL and parse_status='pending', then the
-- parse-worker fills in normalized_text asynchronously via after().
-- Until now the column was NOT NULL, so every PDF/DOCX upload failed
-- with:
--   "null value in column normalized_text of relation ingested_files
--    violates not-null constraint"
--
-- The route code at src/app/api/ingest/route.ts:102 explicitly
-- inserts null for the two-phase paths (large files routed to async
-- parse). The DB schema was lagging the code — fix is to make the
-- column nullable so the two-phase pattern can land its placeholder
-- row.
--
-- Downstream readers (asset-preextractor, parse-status endpoint,
-- HITL preview) already guard against null normalized_text — they
-- check parse_status before reading the column. So this change is
-- safe to apply against existing data.

ALTER TABLE ingested_files
  ALTER COLUMN normalized_text DROP NOT NULL;

COMMENT ON COLUMN ingested_files.normalized_text IS
  'Parsed plain text of the asset. Nullable while parse_status is pending/parsing; populated by the parse-worker once parsing completes.';
