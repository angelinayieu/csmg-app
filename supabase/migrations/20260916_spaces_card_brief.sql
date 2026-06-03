-- ── Spaces card brief (home library cards) ──
--
-- A small AI-generated summary surfaced on each library card on the home
-- page: a punchy name + 2-3 concise key points (the most important notes /
-- final statements). Cached here so the home doesn't regenerate on every
-- render; regenerated when stale (the cached from_updated_at predates
-- spaces.updated_at).
--
-- Shape: { "name": string, "points": string[], "from_updated_at": string }
-- Written by /api/spaces/[id]/card-brief (summarizeSpaceCard).

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS card_brief jsonb;

COMMENT ON COLUMN spaces.card_brief IS
  'AI-generated home-library-card summary: { name, points[], from_updated_at }. Cached + staleness-gated; written by /api/spaces/[id]/card-brief.';
