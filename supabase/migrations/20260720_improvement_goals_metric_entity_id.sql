-- ── improvement_goals.metric_entity_id (W5.7b) ────────────────────────
--
-- Adds the DV-entity backlink the codebase has been silently relying on
-- (and silently degrading without).
--
-- ── Why this exists ────────────────────────────────────────────────
--
-- partition-variables-by-role.ts:115 reads `(g as any).metric_entity_id`
-- to build the DV set for the IV→DV → mediator/confounder graph walk.
-- app-generator.ts:305 reads it again to build a goal_id →
-- metric_entity_id map that derive-app-variables uses to filter each
-- app's DV bucket to its actual goal target.
--
-- The column was assumed to exist on improvement_goals but never
-- materialized via migration. Three downstream effects today:
--
--   1. partition's confounder/mediator detection runs with an empty DV
--      set → backdoor-path walker finds zero confounders even when
--      they exist
--   2. deriveAppVariables can't filter dependents → every app's
--      variable contract includes ALL DVs in the space (UX bloat +
--      muddied semantics)
--   3. ImprovementGoal interface in src/types/goals.ts has no
--      metric_entity_id field → all callsites use `(g as any)`, which
--      papers over the missing column at compile time
--
-- ── Schema change ──────────────────────────────────────────────────
--
-- Nullable FK to entities. Set null on entity delete so removing an
-- entity doesn't cascade-delete the goal (goals can outlive their
-- metric anchor; the user re-points them via the UI).
--
-- The four existing improvement_goals rows on live DB are NOT
-- backfilled here — each goal needs the user (or a future inference
-- pass) to pick the right entity. Backfill is intentionally manual
-- because the metric_name → entity matching is non-trivial; making
-- the code degrade gracefully when the column is NULL is the
-- low-risk path.

alter table public.improvement_goals
  add column if not exists metric_entity_id uuid
    references public.entities(id)
    on delete set null;

-- Lookup index for the goal_id → metric_entity_id map built at
-- generate-apps time.
create index if not exists improvement_goals_metric_entity_idx
  on public.improvement_goals (metric_entity_id)
  where metric_entity_id is not null;

comment on column public.improvement_goals.metric_entity_id is
  'FK to entities.id — the canonical DV (outcome) the goal is measuring. NULL when the goal has not yet been anchored to a graph entity. Consumed by partition-variables-by-role (DV set construction) and derive-app-variables (per-app DV filter). Set NULL on entity delete (goal survives the anchor loss).';
