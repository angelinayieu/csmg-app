-- ── Mediator Proposal Engine — M4 schema ─────────────────────────────
--
-- Adds proposal lifecycle fields to `entities` and `edges` so the
-- detect → propose → validate → persist pipeline can stage bridging
-- entities for user review without polluting the canonical graph.
--
-- Lifecycle, in plain language:
--   1. M1 detects an orphan cluster on the canvas (e.g., MDA + 8-OHdG
--      + Oxidative Stress are floating with no upstream cause)
--   2. M2 asks the LLM: "what's the canonical bridge?"
--      (e.g. Reactive Oxygen Species)
--   3. M3 validates the LLM's proposal against literature knowledge
--   4. M4 (this migration) lets the system persist the proposed entity
--      with proposal_status='proposed_mediator' and the proposed edges
--      with proposal_status='proposed' — they live in the same tables
--      as everything else, so existing queries see them naturally,
--      filtered by the WHERE clause when needed
--   5. M6 surfaces them on canvas with a Bridge-gaps chip
--   6. User clicks Approve → flip both to ('approved', 'confirmed')
--   7. User clicks Reject → flip both to ('rejected_mediator', 'rejected')
--      (kept for audit, hidden from default reads)
--
-- Why we augment existing tables instead of a new mediator_proposals
-- table: every existing query that joins entities + edges should
-- transparently include approved mediators with no code change. Only
-- the queue surfaces (M6) need to filter explicitly. A separate table
-- would force every consumer to UNION ALL forever.
--
-- Idempotent: safe to re-run. Adds columns with IF NOT EXISTS where
-- supported; check constraints use a fixed name so re-runs replace
-- cleanly.

-- ─────────────────────────────────────────────────────────────────────
-- entities — proposal lifecycle
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS proposal_status TEXT
    NOT NULL DEFAULT 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entities_proposal_status_check'
  ) THEN
    ALTER TABLE public.entities
      ADD CONSTRAINT entities_proposal_status_check
      CHECK (proposal_status IN ('approved', 'proposed_mediator', 'rejected_mediator'));
  END IF;
END$$;

-- The cluster id from M1 is a 12-char SHA-256 prefix, not a UUID.
-- Stored as TEXT for traceability + idempotent re-proposals.
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS proposed_from_cluster_id TEXT;

-- proposal_evidence shape (matches src/lib/mediator-proposal/persist-proposal.ts):
-- {
--   mechanism_explanation: string,
--   citation_seeds: string[],
--   proposer_confidence: number,             // from M2 proposal
--   verdict: ValidationVerdict,              // full M3 verdict object
--   cluster_member_names: string[],          // the orphans this bridges
--   cluster_pattern_kind: string,            // M1's pattern type
--   confidence_final: number,                // proposer × validator, clamped
--   speculative: boolean                     // verdict.status === 'speculative'
-- }
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS proposal_evidence JSONB;

-- Partial index — most queries fetch the active queue (proposed),
-- so the index is keyed on the rare case to keep it small.
CREATE INDEX IF NOT EXISTS idx_entities_proposed_mediator_queue
  ON public.entities (space_id, created_at DESC)
  WHERE proposal_status = 'proposed_mediator';

-- ─────────────────────────────────────────────────────────────────────
-- edges — proposal lifecycle
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.edges
  ADD COLUMN IF NOT EXISTS proposal_status TEXT
    NOT NULL DEFAULT 'confirmed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'edges_proposal_status_check'
  ) THEN
    ALTER TABLE public.edges
      ADD CONSTRAINT edges_proposal_status_check
      CHECK (proposal_status IN ('confirmed', 'proposed', 'rejected'));
  END IF;
END$$;

-- Trace which entity (the bridging mediator) caused this edge to be
-- proposed. Lets the M6 UI group "the 4 edges that come with this
-- proposed entity" together. Null for normal edges; populated only
-- for proposed-mediator-bridge edges.
ALTER TABLE public.edges
  ADD COLUMN IF NOT EXISTS proposed_by_entity_id UUID
  REFERENCES public.entities(id) ON DELETE CASCADE;

-- Partial index for fast queue + approve/reject scans on the
-- "currently proposed" subset.
CREATE INDEX IF NOT EXISTS idx_edges_proposed_queue
  ON public.edges (space_id, proposed_by_entity_id)
  WHERE proposal_status = 'proposed';

-- ─────────────────────────────────────────────────────────────────────
-- Documentation comments — visible to anyone exploring schema
-- ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.entities.proposal_status IS
  'approved (default; visible in normal queries); '
  'proposed_mediator (M4-M6 queue, awaiting user review); '
  'rejected_mediator (kept for audit; hidden from defaults).';

COMMENT ON COLUMN public.entities.proposed_from_cluster_id IS
  'M1 cluster_id (12-char SHA-256 prefix) the proposal originated from. '
  'Re-running M1 on unchanged data produces the same id, so we can '
  'detect "already proposed for this cluster" idempotently.';

COMMENT ON COLUMN public.entities.proposal_evidence IS
  'Mechanism explanation, citation seeds, validator verdict, cluster '
  'context. Shape: src/lib/mediator-proposal/persist-proposal.ts';

COMMENT ON COLUMN public.edges.proposal_status IS
  'confirmed (default); proposed (awaiting review with the bridging '
  'entity it accompanies); rejected (kept for audit).';

COMMENT ON COLUMN public.edges.proposed_by_entity_id IS
  'When proposal_status = proposed, this points to the proposed-mediator '
  'entity that brought this edge into existence. Lets the queue group '
  'edges by their parent proposed entity.';
