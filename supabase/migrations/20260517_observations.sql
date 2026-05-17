-- ── Observations — the user's reality-data ingress ────────────────
--
-- Every observation is a moment where the user told the twin what
-- reality actually showed. The Skeptic agent (Phase 2) compares the
-- observation against recent predictions; runRealityCalibration()
-- adjusts affected edges. A history of observations becomes the
-- "twin got smarter" story surfaced on the Twin Detail Page's
-- Outcomes tab.
--
-- Linked to predicted_entity_ids[] so the calibration job knows
-- which model edges to consider. Optional actual_value JSONB lets
-- the user record a structured measurement (e.g. { metric:
-- "deep_work_hours", value: 2.5, unit: "h" }) alongside the
-- free-text description.

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  observation_text text not null,
  observed_at timestamptz not null,
  tags text[] not null default '{}',

  -- IDs of entities the user thinks this observation speaks to.
  -- The Skeptic agent uses these to scope its prediction match.
  -- Empty array = let the Skeptic infer relevance from the text.
  predicted_entity_ids uuid[] not null default '{}',

  -- Optional structured measurement.
  -- Shape: { metric: string, value: number, unit: string }
  -- When present, runRealityCalibration() uses it for numerical
  -- comparison. When absent, calibration is qualitative only.
  actual_value jsonb,

  -- Skeptic agent's analysis + edge calibration diff.
  -- Shape:
  --   {
  --     matched_prediction_id: uuid | null,
  --     verdict: "confirms" | "partial" | "refutes" | "orthogonal",
  --     edge_adjustments: [{ edge_id: uuid, delta_strength: numeric }],
  --     narrative: string
  --   }
  -- Null until processed by the Skeptic agent.
  calibration_applied jsonb,

  created_at timestamptz not null default now()
);

-- List the latest observations per space cheaply (Outcomes tab feed).
create index if not exists idx_observations_space_time
  on public.observations(space_id, observed_at desc);

-- User-scoped queries (cross-space "your recent observations").
create index if not exists idx_observations_user
  on public.observations(user_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table public.observations enable row level security;

drop policy if exists "observations_owner" on public.observations;
create policy "observations_owner" on public.observations
  for all using (auth.uid() = user_id);
