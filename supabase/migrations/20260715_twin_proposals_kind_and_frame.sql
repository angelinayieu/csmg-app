-- ── twin_proposals: kind discriminator + frame_payload for problem_twin ──
--
-- Resolves the locked-memory ⟷ code inconsistency around
-- "Twin === Strategy === Workflow." The memory says a twin is committed
-- at intake; the code generates twins POST-strategy via
-- wireTwinProposalAndMechanisms. Both are correct — they're TWO LIFECYCLE
-- VERSIONS of the same artifact:
--
--   problem_twin    — the chosen problem framing + its sub-objectives
--                     (committed at intake, after the framing panel
--                      diverges and the user picks)
--   strategy_twin   — the chosen strategy + its mechanisms
--                     (committed after strategy synthesis; today's
--                      twin_proposals rows are all this kind)
--   executable_twin — the chosen apps + their variants
--                     (committed after app generation; future)
--
-- supersedes_id (effectively encoded via timestamp + space_id today)
-- gives us the chain. A new problem_twin cascade-supersedes downstream
-- strategy_twin + executable_twin via app-level logic.
--
-- This migration is purely additive:
--   • Adds `kind` with DEFAULT 'strategy_twin' so every existing row
--     gets backfilled to the correct value with zero data movement.
--   • Adds `frame_payload jsonb` (nullable) for problem_twin shape.
--     strategy_twin/executable_twin rows leave it null and continue
--     using `justification` as today.
--   • Relaxes `justification NOT NULL` so problem_twin rows can omit
--     it — a problem_twin's contract lives in frame_payload, not
--     mechanism_ids. The existing CHECK constraint on user_status is
--     unchanged.
--
-- Backout: drop column kind, drop column frame_payload, restore
-- NOT NULL on justification.

-- ── 1. Add the kind discriminator ────────────────────────────────────

alter table public.twin_proposals
  add column if not exists kind text not null default 'strategy_twin';

alter table public.twin_proposals
  drop constraint if exists twin_proposals_kind_check;

alter table public.twin_proposals
  add constraint twin_proposals_kind_check
  check (kind in ('problem_twin', 'strategy_twin', 'executable_twin'));

comment on column public.twin_proposals.kind is
  'Lifecycle version of the twin. problem_twin = chosen problem framing '
  '(committed at intake, post-framing-panel). strategy_twin = chosen '
  'strategy + mechanisms (today''s default, committed post-strategy-refresh). '
  'executable_twin = chosen apps + variants (committed post-app-generation). '
  'A new problem_twin cascade-supersedes any downstream strategy_twin / '
  'executable_twin for the same space.';

-- ── 2. Add frame_payload for problem_twin shape ──────────────────────
--
-- Shape (mirrors the strategy_twin justification convention — options[]
-- + chosen_rank + rejected_options[] so the same UI re-rank pattern
-- works):
--   {
--     "options": [{
--       "framing_id": "cost_focus" | "mechanism_gap" | ...,
--       "framing_title": string,        -- short headline
--       "chosen_approach": string,      -- 1-2 sentences
--       "load_bearing_assumption": string,
--       "proposed_axes": [...],
--       "supporting_lenses": string[],  -- which lenses backed this
--       "why_this_framing": string,
--       "when_it_wins": string,
--       "when_it_fails": string,
--       "sub_objectives": [{text, source_quote, confidence}],
--       "confidence": number 0..1
--     }],
--     "chosen_rank": int,
--     "rejected_options": [{
--       "framing_id": string,
--       "why_rejected": string
--     }],
--     "framed_at": ISO timestamp
--   }
--
-- Nullable so existing strategy_twin rows don't need backfill.

alter table public.twin_proposals
  add column if not exists frame_payload jsonb;

comment on column public.twin_proposals.frame_payload is
  'Problem-framing payload for kind=problem_twin rows. Mirrors the '
  'strategy_twin justification shape (options[] + chosen_rank + '
  'rejected_options[]) so the same select_alternative UI pattern '
  'works for both. Null for strategy_twin / executable_twin rows.';

-- ── 3. Relax NOT NULL on justification ───────────────────────────────
--
-- problem_twin rows live in frame_payload, not justification. We add
-- a CHECK that at least ONE of (justification, frame_payload) is
-- non-null so we never persist an empty proposal.

alter table public.twin_proposals
  alter column justification drop not null;

alter table public.twin_proposals
  drop constraint if exists twin_proposals_payload_present;

alter table public.twin_proposals
  add constraint twin_proposals_payload_present
  check (
    (kind = 'strategy_twin'    and justification is not null) or
    (kind = 'problem_twin'     and frame_payload is not null) or
    (kind = 'executable_twin'  and (justification is not null or frame_payload is not null))
  );

comment on constraint twin_proposals_payload_present on public.twin_proposals is
  'Each twin kind requires its own payload column to be populated. '
  'strategy_twin → justification; problem_twin → frame_payload; '
  'executable_twin → either (apps may use both as they materialize).';

-- ── 4. Per-kind partial index for "latest pending of this kind" ──────
--
-- The existing idx_twin_proposals_pending covers all kinds together;
-- callers wiring problem_twin will want "latest pending problem_twin
-- for this space" without scanning strategy_twin rows. Partial index
-- per kind makes that O(log n).

create index if not exists idx_twin_proposals_pending_by_kind
  on public.twin_proposals(space_id, kind)
  where user_status = 'proposed';

comment on index public.idx_twin_proposals_pending_by_kind is
  'Per-kind "latest proposed" lookup. Used by wire-framing-proposal '
  '(future) and wire-twin-proposal supersede sweeps to find the prior '
  'pending row of the same kind before inserting a new one.';
