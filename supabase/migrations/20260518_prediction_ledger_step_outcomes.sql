-- Extend prediction_ledger so plan_step outcomes share the same resolver,
-- deviation tagging, and activity-feed surface as metric predictions.
--
-- Why this lives here:
-- The capability registry (20260516) + seed (20260517) introduced plan_steps
-- with predicted_return + actual_return. Rather than build a parallel
-- resolver for step outcomes, we widen prediction_ledger with a discriminant
-- so one resolver + one deviation tagger handles both subject kinds.
--
-- Three changes:
--   1. `subject_kind` discriminant: 'metric' (today) | 'action_return' |
--      'step_outcome'. Defaults to 'metric' so existing rows narrow cleanly.
--   2. `plan_step_id` + `capability_id` FKs, nullable. Set on step-outcome
--      rows; left null on metric rows.
--   3. `deviation_tag` CHECK widened to include 'failed' — capabilities can
--      outright fail (network error, access denied) in ways metric forecasts
--      can't; we need a tag that distinguishes "the thing didn't run" from
--      "the thing ran but surprised us."
--
-- What this does NOT do:
--   - Doesn't backfill existing rows (they stay subject_kind='metric' via
--     the default).
--   - Doesn't wire the resolver yet — src/lib/agents/resolve-predictions.ts
--     is updated in a subsequent code-only change (Phase 5).

-- ── 1. Add subject_kind discriminant ────────────────────────────────────

alter table public.prediction_ledger
  add column if not exists subject_kind text not null default 'metric'
    check (subject_kind in ('metric', 'action_return', 'step_outcome'));

comment on column public.prediction_ledger.subject_kind is
  'Discriminant. "metric" = forecast of a metric_tracker value (legacy path); '
  '"step_outcome" = forecast of a plan_step actual_return; "action_return" '
  'reserved for future direct action invocations outside a plan.';

-- ── 2. Link to plan infrastructure ──────────────────────────────────────

alter table public.prediction_ledger
  add column if not exists plan_step_id uuid references public.plan_steps(id) on delete set null,
  add column if not exists capability_id uuid references public.capabilities(id) on delete set null;

comment on column public.prediction_ledger.plan_step_id is
  'Set when subject_kind = "step_outcome". FK to the plan_step whose '
  'predicted_return this row forecasts. NULL for metric rows.';

comment on column public.prediction_ledger.capability_id is
  'Set when subject_kind = "step_outcome". Denormalized from '
  'plan_step.capability_id so the nightly capability-priors rollup can '
  'aggregate without a join. NULL for metric rows.';

-- Enforce: step_outcome rows must have plan_step_id; metric rows must not.
-- We use a trigger rather than a constraint because referencing another
-- column in a CHECK with complex logic is awkward and this fails loudly on
-- malformed inserts with a readable message.

create or replace function public.prediction_ledger_enforce_subject()
returns trigger language plpgsql as $$
begin
  if new.subject_kind = 'step_outcome' and new.plan_step_id is null then
    raise exception 'prediction_ledger: step_outcome rows require plan_step_id (got null)';
  end if;
  if new.subject_kind = 'metric' and new.plan_step_id is not null then
    raise exception 'prediction_ledger: metric rows must not have plan_step_id (got %)', new.plan_step_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_prediction_ledger_subject on public.prediction_ledger;
create trigger trg_prediction_ledger_subject
  before insert or update on public.prediction_ledger
  for each row execute function public.prediction_ledger_enforce_subject();

-- ── 3. Widen deviation_tag vocabulary ───────────────────────────────────

alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_deviation_tag_check;

alter table public.prediction_ledger
  add constraint prediction_ledger_deviation_tag_check
  check (deviation_tag is null or deviation_tag in
    ('expected', 'regime_shift', 'surprise', 'qualitative', 'failed'));

comment on column public.prediction_ledger.deviation_tag is
  'Resolver-assigned tag: "expected" (within +/-10% predicted), "regime_shift" '
  '(10-50% off, same direction), "surprise" (>50% off or sign-flip), '
  '"qualitative" (text-only resolution, no numeric comparison), "failed" '
  '(step-outcome only: invocation did not run at all — network, access, '
  'consent revoked, etc.).';

-- ── 4. Index for step-outcome hot path ──────────────────────────────────
-- Phase 5 resolver will query "open step_outcome rows whose plan_step has
-- resolved" — this index makes that cheap.

create index if not exists idx_prediction_ledger_step_outcomes_open
  on public.prediction_ledger(plan_step_id, status)
  where subject_kind = 'step_outcome' and status = 'open';

-- Per-capability deviation query (used by capability-priors rollup + UI)
create index if not exists idx_prediction_ledger_capability_resolved
  on public.prediction_ledger(capability_id, resolved_at desc)
  where subject_kind = 'step_outcome' and status = 'resolved';
