-- ── Phase 4 · Strategy confidence overrides ──
--
-- Append-only log of user-supplied confidence overrides on AI-generated
-- strategies. The dashboard composite-meter shows an AI-derived number
-- (cov·0.30 + conf·0.25 + prov·0.25 + coh·0.20 — see ReadyToShipMeter);
-- this table records the user's "I'd call this lower / similar / higher"
-- second opinion at approval time.
--
-- Why we keep history (append-only) rather than UPSERT:
--   • Each override is a labeled training datum for the calibration loop
--     (Phase 5). Overwriting drops signal.
--   • Lets the UI render "you've adjusted this 3 times — drift over time
--     suggests AI is consistently overconfident on this strategy."
--   • Cheap — even a power user generating 100 strategies/year produces
--     well under 1k rows/year.
--
-- Anchoring: (space_id, strategy_generated_at) ties the override to a
-- specific strategy generation. When the strategy regenerates, the new
-- generation starts with no active override (until the user provides
-- one); historical overrides for prior generations remain in place.
--
-- Idempotent: re-running this migration is a no-op (table + index +
-- policies all use `if not exists` / drop-and-recreate pattern).

create table if not exists public.strategy_confidence_overrides (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Ties this override to a specific strategy generation. ISO timestamp
  -- pulled from synthesis_data.strategic_recommendation.generated_at at
  -- the moment of save.
  strategy_generated_at timestamptz not null,

  -- The composite the meter showed at the time of override. Recording it
  -- alongside the user's number lets us compute the delta (user - ai)
  -- without recomputing past meter values; also protects the calibration
  -- record if the meter weighting ever changes.
  ai_composite_score int not null check (ai_composite_score between 0 and 100),

  -- The user's number. Pre-filled with the AI composite in the UI; the
  -- user can drag to override.
  user_score int not null check (user_score between 0 and 100),

  -- Categorical direction tag. Redundant with (user_score - ai_composite_score)
  -- but useful for fast aggregations and lets the UI render the user's
  -- intent even when the score deltas are small. Aligns with the three
  -- radio options in the drawer's override widget.
  user_direction text not null check (user_direction in ('lower', 'similar', 'higher')),

  -- Optional free-text justification. Calibration analysis (Phase 5) may
  -- mine common reasons (e.g. "evidence stale", "missed market shift").
  reason text,

  created_at timestamptz not null default now()
);

-- Primary access pattern: latest override for (space, generation).
-- The drawer reads `ORDER BY created_at DESC LIMIT 1` filtered by both.
create index if not exists strategy_confidence_overrides_space_idx
  on public.strategy_confidence_overrides(space_id, strategy_generated_at desc, created_at desc);

alter table public.strategy_confidence_overrides enable row level security;

-- Read policy — owner only. Direct user_id check is faster than joining
-- through spaces; safe because we also enforce on insert below.
drop policy if exists "strategy_confidence_overrides owner can read"
  on public.strategy_confidence_overrides;
create policy "strategy_confidence_overrides owner can read"
  on public.strategy_confidence_overrides for select
  using (user_id = auth.uid());

-- Insert policy — must claim the row as your own AND prove ownership of
-- the referenced space. Belt + suspenders against client-supplied user_id
-- spoofing.
drop policy if exists "strategy_confidence_overrides owner can write"
  on public.strategy_confidence_overrides;
create policy "strategy_confidence_overrides owner can write"
  on public.strategy_confidence_overrides for insert
  with check (
    user_id = auth.uid() and
    space_id in (select id from public.spaces where user_id = auth.uid())
  );

comment on table public.strategy_confidence_overrides is
  'Phase 4 of the strategy-rigor sprint. Append-only log of user confidence overrides on AI-generated strategies. Latest row per (space_id, strategy_generated_at) is the active override. Feeds the calibration loop (Phase 5) where deltas across strategies become a per-user/per-domain calibration curve.';

comment on column public.strategy_confidence_overrides.ai_composite_score is
  'The ReadyToShipMeter composite at the moment the user saved the override. Persisted so meter-weighting changes do not retroactively distort the historical delta.';

comment on column public.strategy_confidence_overrides.user_direction is
  'Categorical tag mirroring the three radio options in the drawer. Redundant with sign(user_score - ai_composite_score) but makes "I think it is similar but slightly off" expressible without quibbling over a 1-point delta.';
