-- Extends twin_proposals.user_status with a 'superseded' lifecycle state so
-- regenerations don't accumulate "proposed" rows forever. The wire helper
-- (wire-twin-proposal.ts) marks any prior 'proposed' rows for a space as
-- 'superseded' right before inserting the new one, preserving the audit
-- trail while keeping "latest user-actionable proposal" a clean query.
--
-- Pattern: check constraints can't be altered in-place in postgres; we drop
-- and re-add. Existing rows are unaffected (their values are all currently
-- 'proposed' | 'refined' | 'approved' | 'rejected').

alter table public.twin_proposals
  drop constraint if exists twin_proposals_user_status_check;

alter table public.twin_proposals
  add constraint twin_proposals_user_status_check
  check (user_status in ('proposed', 'refined', 'approved', 'rejected', 'superseded'));

-- Index tailored for the wire helper's "supersede prior proposed" sweep.
-- The existing idx_twin_proposals_pending partial index already covers this
-- query — no new index needed.

comment on constraint twin_proposals_user_status_check on public.twin_proposals is
  'Lifecycle: proposed (awaiting review) | refined (user asked for regen with constraint) '
  '| approved (user accepted; downstream agents can run) | rejected (user declined) '
  '| superseded (a newer proposal replaces this one; kept for audit).';
