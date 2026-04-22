-- ── Axis exemplar library + self-improvement loop (Phase 2E · PR 6) ──
--
-- Two tables implement the 4-stage self-improvement loop described in
-- src/lib/probability-space/DESIGN-self-improvement-loop.md:
--
--   1. axis_candidate_exemplars — every axis output from a run the
--      user rated ≥4 stars. Pending review by the semantic scorer.
--   2. axis_exemplars — the live library. Only candidates that clear
--      the semantic scorer's 0.8 floor land here; retrieval pulls from
--      this table at axis-generation time to few-shot new runs.
--
-- Also adds `axis_output_json` to probability_space_runs so the
-- candidate-capture step has the full LLM output available without
-- replaying it from pipeline_run_events (which carries only the
-- streamed entity events, not the axis_summary + relationship payload
-- as a single record).
--
-- pgvector embedding column on axis_exemplars enables domain-aware
-- retrieval — given a NEW input, find exemplars whose past inputs are
-- semantically similar (rather than random sampling across all
-- exemplars for this axis).

-- ── 1. Column on probability_space_runs ──
--
-- Full LLM output JSON. Populated by the per-axis generator endpoint
-- when it persists the run row; read back when a candidate exemplar
-- row needs to be materialized.
ALTER TABLE probability_space_runs
  ADD COLUMN IF NOT EXISTS axis_output_json jsonb;

COMMENT ON COLUMN probability_space_runs.axis_output_json IS
  'Full AxisGenerationOutput JSON (entities + relationships + axis_summary). Read by candidate-capture when materializing axis_candidate_exemplars rows.';

-- ── 2. axis_candidate_exemplars ──
CREATE TABLE IF NOT EXISTS axis_candidate_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  axis text NOT NULL CHECK (axis IN (
    'financial',
    'timeline',
    'actors',
    'causal_scenarios',
    'evidence',
    'assumptions',
    'risk',
    'cultural'
  )),

  -- ── Input / output snapshots ──
  -- Short snippets shown in admin / audit UIs so reviewers don't need
  -- to load the full JSON. `output_full` is the live JSON that gets
  -- embedded + promoted if the scorer approves.
  input_gist text NOT NULL,
  output_excerpt text NOT NULL,
  output_full jsonb NOT NULL,

  -- ── User signal ──
  -- 1..5 integer rating. Candidates are only created for ratings ≥4
  -- per the design spec, but we store the full 1-5 so we can later
  -- analyze bucket calibration.
  user_rating int NOT NULL CHECK (user_rating BETWEEN 1 AND 5),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional free-text "what stood out / what missed?" from the rating
  -- form. Qualitative signal only — not used by the scorer today.
  user_note text,

  -- ── Scorer output ──
  -- Populated by the semantic scorer cron. Null until reviewed.
  -- Per-dimension breakdown goes in `semantic_breakdown` so we can
  -- debug which dimension fell short without re-scoring.
  semantic_score numeric,
  semantic_breakdown jsonb,
  semantic_review_at timestamptz,
  semantic_notes text,

  -- ── Classification tags (denormalized for retrieval filters) ──
  -- Copied from the question-type classifier result at capture time so
  -- the scorer + retrieval don't need to re-classify.
  domain text,
  question_type text,

  -- ── Lifecycle ──
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review',
    'promoted',
    'archived'
  )),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_axis_candidate_exemplars_pending
  ON axis_candidate_exemplars (status, created_at ASC)
  WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_axis_candidate_exemplars_user
  ON axis_candidate_exemplars (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_axis_candidate_exemplars_run
  ON axis_candidate_exemplars (run_id);

-- ── 3. axis_exemplars ──
CREATE TABLE IF NOT EXISTS axis_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES axis_candidate_exemplars(id) ON DELETE SET NULL,
  axis text NOT NULL CHECK (axis IN (
    'financial',
    'timeline',
    'actors',
    'causal_scenarios',
    'evidence',
    'assumptions',
    'risk',
    'cultural'
  )),

  -- Shape matches AxisExemplar in src/lib/prompts/axis-prompts.ts so
  -- retrieval → prompt seeding is a zero-transform copy.
  input_gist text NOT NULL,
  output_excerpt text NOT NULL,

  -- pgvector of `input_gist` (text-embedding-3-small). Null until the
  -- promotion step backfills it; retrieval filters WHERE embedding IS
  -- NOT NULL so a promoted-but-unembedded row never leaks.
  embedding vector(1536),

  -- Telemetry
  use_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,

  -- Quality provenance — both signals carried forward so retrieval can
  -- rank by combined (cosine × semantic_score) without a candidate join.
  user_rating int NOT NULL,
  semantic_score numeric NOT NULL,

  -- Retrieval filters
  domain text,
  question_type text,

  -- ── Optional manual seed marker ──
  -- When non-null, this row was hand-seeded (not promoted from a
  -- candidate). Used to bootstrap the library before user ratings
  -- accumulate; retrieval treats hand-seeds identically to promotions.
  seeded_by_admin boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- HNSW index for ANN retrieval. Cosine ops because the embedding model
-- is trained for cosine similarity (consistent with memory_items +
-- kg_signatures).
CREATE INDEX IF NOT EXISTS idx_axis_exemplars_embedding
  ON axis_exemplars USING hnsw (embedding vector_cosine_ops);

-- Filter-aware indexes so the pre-ANN filters (axis + optional domain)
-- don't fall back to seq scans on a large library.
CREATE INDEX IF NOT EXISTS idx_axis_exemplars_axis_domain
  ON axis_exemplars (axis, domain, question_type)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_axis_exemplars_score
  ON axis_exemplars (axis, semantic_score DESC)
  WHERE embedding IS NOT NULL;

-- ── 4. Retrieval RPC ──
--
-- Domain-aware ANN retrieval for a given axis + optional (domain,
-- question_type) filter. Returns top-K nearest exemplars, ordered by
-- cosine distance ascending. Caller applies the combined
-- (1 - distance) × semantic_score ranking + salience adjustments.
--
-- SECURITY INVOKER: the library is global knowledge (no per-user
-- ownership check in v1 — exemplars are not PII, they're anonymized
-- output snippets). If we later want per-org libraries, add an
-- owner_org_id column + WHERE filter.
CREATE OR REPLACE FUNCTION public.search_axis_exemplars(
  p_axis text,
  p_query_embedding vector(1536),
  p_k int DEFAULT 3,
  p_domain text DEFAULT NULL,
  p_question_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  axis text,
  input_gist text,
  output_excerpt text,
  user_rating int,
  semantic_score numeric,
  domain text,
  question_type text,
  distance float
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    e.id,
    e.axis,
    e.input_gist,
    e.output_excerpt,
    e.user_rating,
    e.semantic_score,
    e.domain,
    e.question_type,
    (e.embedding <=> p_query_embedding)::float AS distance
  FROM public.axis_exemplars e
  WHERE e.axis = p_axis
    AND e.embedding IS NOT NULL
    AND (p_domain IS NULL OR e.domain = p_domain OR e.domain IS NULL)
    AND (p_question_type IS NULL OR e.question_type = p_question_type OR e.question_type IS NULL)
  ORDER BY e.embedding <=> p_query_embedding
  LIMIT GREATEST(p_k, 1);
$$;

COMMENT ON FUNCTION public.search_axis_exemplars IS
  'ANN retrieval of top-K semantically-closest axis exemplars for a given axis, with optional domain + question_type pre-filters. Caller ranks by (1 - distance) * semantic_score.';

GRANT EXECUTE ON FUNCTION public.search_axis_exemplars(
  text, vector(1536), int, text, text
) TO authenticated;

-- ── 5. RLS ──
--
-- Candidate exemplars: owner-gated (the rater's id is in user_id).
-- Exemplars library: global read, admin-only write. In v1 "admin-only
-- write" is enforced by the cron / scorer endpoint using the service
-- role; RLS blocks authenticated-user writes so a compromised client
-- can't inject poisoned exemplars.

ALTER TABLE axis_candidate_exemplars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "axis_candidate_exemplars_owner_select"
  ON axis_candidate_exemplars
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "axis_candidate_exemplars_owner_insert"
  ON axis_candidate_exemplars
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Service role (scorer cron) updates status / semantic_* fields.
-- Authenticated owners can also update their own rows (e.g. edit their
-- note), but they can't flip status to 'promoted' — a CHECK on the
-- UPDATE isn't expressible in RLS, so the scorer endpoint enforces it.
CREATE POLICY "axis_candidate_exemplars_owner_update"
  ON axis_candidate_exemplars
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE axis_exemplars ENABLE ROW LEVEL SECURITY;

-- Global read access for all authenticated users — the library is
-- shared knowledge. Writes (INSERT/UPDATE/DELETE) are blocked for
-- authenticated; only service role bypasses RLS.
CREATE POLICY "axis_exemplars_read_all_authenticated"
  ON axis_exemplars
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE axis_candidate_exemplars IS
  'Captures every axis output from a run the user rated ≥4 stars. Pending scorer review; promoted to axis_exemplars if semantic_score ≥ 0.8.';
COMMENT ON TABLE axis_exemplars IS
  'Live exemplar library. Pattern-retrieval queries this table (via search_axis_exemplars RPC) to few-shot-seed new axis generations.';
