-- 20260704 · ingested_files parse-status (Phase 1, two-phase ingest)
--
-- Splits ingest into:
--   1. upload-and-persist (returns immediately, ~<1s)
--   2. background extraction (pdf-parse / docx / etc.) tracked via parse_status
--
-- Distinct from `extraction_status` which tracks the HITL entity-commit
-- phase that runs AFTER text is parsed.
--
-- Sequence of statuses for an asset:
--   parse_status:      pending → parsing → ready | error | skipped
--   extraction_status: (separate, for HITL drawer flow)
--
-- The 504 the user hits today is /api/ingest blocking on pdf-parse for
-- 30-60s+ until the gateway times out. With this column the route
-- persists row → returns id → schedules background parse via Next 16
-- after() → client polls /api/ingest/[id]/parse-status until ready.

ALTER TABLE ingested_files
  ADD COLUMN IF NOT EXISTS parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsing', 'ready', 'error', 'skipped')),
  ADD COLUMN IF NOT EXISTS parse_error text,
  ADD COLUMN IF NOT EXISTS parse_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS parse_completed_at timestamptz;

-- Backfill: rows that already have normalized_text are 'ready'. Without
-- this, every legacy row would be stuck in 'pending' and the polling
-- client would wait forever for them.
--
-- ingested_files has no updated_at column (intentional — we don't track
-- mutations on this table), so parse_completed_at gets created_at as
-- the closest legitimate timestamp. For rows pre-dating two-phase
-- ingest, parsing happened synchronously in the same request that
-- created the row, so created_at IS the parse-completed time within
-- ~1s anyway.
UPDATE ingested_files
   SET parse_status = 'ready',
       parse_completed_at = created_at
 WHERE parse_status = 'pending'
   AND normalized_text IS NOT NULL
   AND length(normalized_text) > 0;

-- Optional partial index — only `pending` / `parsing` rows are interesting
-- to ops queries (which workers stuck? which never completed?). Tiny
-- footprint because most rows are 'ready'.
CREATE INDEX IF NOT EXISTS idx_ingested_files_parse_pending
  ON ingested_files (parse_status, created_at DESC)
  WHERE parse_status IN ('pending', 'parsing');

COMMENT ON COLUMN ingested_files.parse_status IS
  'Two-phase parse lifecycle: pending (row inserted, parse not started) → parsing (extractor running) → ready (normalized_text populated) | error (parse_error set). Distinct from extraction_status which tracks HITL entity-commit.';

COMMENT ON COLUMN ingested_files.parse_error IS
  'Failure message when parse_status=error. Surfaces in client polling response so UI can render the cause (e.g., "PDF has 250 pages (max 200)").';

COMMENT ON COLUMN ingested_files.parse_started_at IS
  'Timestamp when background parse worker picked up this row. Used for ops timing + abandoned-job detection (rows stuck >10min in parsing).';

COMMENT ON COLUMN ingested_files.parse_completed_at IS
  'Timestamp when parse finished — whether ready or error. Together with parse_started_at gives total parse duration for telemetry.';
