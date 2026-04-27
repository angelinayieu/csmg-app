-- ── D5b · Decomposition tree on pipeline_runs ─────────────────────────
--
-- Backs the confidence-gated drilling rollout from
-- docs/KG_DEPTH_CRITIQUE.md §9 D5b. Replaces the static MAX_DEPTH=2 cap
-- in src/components/canvas/hooks/use-recursive-decompose.ts with a
-- confidence-decay gate driven by the strategizer's existing signals
-- (centrality, convergence_count, agent_convergence_count,
-- causal_depth_normalized, outcome_alignment, user_controllable_lever).
--
-- Pattern source: Microsoft GraphRAG DRIFT Search (Figure 1, phase B)
-- — confidence glyph on each node decides whether to continue
-- expansion. Adapted to our domain: instead of query-time exploration,
-- we use it for build-time strategic decomposition. Adds the
-- "lateral-at-depth" pattern (drill siblings sharing convergence
-- before going deeper) — unique to our strategic decomposition use
-- case, not present in DRIFT.
--
-- The tree is a flat array of drill records (each pointing back to its
-- parent_entity_id) rather than a nested tree, because:
--   1. JSONB array append is cheap and atomic; nested-tree updates
--      would require read-modify-write under concurrency
--   2. The tree shape is reconstructible client-side by walking
--      parent_entity_id pointers — no information loss
--   3. Multiple drills can fire in parallel (lateral expansion); a
--      flat append is race-friendly
--
-- Shape:
--   [
--     {
--       "parent_entity_id": "<uuid>",
--       "child_entity_id": "<uuid>",
--       "child_entity_code": "<display id like PG abc_i1>",
--       "depth": <integer 0..6>,
--       "confidence_to_continue": <number 0..1>,
--       "parent_quality_score": <number 0..1>,
--       "drilled_at": "<ISO timestamp>",
--       "stop_reason": null
--                   | "absolute_max_depth"
--                   | "below_confidence_threshold"
--                   | "no_children_returned",
--       "lateral_siblings": [<entity_id>, ...]   // optional
--     },
--     ...
--   ]
--
-- Null on legacy / non-decompose runs. Append-only; never rewritten.

alter table public.pipeline_runs
  add column if not exists decomposition_tree jsonb;

comment on column public.pipeline_runs.decomposition_tree is
  'Append-only array of drill records produced by confidence-gated recursive decomposition. Each record links a parent entity to a child via the depth + confidence-to-continue computed from strategizer signals. Null for non-decompose runs and pre-D5b runs. See src/lib/pipeline/drill-confidence.ts.';

-- GIN index lets us later query "find runs whose drills stopped on
-- below_confidence_threshold for entity X" without a sequential scan.
-- Cheap because the column is null for most rows.
create index if not exists pipeline_runs_decomposition_tree_gin_idx
  on public.pipeline_runs using gin (decomposition_tree)
  where decomposition_tree is not null;
