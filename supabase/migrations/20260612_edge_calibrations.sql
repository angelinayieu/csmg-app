-- ── D6 phase 2 · Edge calibration audit log ──────────────────────────
--
-- Backs the path-aware edge calibration upgrade in
-- docs/KG_DEPTH_CRITIQUE.md §9 D6. The existing first-pass calibration
-- (src/lib/kg/apply-confidence-from-deviation.ts) updates entity +
-- edge confidence by a small fixed delta based on deviation_tag. It's
-- diffuse (touches all leverage/risk/bottleneck entities, not the
-- actual causal path), path-blind (no use of which edges contributed
-- to the prediction), and only updates `confidence` — NOT `strength`,
-- which is what Monte Carlo simulation propagates.
--
-- D6 phase 2 closes those gaps with PATH-AWARE updates routed only
-- through edges on the causal chain that produced the prediction,
-- magnitude-weighted by relative prediction error, and updating BOTH
-- `confidence` (epistemic — does this edge really exist?) and
-- `strength` (mechanism — how strong is the propagation?). This audit
-- table records every change so:
--
--   1. UI can show "this edge's strength was 0.7, calibrated down
--      to 0.55 after surprise on prediction Y about metric Z"
--   2. Drift attribution: when a strategy regenerates, we can say
--      "since last regen, edges on the X→Y path drifted -0.18
--      cumulative — model uncertainty grew"
--   3. Rollback: if a calibration pass turns out to be misaligned
--      (e.g. user later corrects the actual via UI), we can reverse
--      the audited updates instead of approximating
--   4. Strategizer signal: `calibration_drift` per entity — count
--      of recent calibrations on incident edges. Surfaces "stale
--      model region — re-examine"
--
-- Append-only. One row per (prediction × edge) update. Never updated
-- after insert; rolled back via compensating insert with negative deltas.

create table if not exists public.edge_calibrations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  edge_id uuid not null references public.edges(id) on delete cascade,
  -- The prediction whose resolution drove this update. May be null when
  -- a calibration is applied via a non-prediction path (e.g. user
  -- correction, scenario commit feedback) — keep nullable so we can
  -- expand audit coverage without schema churn.
  prediction_id uuid references public.prediction_ledger(id) on delete set null,
  -- Strategy snapshot that scoped the prediction. Lets us attribute
  -- drift per-strategy when generating recommendations.
  strategy_snapshot_id uuid references public.strategy_snapshots(id) on delete set null,
  -- Delta applied to the edge's `strength` field. Positive = reinforced,
  -- negative = de-rated. Magnitude depends on relative_error and the
  -- edge's position in the causal path (closer to outcome = larger
  -- delta).
  delta_strength numeric not null,
  -- Same for `confidence`. Always paired with strength delta so the
  -- audit log captures both axes from a single trigger.
  delta_confidence numeric not null,
  -- Snapshot of the edge's strength + confidence BEFORE the update.
  -- Lets us reconstruct the post-update value via subtraction even if
  -- the edge has been touched by intervening updates we missed.
  pre_strength numeric,
  pre_confidence numeric,
  -- The deviation_tag from prediction_ledger (expected | regime_shift |
  -- surprise | qualitative). Stored so audit queries don't need to
  -- re-join. Null when not driven by a prediction (rare).
  deviation_tag text
    check (deviation_tag is null or deviation_tag in (
      'expected', 'regime_shift', 'surprise', 'qualitative'
    )),
  -- The relative error magnitude that drove this update. For numeric
  -- predictions: |actual - predicted| / max(|predicted|, ε). Null when
  -- prediction was qualitative.
  relative_error numeric,
  -- Position of this edge in the causal path that produced the prediction.
  -- 1 = edge directly incident to the tracker entity (closest to
  -- outcome), N = N-th hop upstream. Higher hops get smaller deltas
  -- because their causal contribution is more diluted by intermediate
  -- mediation. Null when path-aware routing wasn't possible (fell back
  -- to heuristic mode).
  path_position integer check (path_position is null or path_position >= 1),
  -- Free-form note. Calibrator writes a one-sentence rationale (e.g.
  -- "surprise tag, |Δ|/p = 0.65, edge at hop 2 → delta_strength = -0.08").
  rationale text,
  applied_at timestamptz not null default now(),
  -- Method tag — which calibrator wrote this row. Lets us A/B different
  -- calibration formulas + audit which method drove which drift.
  method text not null default 'path_aware_v1'
    check (method in ('path_aware_v1', 'heuristic_v1', 'manual_correction'))
);

comment on table public.edge_calibrations is
  'Append-only audit log of edge confidence/strength updates driven by prediction-error feedback. See docs/KG_DEPTH_CRITIQUE.md §9 D6 phase 2 for context. Each row is one (prediction × edge) update; rollback via compensating row.';

comment on column public.edge_calibrations.path_position is
  '1-indexed hop distance from the tracker entity (sink) to this edge along the directed-causal path that produced the prediction. Closer to outcome (lower number) = larger delta. Null when the calibrator could not reconstruct the path and fell back to heuristic mode.';

comment on column public.edge_calibrations.method is
  'Which calibrator produced this row. path_aware_v1 = D6 phase 2 path-aware update. heuristic_v1 = D6 phase 1 (apply-confidence-from-deviation). manual_correction = user-driven via UI.';

-- ── Indexes ──

create index if not exists edge_calibrations_space_applied_idx
  on public.edge_calibrations (space_id, applied_at desc);

-- "All calibrations for this edge" — used by strategizer drift signal.
create index if not exists edge_calibrations_edge_applied_idx
  on public.edge_calibrations (edge_id, applied_at desc);

-- "All calibrations from this prediction" — used by audit drawer +
-- rollback path.
create index if not exists edge_calibrations_prediction_idx
  on public.edge_calibrations (prediction_id)
  where prediction_id is not null;

-- "Recent surprises across the space" — used by drift-region surface.
create index if not exists edge_calibrations_surprises_idx
  on public.edge_calibrations (space_id, applied_at desc)
  where deviation_tag = 'surprise';

-- ── RLS ──

alter table public.edge_calibrations enable row level security;

create policy "edge_calibrations select own space"
  on public.edge_calibrations for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = edge_calibrations.space_id
        and s.user_id = auth.uid()
    )
  );

-- Inserts go through the service-role calibration pipeline (resolver
-- cron + manual-correction route).
create policy "edge_calibrations service insert"
  on public.edge_calibrations for insert
  with check (false);
