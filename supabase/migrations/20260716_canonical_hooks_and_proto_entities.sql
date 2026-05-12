-- ── Tier 1 hooks for canonical concept registry + proto-entity ──
--    persistence at framing-approval time
--
-- Sprint W3.1 of the diverge-converge plan (see
-- DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md §5 Week 3).
--
-- This migration is purely additive. Every column added is nullable
-- with no default population pass; no existing row is touched. Rolls
-- back to baseline with a `DROP COLUMN` per added column.
--
-- ── Why these columns now ──────────────────────────────────────────
--
-- The 5-lens framing panel produces ~17K characters of structured
-- cognition per intake (candidate_whole_framing[], load_bearing_
-- assumptions[], named_risks[], proposed_axes[], sub_problems[]).
-- Today, all of that is consumed as prompt text or stored in
-- spaces.situation_frame JSONB — none of it becomes graph rows.
-- That's compute-waste at $0.025 per intake AND prevents decompose
-- from LINKING to upstream framing artifacts (it can only re-derive
-- them from text).
--
-- Week 3's work is to persist the HIGH-INFORMATION subset of those
-- artifacts as `entities` rows at user-approval time — once the user
-- has committed to a framing, we materialize the chosen framing's
-- sub-problems, load-bearing assumptions, named risks, and the
-- framing itself as proto-entities. Decompose's Pass 1 prompt then
-- receives `existing_entities[]` and is instructed to LINK/EXPAND
-- rather than re-derive.
--
-- The columns added below are the *substrate* for that work:
--
-- entities.canonical_concept_id
--   FK column to the future canonical_concepts table (Week 6+). We
--   add the column NOW (nullable, no FK constraint yet) so the
--   proto-entity write path can populate it via cluster lookup
--   immediately. Once the canonical table lands, we add the FK
--   constraint as a separate migration — backfill is unnecessary
--   because every existing row already has NULL.
--
-- entities.derived_from
--   Provenance JSONB. Captures which framing/lens/source produced
--   the entity. Shape (see persist-framing-protos.ts):
--     {
--       "source_type": "lens_framing" | "lens_assumption" | ...
--       "lens_id": "skeptic" | "engineer" | ...
--       "framing_id": "mechanism_bottleneck",
--       "twin_proposal_id": "uuid",
--       "source_text_excerpt": "≤200 chars verbatim from the lens"
--     }
--
-- entities.conditional_context
--   Adaptive-weighting context per Bareinboim transportability. The
--   downstream weighter (Week 6+) consults this to score how much
--   weight a proto-entity should carry in a given inference. Shape:
--     {
--       "when_it_wins": string,
--       "when_it_fails": string,
--       "requires_data_presence": ["has_telemetry", ...] | null,
--       "intake_signature": { data_presence_score, framing_confidence, ... }
--     }
--   For the v0 proto-entity writer, the chrome reads when_it_wins/
--   when_it_fails from the lens's whole-framing payload. The
--   weighter doesn't exist yet but this column makes its job cheap.
--
-- edges.is_canonical_mechanism
--   Selection-diagram marker — true when this edge represents a
--   canonical mechanism that transfers across situations (Bareinboim
--   transportability). NULL = unknown, false = situation-specific.
--   Used by the future cross-space inference layer. For now: just
--   the column.
--
-- edges.transferability_tag
--   Free-form tag for additional transportability metadata when the
--   boolean above is insufficient (e.g., "transfers within domain X
--   only", "requires baseline measurement at site Y"). NULL =
--   default behavior (no special tag).

-- ── 1. entities columns ───────────────────────────────────────────

alter table public.entities
  add column if not exists canonical_concept_id uuid;

alter table public.entities
  add column if not exists derived_from jsonb;

alter table public.entities
  add column if not exists conditional_context jsonb;

comment on column public.entities.canonical_concept_id is
  'FK column for the future canonical_concepts table (Week 6+ of the '
  'diverge-converge plan). Nullable, no FK constraint yet — added '
  'here so proto-entity writes can populate it via cluster lookup '
  'as the canonical_concepts table is being seeded. Backfill is '
  'not needed: all existing rows have NULL, and post-Week-6 reads '
  'tolerate NULL (means "not yet clustered").';

comment on column public.entities.derived_from is
  'Provenance JSONB for proto-entities materialized at framing-'
  'approval time. Shape: { source_type, lens_id, framing_id, '
  'twin_proposal_id, source_text_excerpt }. NULL for entities '
  'created by decompose / user-authored — the column is opt-in for '
  'pipeline stages that need provenance + audit.';

comment on column public.entities.conditional_context is
  'Adaptive-weighting context per Bareinboim transportability. Read '
  'by the future cross-space weighter (Week 6+) to score how much '
  'weight a proto-entity carries in a given inference. Shape: '
  '{ when_it_wins, when_it_fails, requires_data_presence[], '
  'intake_signature }. NULL = no conditional weighting applied.';

-- Partial index on derived_from when it's non-null. Speeds up
-- "find all proto-entities in this space" queries used by the
-- chrome panel that surfaces lineage. Excludes the ~95% of rows
-- where derived_from is null (decompose-authored entities).
create index if not exists idx_entities_derived_from_not_null
  on public.entities(space_id, derived_from)
  where derived_from is not null;

-- ── 2. edges columns ──────────────────────────────────────────────

alter table public.edges
  add column if not exists is_canonical_mechanism boolean;

alter table public.edges
  add column if not exists transferability_tag text;

comment on column public.edges.is_canonical_mechanism is
  'Selection-diagram marker (Bareinboim transportability). TRUE = '
  'edge represents a canonical mechanism that transfers across '
  'situations (e.g., "exercise → BDNF" applies regardless of '
  'context). FALSE = situation-specific (e.g., "user X overshares "'
  ' on Twitter on Tuesdays"). NULL = unknown / not yet evaluated. '
  'Used by the future cross-space inference layer.';

comment on column public.edges.transferability_tag is
  'Free-form tag for transferability metadata when the boolean '
  'is_canonical_mechanism is insufficient. Examples: "transfers '
  'within domain biology only", "requires baseline measurement", '
  '"applies above age 18". NULL = no special transferability '
  'constraints.';

-- No new index on these edge columns yet — the cross-space inference
-- layer doesn't exist, so query patterns aren't yet known. Add an
-- index when the consumer lands (avoids speculative indexing).
