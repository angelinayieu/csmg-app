-- ── Root-Cause Trace — causal-depth scoring per entity ────────────────
--
-- Adds four columns to `entities` that together encode a backward-
-- BFS from every goal along the causal edge subgraph:
--
--   causal_depth       integer   0 at goals, N as we walk upstream;
--                                 null if the entity isn't reachable by
--                                 backward BFS from any goal.
--
--   converges_chains   uuid[]    goal ids whose backward trace reaches
--                                 this entity. length ≥ 2 = convergence
--                                 (two goals share this upstream driver).
--
--   root_score         real      composite root-cause-ness score:
--                                 convergence × depth_ratio × uncertainty.
--                                 Higher = stronger root candidate.
--
--   is_root_candidate  boolean   true iff the entity has no further
--                                 upstream causal edges in the subgraph
--                                 AND converges_chains is non-empty.
--                                 Leaves of the backward BFS that are
--                                 reachable from at least one goal.
--
-- Why on `entities` and not a separate table:
--   These four values are (a) per-entity, (b) overwritten every trace
--   cycle, (c) read densely by the strategizer's signal extractor. A
--   side-table would force a join on every signal computation; adding
--   them to entities keeps the hot path a single SELECT *.
--
-- Why converges_chains is uuid[] and not jsonb:
--   We need index-able membership queries ("which entities have goal X
--   in their converges_chains?") via && / @>. uuid[] supports GIN
--   indexing; jsonb would also work but the uuid[] contract is tighter.
--
-- Overwriting semantics:
--   The /api/pipeline/root-trace endpoint recomputes the full space
--   each call and overwrites every entity's four columns. There is no
--   incremental-update path — the graph evolves fast enough that a
--   stale trace is worse than a re-run.

alter table public.entities
  add column if not exists causal_depth smallint;

alter table public.entities
  add column if not exists converges_chains uuid[] not null default '{}';

alter table public.entities
  add column if not exists root_score real;

alter table public.entities
  add column if not exists is_root_candidate boolean not null default false;

-- ── Indexes ──────────────────────────────────────────────────────────
--
-- Primary read: "top-N root candidates for this space, ordered by
-- root_score desc". Partial index limits storage to rows that actually
-- had non-null scores (most rows never get traced if the space has no
-- goals, so a full-table index would be waste).

create index if not exists entities_space_root_score_idx
  on public.entities (space_id, root_score desc)
  where root_score is not null;

create index if not exists entities_space_root_candidate_idx
  on public.entities (space_id)
  where is_root_candidate = true;

-- GIN on converges_chains — supports @> and && for "which entities
-- does goal X converge through?" queries used by the hierarchy
-- renderer in reports.
create index if not exists entities_converges_chains_gin
  on public.entities using gin (converges_chains);

-- ── Comments ────────────────────────────────────────────────────────
--
-- Postgres column comments so the meaning survives outside this file
-- (DB explorer tools pick them up).

comment on column public.entities.causal_depth is
  'Backward-BFS hops from nearest goal along causal edges. 0 = goal; null = unreachable.';
comment on column public.entities.converges_chains is
  'Goal ids whose backward trace reaches this entity. length >= 2 => convergence point.';
comment on column public.entities.root_score is
  'Composite root-cause-ness score: convergence_count x depth_ratio x uncertainty. Higher = stronger root.';
comment on column public.entities.is_root_candidate is
  'True iff no further upstream causal edges AND at least one goal reaches this entity.';
