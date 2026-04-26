-- ── 20260528_situation_frame.sql ──
--
-- Adds `situation_frame` JSONB to public.spaces. Written by the
-- framing-panel stage and consumed by frame-extractor, the layer-
-- coverage gate, and synthesis.
--
-- Shape (see src/types/situation-frame.ts for the canonical TS type):
--
--   {
--     version: 1,
--     framed_at: ISO-string,
--     lenses_used: string[],
--     layer_coverage: [
--       { layer, required_cell_count, permitted_cell_count,
--         intentionally_empty, empty_rationale?, status }
--     ],
--     cells: [
--       { layer, category, status, rationale,
--         supporting_lenses, confidence }
--     ],
--     axes: [
--       { axis_id, source, rationale, target_cells,
--         prompt_variant?, lens_support_count }
--     ],
--     divergences: [
--       { topic, positions[], severity }
--     ],
--     load_bearing_assumptions: [
--       { assumption, named_by, if_false_implication }
--     ],
--     framing_confidence: number,
--     gate_status: 'pass' | 'needs_user_input' | 'needs_more_lenses'
--   }
--
-- Companion to 20260425_data_presence.sql: data_presence says "what
-- raw material did the user bring?" and situation_frame says "given
-- that material + the question, which cells of the layer×category
-- grid must have content for the analysis to be valid?". Together
-- they drive adaptive axis selection without the static
-- (type, domain) matrix being load-bearing.
--
-- Nullable — legacy rows and pre-panel runs stay readable, and every
-- downstream consumer soft-fails to legacy behavior when null.

BEGIN;

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS situation_frame JSONB NULL;

COMMENT ON COLUMN public.spaces.situation_frame IS
  'Framing-panel output. Coordinate grid (layer × category) of cells
   marked required/permitted/irrelevant, plus axes proposed to populate
   them, divergences across lenses, load-bearing assumptions, and a
   gate_status. See src/types/situation-frame.ts for the typed shape.';

-- No index today. The column is read by space_id on a single-row basis
-- (spaces.id is already indexed). Add a GIN index only if we later
-- query inside the JSONB (e.g. "spaces where any layer is missing").

COMMIT;
