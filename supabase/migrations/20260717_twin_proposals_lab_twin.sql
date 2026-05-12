-- ── Phase 2 lab diverge-converge — twin_proposals.lab_twin support ──
--
-- Sprint W4.2 of the diverge-converge plan (see
-- DIVERGE_CONVERGE_ARCHITECTURE_PLAN.md §5 Week 4).
--
-- Extends twin_proposals to support Phase 2's lab diverge-converge:
--
--   • New kind value: 'lab_twin' — chosen lab configuration (design
--     type, subjects, features, measurement cadence, primary IV/DV).
--     Mirrors how 'problem_twin' represents the chosen problem
--     framing.
--
--   • New payload column: lab_payload jsonb — the lab-specific shape.
--     Independent of frame_payload (problem_twin) and justification
--     (strategy_twin) so each twin kind has its own typed payload
--     surface. No overloading of frame_payload — keeps schema +
--     code paths clean.
--
-- This migration is purely additive. Backout = drop column +
-- re-narrow the kind CHECK + re-narrow the payload_present CHECK.
--
-- The lab_twin row lifecycle mirrors problem_twin:
--   1. strategy-refresh fires generate-lab-options after the
--      strategy_twin lands (auto-fire, gated on
--      reasoning_settings.runLab).
--   2. Library runs 5 lab-design stances in parallel:
--      tight_experimentalist / naturalistic_observer /
--      adaptive_designer / pragmatist / mechanistic_prober
--   3. Persists twin_proposals(kind='lab_twin',
--      user_status='proposed') with lab_payload.options[] holding
--      the N stance-flavored lab configurations.
--   4. lab-proposal-gate chrome card shows preview + CTA.
--   5. /app/space/[id]/lab/pick gate page lets user pick.
--   6. /api/spaces/[id]/lab/select POSTs the chosen rank, flips
--      status to approved, emits lab_approved event.
--   7. lab_scaffolds materialization bridge derives a row from the
--      chosen option so the existing wizard / subject pipeline
--      keeps working unchanged.

-- ── 1. Drop the existing kind CHECK and re-add with 'lab_twin' ──

alter table public.twin_proposals
  drop constraint if exists twin_proposals_kind_check;

alter table public.twin_proposals
  add constraint twin_proposals_kind_check
  check (kind in (
    'problem_twin',
    'strategy_twin',
    'executable_twin',
    'lab_twin'
  ));

comment on constraint twin_proposals_kind_check on public.twin_proposals is
  'Lifecycle versions of a twin commitment. problem_twin (chosen '
  'problem framing, Week 3) / strategy_twin (chosen strategy + '
  'mechanisms, default since 20260510) / executable_twin (chosen '
  'apps + variants, future) / lab_twin (chosen lab configuration, '
  'Week 4 Phase 2).';

-- ── 2. Add lab_payload column ──────────────────────────────────────

alter table public.twin_proposals
  add column if not exists lab_payload jsonb;

comment on column public.twin_proposals.lab_payload is
  'Lab-configuration payload for kind=lab_twin rows. Shape mirrors '
  'frame_payload (options[] + chosen_rank + rejected_options[]) so '
  'the same select_alternative re-rank UX works for lab as for '
  'framing. Each option is a LabConfigOption (see '
  'src/types/lab-options.ts) carrying design_type, subjects[], '
  'features[], measurement_cadence, duration_estimate_weeks, '
  'primary_iv, primary_dv, when_it_wins/when_it_fails, confidence, '
  'and the stance lens_id (tight_experimentalist / naturalistic_'
  'observer / adaptive_designer / pragmatist / mechanistic_prober). '
  'Null for non-lab_twin rows.';

-- ── 3. Extend payload_present CHECK to include lab_twin ────────────
--
-- Currently this CHECK enforces:
--   strategy_twin    → justification IS NOT NULL
--   problem_twin     → frame_payload IS NOT NULL
--   executable_twin  → either justification OR frame_payload
--
-- Add: lab_twin → lab_payload IS NOT NULL. Same pattern.

alter table public.twin_proposals
  drop constraint if exists twin_proposals_payload_present;

alter table public.twin_proposals
  add constraint twin_proposals_payload_present
  check (
    (kind = 'strategy_twin'    and justification is not null) or
    (kind = 'problem_twin'     and frame_payload is not null) or
    (kind = 'executable_twin'  and (justification is not null or frame_payload is not null)) or
    (kind = 'lab_twin'         and lab_payload is not null)
  );

comment on constraint twin_proposals_payload_present on public.twin_proposals is
  'Each twin kind requires its own payload column to be populated. '
  'strategy_twin → justification; problem_twin → frame_payload; '
  'lab_twin → lab_payload; executable_twin → either (apps may use '
  'both as they materialize).';

-- The existing idx_twin_proposals_pending_by_kind partial index
-- (20260715) covers lab_twin lookups too — it filters on
-- user_status='proposed' grouped by (space_id, kind), so
-- "latest pending lab_twin for this space" is O(log n) automatically.
-- No new index needed.
