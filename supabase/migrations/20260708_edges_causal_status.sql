-- ── Edges: causal_status (Pearl-hierarchy enforcement) ──────────────────
--
-- Adds a per-edge classification distinguishing established_causal /
-- plausible_causal / correlational_only claims. Today the simulator
-- treats every edge as if it carried a causal Cohen's d, which inflates
-- predicted effects when the underlying evidence is observational or
-- correlational. This column is read by:
--
--   - aggregate-environment-definition.ts → TransitionDynamics.by_causal_status
--     (drives the page's status pill row + transition_coverage component
--     of confidence_breakdown)
--   - monte-carlo simulator (future): correlational edges propagate with
--     a stiff downweight multiplier (e.g., 0.4) and surface a UI warning
--   - strategy-recommender (future): refuses to recommend interventions
--     whose chain depends primarily on correlational-only edges
--
-- Default = 'plausible_causal'. Conservative middle ground:
--   - Avoids silently upgrading every edge to "established" (the bug)
--   - Avoids silently downgrading every edge to "correlational" (breaks
--     existing predictions)
-- LLM auditors and human reviewers upgrade well-evidenced edges to
-- 'established_causal' and downgrade observational ones to
-- 'correlational_only' as evidence accumulates.

alter table public.edges
  add column if not exists causal_status text;

alter table public.edges
  drop constraint if exists edges_causal_status_check;

alter table public.edges
  add constraint edges_causal_status_check
  check (
    causal_status is null
    or causal_status in (
      'established_causal',
      'plausible_causal',
      'correlational_only'
    )
  );

-- Backfill nulls to the conservative default. Run-once; subsequent
-- re-runs hit zero rows because new edges get the column-default below.
update public.edges
  set causal_status = 'plausible_causal'
  where causal_status is null;

-- Set the column default for newly-inserted edges going forward.
alter table public.edges
  alter column causal_status set default 'plausible_causal';

-- Cheap "find correlational-only edges" filter used by:
--   - the transition drawer's status pill counts
--   - the strategy-recommender's edge-trust gate
create index if not exists edges_causal_status_idx
  on public.edges (space_id, causal_status);

comment on column public.edges.causal_status is
  'Pearl causal hierarchy classification: established_causal (RCT or strong identification), plausible_causal (observational + plausible mechanism), correlational_only (association without causal identification). Drives simulator down-weighting and policy-recommender trust gates.';
