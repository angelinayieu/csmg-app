-- Claim Stack mode in the Synthesis Lab lets the user drag-reorder
-- claims by perceived impact on the optimization point. Persist the
-- order as a numeric weight in 0..1 (1 = top, 0 = bottom) so:
--   - we can sort with a deterministic ORDER BY claim_weight DESC NULLS LAST
--   - the user can mix manual + auto weights (null = use synthesis-
--     inferred priority)
--   - future analytics can correlate user weight assignments with
--     downstream outcomes
--
-- The Synthesis prompt produces priority-ordered leverage_points and
-- risk_points already; this column lets the USER override that order
-- when they have domain knowledge the LLM doesn't.

ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS claim_weight numeric;

COMMENT ON COLUMN entities.claim_weight IS
  'User-assigned weight in [0,1] for the entity''s importance as a claim in the Synthesis Lab claim stack. NULL = unweighted (sort falls back to synthesis-inferred priority via is_leverage_point / centrality_rank).';

-- Sparse index — most entities will have NULL claim_weight. PostgreSQL
-- skips NULL rows in the index, so this stays cheap.
CREATE INDEX IF NOT EXISTS entities_claim_weight_idx
  ON entities (space_id, claim_weight DESC NULLS LAST)
  WHERE claim_weight IS NOT NULL;
