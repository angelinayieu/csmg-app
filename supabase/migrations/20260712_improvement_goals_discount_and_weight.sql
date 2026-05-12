-- ── Improvement goals: discount_per_week + weight ────────────────────────
--
-- Two columns that formalize the reward function as a proper RL reward:
--
--   discount_per_week  — per-week discount factor γ in [0.7, 1.0].
--                        Default 0.95 (≈ 14-week half-life).
--                        Lower γ → impatient (favor fast-acting interventions);
--                        higher γ → patient (willing to wait for compounding
--                        effects). Today this is implicit-1.0; the simulator
--                        treats a 12-week-out gain identically to a 1-week-out
--                        gain, which is wrong for any decision-relevant horizon.
--
--   weight             — per-goal contribution to the composite reward
--                        function. Default 1.0 (uniform). When the user has
--                        multiple sub-goals (e.g., "improve working memory
--                        AND reduce fatigue"), weights let them express
--                        relative importance. Cost terms (objective_type =
--                        'cost') store positive weights here and are applied
--                        as negative contributions by the reward builder.
--
-- Read by:
--   - aggregate-environment-definition.ts → DiscountFactor + GoalTerm.weight
--     + RewardFunction.weights_normalized
--   - simulator (planned): apply γ when computing expected discounted
--     return E[Σ γ^t R(s_t, a_t, s_{t+1})] for trajectory evaluation
--   - policy search (planned): optimize policy under the user's specific
--     γ; recommend different plans for high-γ vs low-γ users
--
-- The RL formalism this enables: V(s) = max_π E[Σ γ^t Σ_g w_g R_g | s, π]
-- which is precisely the Bellman equation for the user's situation.

alter table public.improvement_goals
  add column if not exists discount_per_week numeric default 0.95;

alter table public.improvement_goals
  add column if not exists weight numeric default 1.0;

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

-- Backfill existing rows (defaults only apply on INSERT, not on
-- pre-existing rows).
update public.improvement_goals
  set discount_per_week = 0.95
  where discount_per_week is null;

update public.improvement_goals
  set weight = 1.0
  where weight is null;

comment on column public.improvement_goals.discount_per_week is
  'Per-week discount factor γ in [0.7, 1.0]. Drives the time-preference of the reward function: lower γ favors fast-acting interventions, higher γ is willing to wait for compounding effects. Default 0.95 (≈ 14-week half-life).';

comment on column public.improvement_goals.weight is
  'Contribution weight in the composite reward function. Default 1.0 (uniform across goals). Cost terms (objective_type = ''cost'') store positive weights here and are applied as negative contributions by the reward builder.';
