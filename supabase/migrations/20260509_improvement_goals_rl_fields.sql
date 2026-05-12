-- ── improvement_goals RL fields (Schema dep #6 from environment-definition.ts) ──
--
-- Adds the two parameters needed to formalize the reward function +
-- discount factor of the MDP environment:
--
--   discount_per_week  — γ. Controls how much the reward function
--                        values near-term gains over distant ones.
--                        A γ of 0.95 means a gain N weeks from now
--                        is worth (γ^N) of the same gain today.
--                        Range [0.7, 1.0]; below 0.7 implies a half-
--                        life under 2 weeks which makes long-horizon
--                        plans uncomputable. Default 0.95 (~14-week
--                        half-life) matches the spec's stated
--                        sensible default.
--
--   weight             — Goal weight in the multi-goal reward sum.
--                        R(s,a,s') = Σ_g w_g × normalized_progress_g.
--                        Default 1.0 (uniform weighting). Sub-goals
--                        with smaller weights become "soft preferences"
--                        the policy search can trade off. Cost terms
--                        store positive weights here and get negated
--                        at simulation time (objective_type='cost').
--                        Range [0, ∞); typical [0, 5].
--
-- Rationale:
--   The codebase has a Monte Carlo simulator + an improvement_goals
--   table but the connection between them is implicit. Predictions
--   are computed for a target metric, but the system has no
--   mechanism for: (a) penalizing slow-arriving gains relative to
--   fast ones, or (b) trading off competing sub-objectives with
--   different priorities. Both are required for any RL policy
--   search; both are missing as data fields. This migration is
--   the load-bearing schema fix for the RL math.
--
-- Read by:
--   - src/lib/environment/aggregate-environment-definition.ts
--     (DiscountFactor.per_week, GoalTerm.weight)
--   - Future policy-search subsystem (CMA-ES over actions
--     maximizing Σ γ^t × R(s_t, a_t, s_{t+1}))
--   - Future Bellman value iteration over the KG

-- ── Add columns ──
alter table public.improvement_goals
  add column if not exists discount_per_week numeric default 0.95;

alter table public.improvement_goals
  add column if not exists weight numeric default 1.0;

-- ── Constraints ──
alter table public.improvement_goals
  drop constraint if exists improvement_goals_discount_per_week_check;

alter table public.improvement_goals
  add constraint improvement_goals_discount_per_week_check
  check (
    discount_per_week is null
    or (discount_per_week >= 0.7 and discount_per_week <= 1.0)
  );

alter table public.improvement_goals
  drop constraint if exists improvement_goals_weight_check;

alter table public.improvement_goals
  add constraint improvement_goals_weight_check
  check (weight is null or weight >= 0);

-- ── Comments ──
comment on column public.improvement_goals.discount_per_week is
  'γ — RL discount factor per week. Default 0.95 (~14-week half-life). '
  'Range [0.7, 1.0]. Drives how policy search weighs near-term vs '
  'distant gains. Spec: src/types/environment-definition.ts schema dep #6.';

comment on column public.improvement_goals.weight is
  'Weight in multi-goal reward sum R(s,a,s')=Σ_g w_g × normalized_progress_g. '
  'Default 1.0. Cost terms store positive weight here; the simulator '
  'negates at runtime based on objective_type. Spec: src/types/'
  'environment-definition.ts schema dep #6.';

-- ── Backfill ──
-- All existing rows get the default values explicitly so downstream
-- code can treat NULL as "not yet customized" (is_user_set=false in
-- the EnvironmentDefinition.DiscountFactor).
update public.improvement_goals
set discount_per_week = 0.95
where discount_per_week is null;

update public.improvement_goals
set weight = 1.0
where weight is null;

-- ── Indexes ──
-- The reward-aggregator reads weights ordered by parent_goal_id; no
-- new index needed beyond the existing parent_goal_id index from
-- 20260407_goal_hierarchy.sql.
