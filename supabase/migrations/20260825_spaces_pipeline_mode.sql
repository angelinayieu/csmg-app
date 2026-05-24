-- Phase 7a: pipeline_mode for the human × AI canvas.
--
-- Adds a space-level setting that controls how aggressively the chain
-- pipelines (decompose / synthesize / critique / expand) commit their
-- AI-generated outputs to the knowledge graph.
--
-- Three modes, encoded as a TEXT column with a CHECK constraint
-- (matches the existing `maturity` column pattern; cheaper than a
-- pg enum + simpler to evolve):
--
--   autopilot     — chain stages run fully autonomously and auto-commit.
--                   This is the back-compat default for every existing
--                   space so today's behavior is preserved on first read
--                   after the migration runs.
--
--   review_each   — each chain stage produces a CANDIDATE batch that
--                   opens a review drawer (generalized from the existing
--                   extraction-checklist-drawer pattern). User picks
--                   which candidates to commit; the rest are discarded.
--                   Stages do not auto-chain — the user clicks "Continue"
--                   inside the drawer to advance.
--
--   manual        — no chain pipelines fire at all. The user assembles
--                   the whiteboard by hand using room-materialize
--                   actions (Phase 7c+). Asset drops still upload but
--                   land in the Library drawer without extraction.
--
-- A space's pipeline_mode can be flipped at any time; in-flight runs
-- finish under their original mode. The setting is read at the
-- top of every chain stage endpoint (decompose/route.ts etc.) which
-- decides whether to auto-commit or persist a candidate batch.

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS pipeline_mode TEXT
    NOT NULL
    DEFAULT 'autopilot'
    CHECK (pipeline_mode IN ('autopilot', 'review_each', 'manual'));

COMMENT ON COLUMN public.spaces.pipeline_mode IS
  'Controls how chain pipelines commit AI outputs to the KG. autopilot = auto-commit each stage. review_each = open candidate drawer after each stage. manual = no chain pipelines fire. Default autopilot for back-compat.';

-- Partial index for the analytics use case "how many spaces are in
-- review/manual mode?" The autopilot default sees 99% of rows so a
-- full index would be wasted; partial keeps the index lean.
CREATE INDEX IF NOT EXISTS spaces_pipeline_mode_non_default
  ON public.spaces (pipeline_mode)
  WHERE pipeline_mode <> 'autopilot';
