-- Add spaces.guardrail_answers JSONB so triple-lab can persist
-- user-provided answers to the dynamically-generated guardrail
-- questions. The answers are read by intent-context.ts and injected
-- as constraints into every future LLM call in the space (decompose,
-- synthesize, expansion-recommendations, critic, etc.) — letting the
-- user progressively tighten what counts as a good recommendation /
-- mechanism / leverage point.
--
-- Shape:
--   {
--     "<question_id>": {
--       "answer": "<user's free-text answer>",
--       "answered_at": "<iso8601>",
--       "question_text": "<the original prompt, for audit>",
--       "category": "<falsifiability|mechanism|domain|measurement|...>"
--     }
--   }
--
-- We store the question text alongside the answer because the
-- generation prompt is stochastic — replaying the user's intent later
-- requires the exact question that produced the answer, not just a
-- key reference.

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS guardrail_answers jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN spaces.guardrail_answers IS
  'User answers to dynamically-generated guardrail questions. Injected into every LLM call as a tightening constraint. Keyed by question_id; value carries answer, timestamp, original question text, and category.';

-- GIN index for cheap key existence checks. We only query by space_id
-- (which already has a PK index), but searching across all spaces by
-- guardrail category becomes useful for analytics later.
CREATE INDEX IF NOT EXISTS spaces_guardrail_answers_gin
  ON spaces USING gin (guardrail_answers);
